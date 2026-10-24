import type { FastifyInstance } from "fastify";
import { dirName, type HistoryEvents, type HistoryList } from "@ai-office/shared";
import type { EventDb } from "../db";
import type { OfficeRegistry } from "../office";


/** Past sessions for replay. Read-only; the live office state is never touched. */
export function registerHistoryRoutes(app: FastifyInstance, deps: { db: EventDb; office: OfficeRegistry }) {
  app.get("/history", async (): Promise<HistoryList> => {
    const live = deps.office.state.sessions;
    return {
      sessions: deps.db.historySessions().map((s) => ({
        ...s,
        ...(s.project || !s.cwd ? {} : { project: dirName(s.cwd) }),
        replayable: s.events > 0,
        live: !!live[s.sessionId] && !live[s.sessionId]!.offDuty,
      })),
    };
  });

  app.get<{ Params: { sessionId: string } }>(
    "/history/:sessionId/events",
    { schema: { params: { type: "object", properties: { sessionId: { type: "string", minLength: 1, maxLength: 256 } }, required: ["sessionId"] } } },
    async (request, reply): Promise<HistoryEvents | void> => {
      const { sessionId } = request.params;
      const events = deps.db.sessionEvents(sessionId);
      if (!events.length) return reply.code(404).send({ error: "no events for this session" });
      return { events, usage: deps.db.sessionUsage(sessionId) };
    },
  );
}
