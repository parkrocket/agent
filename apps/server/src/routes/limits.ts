import type { FastifyInstance } from "fastify";
import { PlanLimitsSchema, mergeLimits, type PlanLimits } from "@ai-office/shared";
import type { EventDb } from "../db";

/**
 * `POST /limits` from the status line script: plan rate limits (numbers only).
 * Every session reports, idle ones with stale numbers, so reports are merged
 * window by window (`mergeLimits`) rather than the latest one winning.
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
    const current = deps.current();
    const merged = mergeLimits(current, parsed.data);
    if (merged === current) return;
    try {
      deps.db.setLimits(merged);
      deps.set(merged);
    } catch (err) {
      app.log.error({ err }, "failed to store limits");
    }
  });
}
