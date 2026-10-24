import type { FastifyInstance } from "fastify";
import { OfficeEventSchema, SUPPORTED_EVENT_VERSIONS, type OfficeEvent, type OfficeUpdate } from "@ai-office/shared";
import type { EventDb } from "../db";
import type { EventStore } from "../store";
import type { OfficeRegistry } from "../office";
import type { RejectionStats } from "../rejections";

export function registerEventRoutes(
  app: FastifyInstance,
  deps: {
    db: EventDb;
    store: EventStore;
    office: OfficeRegistry;
    broadcast: (event: OfficeEvent, update: OfficeUpdate) => void;
    /** Called with each event's transcript path (after replying) so usage can be read from it. */
    onTranscript?: (path: string) => void;
    rejected: RejectionStats;
  },
) {
  const warnedVersions = new Set<unknown>();
  app.post("/events", async (request, reply) => {
    // Version first: a hook from another checkout fails with a clear reason instead of a schema error.
    const v = (request.body as { v?: unknown } | null)?.v;
    if (typeof v !== "number" || !SUPPORTED_EVENT_VERSIONS.includes(v)) {
      Object.assign(deps.rejected.version, { count: deps.rejected.version.count + 1, lastAt: Date.now(), lastVersion: v });
      if (!warnedVersions.has(v)) {
        warnedVersions.add(v);
        app.log.warn({ v, supported: SUPPORTED_EVENT_VERSIONS }, "rejected events with an unsupported version; reinstall the hook (pnpm hooks:install)");
      }
      return reply.code(400).send({ error: "unsupported_version", version: v ?? null, supported: SUPPORTED_EVENT_VERSIONS });
    }
    const parsed = OfficeEventSchema.safeParse(request.body);
    if (!parsed.success) {
      Object.assign(deps.rejected.schema, { count: deps.rejected.schema.count + 1, lastAt: Date.now() });
      return reply.code(400).send({ error: "invalid event", issues: parsed.error.issues });
    }
    // Reply before processing so the hook never waits on us.
    reply.code(204).send();
    const event = parsed.data;
    try {
      deps.db.insert(event);
      deps.store.add(event);
      deps.broadcast(event, deps.office.apply(event));
      app.log.debug({ event: event.event, tool: event.tool }, "event");
      if (event.transcript && deps.onTranscript) {
        const path = event.transcript;
        setImmediate(() => {
          try {
            deps.onTranscript!(path);
          } catch (err) {
            app.log.error({ err, sessionId: event.sessionId }, "failed to follow transcript");
          }
        });
      }
    } catch (err) {
      // Already replied, so this would otherwise vanish; log enough to reproduce.
      app.log.error({ err, event: event.event, sessionId: event.sessionId, eventId: event.id }, "failed to apply event");
    }
  });
}
