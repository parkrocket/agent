import type { FastifyInstance } from "fastify";
import { OfficeEventSchema, type OfficeEvent, type OfficeUpdate } from "@ai-office/shared";
import type { EventDb } from "../db";
import type { EventStore } from "../store";
import type { OfficeRegistry } from "../office";

export function registerEventRoutes(
  app: FastifyInstance,
  deps: {
    db: EventDb;
    store: EventStore;
    office: OfficeRegistry;
    broadcast: (event: OfficeEvent, update: OfficeUpdate) => void;
    /** Called with each event's transcript path (after replying) so usage can be read from it. */
    onTranscript?: (path: string) => void;
  },
) {
  app.post("/events", async (request, reply) => {
    const parsed = OfficeEventSchema.safeParse(request.body);
    if (!parsed.success) {
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
