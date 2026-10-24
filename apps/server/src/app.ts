import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { MAX_RECENT_EVENTS, type ModelConfig } from "@ai-office/shared";
import { EventDb } from "./db";
import { EventStore } from "./store";
import { OfficeRegistry } from "./office";
import { registerWs } from "./ws";
import { registerEventRoutes } from "./routes/events";
import { registerHistoryRoutes } from "./routes/history";
import { loadModelConfig } from "./usage/models";
import { projectsRoot } from "./usage/paths";
import { UsageTracker } from "./usage/tracker";

export interface ServerOptions {
  dbPath: string;
  offDutyMs: number;
  retentionMs: number;
  webOrigins: string[];
  sweepIntervalMs?: number;
  purgeIntervalMs?: number;
  /** Claude Code transcripts folder; defaults to ~/.claude/projects. */
  projectsRoot?: string;
  /** Context limits and prices; defaults to config/models.default.json merged with the user's file. */
  models?: ModelConfig;
  /** How long per-message usage is kept (default 90 days). */
  usageRetentionMs?: number;
  /** How often followed transcripts are re-checked in case a file event was missed. */
  usagePollMs?: number;
  logLevel?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

/** Builds the app and restores state from SQLite; the caller decides whether to listen. */
export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const app = Fastify({ logger: { level: opts.logLevel ?? "warn" }, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: opts.webOrigins });
  await app.register(websocket);

  const db = new EventDb(opts.dbPath);
  const store = new EventStore();
  const office = new OfficeRegistry();

  // Restore: drop expired events, replay the rest, send idle sessions home.
  const purged = db.purgeBefore(now() - opts.retentionMs);
  let replayed = 0;
  for (const event of db.all()) {
    office.apply(event);
    replayed++;
  }
  for (const event of db.recent(MAX_RECENT_EVENTS)) store.add(event);
  office.sweep(now(), opts.offDutyMs);
  office.compact(); // no clients yet, so closing pod holes can't make anyone jump seats
  app.log.info({ dbPath: opts.dbPath, replayed, purged }, "restored office state");

  // Usage from transcripts: numbers only, broadcast at most once a second.
  const models = opts.models ?? loadModelConfig();
  const usageRetentionMs = opts.usageRetentionMs ?? 90 * 24 * 60 * 60_000;
  db.purgeUsageBefore(now() - usageRetentionMs);
  let usageTimer: NodeJS.Timeout | undefined;
  const usage = new UsageTracker(
    db,
    models,
    opts.projectsRoot ?? projectsRoot(),
    () => {
      usageTimer ??= setTimeout(() => {
        usageTimer = undefined;
        ws.broadcastUsage(usage.current);
      }, 1_000);
    },
    (msg, err) => app.log.warn({ err }, msg),
  );

  const ws = registerWs(app, store, office, { offDutyMs: opts.offDutyMs, models }, opts.webOrigins, () => usage.current);
  registerEventRoutes(app, {
    db,
    store,
    office,
    broadcast: (event, update) => ws.broadcastEvent(event, update),
    onTranscript: (path) => usage.follow(path),
  });
  registerHistoryRoutes(app, { db, office });
  app.get("/health", async () => ({ ok: true }));
  // Past transcripts (including sessions from before the hooks were installed) into the usage stats.
  app.post("/usage/import", async () => usage.importAll());

  // Resume following the transcripts of sessions seen before a restart.
  const transcripts = new Set<string>();
  for (const event of store.recent()) if (event.transcript) transcripts.add(event.transcript);
  for (const s of Object.values(office.state.sessions)) if (!s.offDuty) for (const e of db.recentForSession(s.sessionId)) if (e.transcript) transcripts.add(e.transcript);
  for (const path of transcripts) usage.follow(path);
  usage.start(opts.usagePollMs);

  const sweepTimer = setInterval(() => {
    if (office.sweep(now(), opts.offDutyMs)) ws.broadcastState(office.state);
  }, opts.sweepIntervalMs ?? 30_000);
  const purgeTimer = setInterval(() => {
    try {
      db.purgeBefore(now() - opts.retentionMs);
      db.purgeUsageBefore(now() - usageRetentionMs);
    } catch (err) {
      app.log.error({ err }, "failed to purge old events");
    }
  }, opts.purgeIntervalMs ?? 60 * 60_000);
  sweepTimer.unref();
  purgeTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(sweepTimer);
    clearInterval(purgeTimer);
    clearTimeout(usageTimer);
    usage.stop();
    db.close();
  });
  return app;
}
