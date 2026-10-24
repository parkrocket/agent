import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { OfficeEventSchema, PlanLimitsSchema, ZERO_TOKENS, type OfficeEvent, type PlanLimits, type TokenCounts, type UsageRecord } from "@ai-office/shared";
import type { ReadPosition } from "./usage/reader";

/** Default DB location, outside the repo: $XDG_DATA_HOME/ai-office or ~/.local/share/ai-office. */
export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "ai-office", "events.db");
}

/** Sanitized events persisted in SQLite (built-in node:sqlite, no native build). */
export class EventDb {
  private readonly db: DatabaseSync;
  private readonly insertStmt: StatementSync;
  private readonly usageStmt: StatementSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
      CREATE INDEX IF NOT EXISTS events_session ON events (session_id, ts);

      -- token usage per API message (numbers and ids only; never transcript text)
      CREATE TABLE IF NOT EXISTS usage_messages (
        message_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        model TEXT NOT NULL,
        ts INTEGER NOT NULL,
        cwd TEXT,
        input INTEGER NOT NULL,
        output INTEGER NOT NULL,
        cache_read INTEGER NOT NULL,
        cache_write_5m INTEGER NOT NULL,
        cache_write_1h INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_ts ON usage_messages (ts);
      CREATE INDEX IF NOT EXISTS usage_session ON usage_messages (session_id, ts);

      -- how far each transcript has been read
      CREATE TABLE IF NOT EXISTS transcript_offsets (
        path TEXT PRIMARY KEY,
        offset INTEGER NOT NULL,
        ino INTEGER NOT NULL
      );

      -- small single values that should survive a restart (e.g. the latest plan limits)
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );
    `);
    this.insertStmt = this.db.prepare("INSERT OR IGNORE INTO events (id, ts, session_id, json) VALUES (?, ?, ?, ?)");
    this.usageStmt = this.db.prepare(
      `INSERT OR IGNORE INTO usage_messages
       (message_id, session_id, agent_id, model, ts, cwd, input, output, cache_read, cache_write_5m, cache_write_1h)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  insert(e: OfficeEvent): void {
    this.insertStmt.run(e.id, e.ts, e.sessionId, JSON.stringify(e));
  }

  /** Deletes events older than `ts`; returns how many were removed. */
  purgeBefore(ts: number): number {
    return Number(this.db.prepare("DELETE FROM events WHERE ts < ?").run(ts).changes);
  }

  /** All stored events in time order, for replay. Rows that no longer match the schema are skipped. */
  *all(): Generator<OfficeEvent> {
    for (const row of this.db.prepare("SELECT json FROM events ORDER BY ts, rowid").iterate()) {
      const parsed = parse(row);
      if (parsed) yield parsed;
    }
  }

  /** One session's most recent events (newest first), for finding its transcript path. */
  recentForSession(sessionId: string, limit = 20): OfficeEvent[] {
    const rows = this.db.prepare("SELECT json FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?").all(sessionId, limit);
    return rows.flatMap((row) => parse(row) ?? []);
  }

  /** The latest `limit` events, oldest first. */
  recent(limit: number): OfficeEvent[] {
    const rows = this.db
      .prepare("SELECT json FROM (SELECT json, ts, rowid FROM events ORDER BY ts DESC, rowid DESC LIMIT ?) ORDER BY ts, rowid")
      .all(limit);
    return rows.flatMap((row) => parse(row) ?? []);
  }

  count(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n);
  }

  /** Stores one message's usage; false when that message id was already counted. */
  insertUsage(r: UsageRecord): boolean {
    const t = r.tokens;
    const res = this.usageStmt.run(
      r.messageId,
      r.sessionId,
      r.agentId ?? null,
      r.model,
      r.ts,
      r.cwd ?? null,
      t.input,
      t.output,
      t.cacheRead,
      t.cacheWrite5m,
      t.cacheWrite1h,
    );
    return Number(res.changes) > 0;
  }

  /** All stored usage, oldest first. */
  *allUsage(): Generator<UsageRecord> {
    for (const row of this.db.prepare("SELECT * FROM usage_messages ORDER BY ts").iterate()) yield usageRow(row);
  }

  /** One session's stored events in time order, for replay. */
  sessionEvents(sessionId: string): OfficeEvent[] {
    const rows = this.db.prepare("SELECT json FROM events WHERE session_id = ? ORDER BY ts, rowid").all(sessionId);
    return rows.flatMap((row) => parse(row) ?? []);
  }

  /** One session's per-message usage (lead and staff) in time order. */
  sessionUsage(sessionId: string): UsageRecord[] {
    return this.db.prepare("SELECT * FROM usage_messages WHERE session_id = ? ORDER BY ts").all(sessionId).map(usageRow);
  }

  /**
   * Past sessions, newest first: hook events (when kept) joined with transcript
   * usage. Sessions known only from usage have `events: 0`.
   */
  historySessions(limit = 200): SessionSummary[] {
    const byId = new Map<string, SessionSummary>();
    const events = this.db
      .prepare(
        `SELECT session_id, MIN(ts) AS first, MAX(ts) AS last, COUNT(*) AS n,
                (SELECT json_extract(json, '$.cwd') FROM events e2 WHERE e2.session_id = e.session_id ORDER BY ts LIMIT 1) AS cwd,
                (SELECT json_extract(json, '$.project') FROM events e2 WHERE e2.session_id = e.session_id ORDER BY ts LIMIT 1) AS project
         FROM events e GROUP BY session_id`,
      )
      .all() as { session_id: string; first: number; last: number; n: number; cwd: string | null; project: string | null }[];
    for (const r of events) {
      byId.set(r.session_id, {
        sessionId: r.session_id,
        ...(r.cwd ? { cwd: r.cwd } : {}),
        ...(r.project ? { project: r.project } : {}),
        startedAt: Number(r.first),
        endedAt: Number(r.last),
        events: Number(r.n),
        tokens: ZERO_TOKENS,
      });
    }
    const usage = this.db
      .prepare(
        `SELECT session_id, MIN(ts) AS first, MAX(ts) AS last,
                MIN(CASE WHEN agent_id IS NULL THEN cwd END) AS cwd,
                SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cache_read,
                SUM(cache_write_5m) AS cache_write_5m, SUM(cache_write_1h) AS cache_write_1h
         FROM usage_messages GROUP BY session_id`,
      )
      .all() as Record<string, string | number | null>[];
    for (const r of usage) {
      const id = String(r.session_id);
      const tokens: TokenCounts = {
        input: Number(r.input),
        output: Number(r.output),
        cacheRead: Number(r.cache_read),
        cacheWrite5m: Number(r.cache_write_5m),
        cacheWrite1h: Number(r.cache_write_1h),
      };
      const s = byId.get(id);
      if (s) {
        s.tokens = tokens;
        s.startedAt = Math.min(s.startedAt, Number(r.first));
        s.endedAt = Math.max(s.endedAt, Number(r.last));
      } else {
        byId.set(id, {
          sessionId: id,
          ...(r.cwd ? { cwd: String(r.cwd) } : {}),
          startedAt: Number(r.first),
          endedAt: Number(r.last),
          events: 0,
          tokens,
        });
      }
    }
    return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  purgeUsageBefore(ts: number): number {
    return Number(this.db.prepare("DELETE FROM usage_messages WHERE ts < ?").run(ts).changes);
  }

  getOffset(path: string): ReadPosition | undefined {
    const row = this.db.prepare("SELECT offset, ino FROM transcript_offsets WHERE path = ?").get(path) as
      | { offset: number; ino: number }
      | undefined;
    return row ? { offset: Number(row.offset), ino: Number(row.ino) } : undefined;
  }

  setOffset(path: string, pos: ReadPosition): void {
    this.db
      .prepare("INSERT INTO transcript_offsets (path, offset, ino) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, ino = excluded.ino")
      .run(path, pos.offset, pos.ino);
  }

  /** Latest plan limits report, or null (none yet, or a row the schema no longer accepts). */
  getLimits(): PlanLimits | null {
    const row = this.db.prepare("SELECT json FROM kv WHERE key = 'limits'").get() as { json: string } | undefined;
    if (!row) return null;
    try {
      const parsed = PlanLimitsSchema.safeParse(JSON.parse(row.json));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  setLimits(limits: PlanLimits): void {
    this.db.prepare("INSERT INTO kv (key, json) VALUES ('limits', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json").run(JSON.stringify(limits));
  }

  close(): void {
    this.db.close();
  }
}

export interface SessionSummary {
  sessionId: string;
  cwd?: string;
  project?: string;
  startedAt: number;
  endedAt: number;
  events: number;
  tokens: TokenCounts;
}

function usageRow(row: unknown): UsageRecord {
  const r = row as Record<string, string | number | null>;
  return {
    messageId: String(r.message_id),
    sessionId: String(r.session_id),
    ...(r.agent_id ? { agentId: String(r.agent_id) } : {}),
    model: String(r.model),
    ts: Number(r.ts),
    ...(r.cwd ? { cwd: String(r.cwd) } : {}),
    tokens: {
      input: Number(r.input),
      output: Number(r.output),
      cacheRead: Number(r.cache_read),
      cacheWrite5m: Number(r.cache_write_5m),
      cacheWrite1h: Number(r.cache_write_1h),
    },
  };
}

function parse(row: unknown): OfficeEvent | undefined {
  try {
    const result = OfficeEventSchema.safeParse(JSON.parse((row as { json: string }).json));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
