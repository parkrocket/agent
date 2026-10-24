import type { FastifyInstance } from "fastify";
import { PlanLimitsSchema, type PlanLimits } from "@ai-office/shared";
import type { EventDb } from "../db";

/**
 * `POST /limits` from the status line script: plan rate limits (numbers only).
 * Account-wide, so only the newest report is kept; an older one arriving late is dropped.
 */
export function registerLimitsRoutes(
  app: FastifyInstance,
  deps: { db: EventDb; current: () => PlanLimits | null; set: (limits: PlanLimits) => void },
) {
  app.post("/limits", async (request, reply) => {
    const parsed = PlanLimitsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid limits", issues: parsed.error.issues });
    // Reply before processing so the status line never waits on us.
    reply.code(204).send();
    const limits = parsed.data;
    if ((deps.current()?.ts ?? -Infinity) >= limits.ts) return;
    try {
      deps.db.setLimits(limits);
      deps.set(limits);
    } catch (err) {
      app.log.error({ err }, "failed to store limits");
    }
  });
}
