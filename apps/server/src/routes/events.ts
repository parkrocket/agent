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
    reply.code(204).send();
    store.add(parsed.data);
    broadcast(parsed.data, sessions.apply(parsed.data));
    app.log.debug({ event: parsed.data.event, tool: parsed.data.tool }, "event");
  });
}
