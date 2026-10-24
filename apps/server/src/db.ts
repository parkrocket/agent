import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { OfficeEventSchema, type OfficeEvent } from "@ai-office/shared";

/** Default DB location, outside the repo: $XDG_DATA_HOME/ai-office or ~/.local/share/ai-office. */
export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(base, "ai-office", "events.db");
}

/** Sanitized events persisted in SQLite (built-in node:sqlite, no native build). */
export class EventDb {
  private readonly db: DatabaseSync;
  private readonly insertStmt: StatementSync;

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
    `);
    this.insertStmt = this.db.prepare("INSERT OR IGNORE INTO events (id, ts, session_id, json) VALUES (?, ?, ?, ?)");
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

  close(): void {
    this.db.close();
  }
}

function parse(row: unknown): OfficeEvent | undefined {
  try {
    const result = OfficeEventSchema.safeParse(JSON.parse((row as { json: string }).json));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
