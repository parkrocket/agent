import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  ZERO_TOKENS,
  addSessionUsage,
  addTokens,
  type ModelConfig,
  type UsageRecord,
  type UsageSnapshot,
} from "@ai-office/shared";
import type { EventDb } from "../db";
import { allowedTranscript } from "./paths";
import { readIncrement } from "./reader";

const HOUR = 3_600_000;
/** Hourly buckets kept in the snapshot (enough for "today" in any time zone). */
const HOURS_KEPT = 48;

/**
 * Collects token usage from Claude Code transcripts. Hook events tell it
 * which transcripts to follow; it reads only the lines appended since last
 * time (positions survive restarts), stores per-message numbers in SQLite
 * (deduplicated by message id), and keeps an in-memory snapshot for clients.
 */
export class UsageTracker {
  private readonly snapshot: UsageSnapshot = { sessions: {}, hours: {} };
  /** Transcripts being followed, and the session folders whose sub-agent transcripts are followed too. */
  private readonly followed = new Set<string>();
  private readonly sessionDirs = new Set<string>();
  private watcher: FSWatcher | undefined;
  private poll: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: EventDb,
    private readonly models: ModelConfig,
    readonly root: string,
    private readonly onChange: () => void,
    private readonly log: (msg: string, err?: unknown) => void = () => {},
  ) {
    for (const r of db.allUsage()) this.apply(r);
  }

  get current(): UsageSnapshot {
    return this.snapshot;
  }

  /** Starts watching the projects folder (plus a slow poll, in case file events are missed). */
  start(pollMs = 5_000) {
    if (existsSync(this.root)) {
      try {
        this.watcher = watch(this.root, { recursive: true }, (_event, name) => {
          if (name && name.toString().endsWith(".jsonl")) this.onFileEvent(join(this.root, name.toString()));
        });
      } catch (err) {
        this.log("transcript watch unavailable; polling only", err);
      }
    }
    this.poll = setInterval(() => this.refresh(), pollMs);
    this.poll.unref();
  }

  stop() {
    this.watcher?.close();
    clearInterval(this.poll);
  }

  /** A hook event named this transcript: follow it (and its session's sub-agent transcripts). */
  follow(path: string) {
    const real = allowedTranscript(this.root, path);
    if (!real) return;
    // a sub-agent transcript lives in <session>/subagents/; follow the whole session folder
    const sessionDir = basename(dirname(real)) === "subagents" ? dirname(dirname(real)) : real.replace(/\.jsonl$/, "");
    this.sessionDirs.add(sessionDir);
    if (!this.followed.has(real)) {
      this.followed.add(real);
      this.read(real);
    }
    this.scanSubagents(sessionDir);
  }

  private onFileEvent(path: string) {
    if (this.followed.has(path)) return this.read(path);
    const dir = dirname(path);
    if (basename(dir) === "subagents" && this.sessionDirs.has(dirname(dir))) {
      this.followed.add(path);
      this.read(path);
    }
  }

  private scanSubagents(sessionDir: string) {
    const dir = join(sessionDir, "subagents");
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const p = join(dir, name);
      if (!this.followed.has(p)) {
        this.followed.add(p);
        this.read(p);
      }
    }
  }

  /** Re-reads followed transcripts and picks up new sub-agent files. */
  refresh() {
    for (const dir of this.sessionDirs) this.scanSubagents(dir);
    for (const p of this.followed) this.read(p);
  }

  /** Reads what's new in one transcript. Returns how many new messages were counted. */
  read(path: string): number {
    let added = 0;
    try {
      const { records, next } = readIncrement(path, this.db.getOffset(path));
      for (const r of records) {
        if (this.db.insertUsage(r)) {
          this.apply(r);
          added++;
        }
      }
      this.db.setOffset(path, next);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.log(`failed to read transcript ${path}`, err);
    }
    if (added) this.onChange();
    return added;
  }

  /** Scans every transcript under the projects folder (past sessions too). Safe to repeat. */
  importAll(): { files: number; added: number } {
    let files = 0;
    let added = 0;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p, { throwIfNoEntry: false });
        if (!st) continue;
        if (st.isDirectory()) walk(p);
        else if (name.endsWith(".jsonl")) {
          files++;
          added += this.read(p);
        }
      }
    };
    if (existsSync(this.root)) walk(this.root);
    return { files, added };
  }

  private apply(r: UsageRecord) {
    const cost = addSessionUsage(this.snapshot.sessions, r, this.models);

    const hour = Math.floor(r.ts / HOUR);
    const newest = Math.floor(Date.now() / HOUR);
    if (hour > newest - HOURS_KEPT) {
      const h = (this.snapshot.hours[hour] ??= { tokens: ZERO_TOKENS, cost: 0 });
      h.tokens = addTokens(h.tokens, r.tokens);
      h.cost += cost;
    }
    for (const k of Object.keys(this.snapshot.hours)) if (Number(k) <= newest - HOURS_KEPT) delete this.snapshot.hours[k];
  }
}
