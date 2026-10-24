import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { MAX_RECENT_EVENTS } from "@ai-office/shared";
import { EventDb } from "./db";
import { EventStore } from "./store";
import { OfficeRegistry } from "./office";
import { registerWs } from "./ws";
import { registerEventRoutes } from "./routes/events";

export interface ServerOptions {
  dbPath: string;
  offDutyMs: number;
  retentionMs: number;
  webOrigins: string[];
  sweepIntervalMs?: number;
  purgeIntervalMs?: number;
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

  const ws = registerWs(app, store, office, { offDutyMs: opts.offDutyMs }, opts.webOrigins);
  registerEventRoutes(app, {
    db,
    store,
    office,
    broadcast: (event, update) => ws.broadcastEvent(event, update),
  });
  app.get("/health", async () => ({ ok: true }));

  const sweepTimer = setInterval(() => {
    if (office.sweep(now(), opts.offDutyMs)) ws.broadcastState(office.state);
  }, opts.sweepIntervalMs ?? 30_000);
  const purgeTimer = setInterval(() => {
    try {
      db.purgeBefore(now() - opts.retentionMs);
    } catch (err) {
      app.log.error({ err }, "failed to purge old events");
    }
  }, opts.purgeIntervalMs ?? 60 * 60_000);
  sweepTimer.unref();
  purgeTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(sweepTimer);
    clearInterval(purgeTimer);
    db.close();
  });
  return app;
}
