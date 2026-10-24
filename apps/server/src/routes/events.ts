import type { FastifyInstance } from "fastify";
import { OfficeEventSchema, type OfficeEvent, type SessionState } from "@ai-office/shared";
import type { EventStore } from "../store";
import type { SessionRegistry } from "../sessions";

export function registerEventRoutes(
  app: FastifyInstance,
  store: EventStore,
  sessions: SessionRegistry,
  broadcast: (event: OfficeEvent, session: SessionState) => void,
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
      store.add(event);
      broadcast(event, sessions.apply(event));
      app.log.debug({ event: event.event, tool: event.tool }, "event");
    } catch (err) {
      // Already replied, so this would otherwise vanish; log enough to reproduce.
      app.log.error({ err, event: event.event, sessionId: event.sessionId, eventId: event.id }, "failed to apply event");
    }
  });
}
