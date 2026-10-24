import { z } from "zod";

/**
 * Plan rate limits (claude.ai Pro/Max) as Claude Code hands them to the status
 * line: how much of the 5-hour and 7-day windows is used and when each resets.
 * Account-wide, so the office keeps only the latest report from any session.
 * hooks/limits.mjs builds this with the same version; keep the two in step.
 */
export const LIMITS_VERSION = 1;

/** A reset more than this far from the report is not a real window (or a clock gone wrong). */
const MAX_RESET_SKEW_MS = 8 * 24 * 60 * 60_000;

export const LimitWindowSchema = z
  .object({
    /** 0..100; can briefly read above 100. */
    usedPercentage: z.number().min(0).max(1000),
    /** Epoch ms. */
    resetsAt: z.number(),
  })
  .strict();
export type LimitWindow = z.infer<typeof LimitWindowSchema>;

export const PlanLimitsSchema = z
  .object({
    v: z.literal(LIMITS_VERSION),
    /** When the status line ran (epoch ms). */
    ts: z.number(),
    fiveHour: LimitWindowSchema.optional(),
    sevenDay: LimitWindowSchema.optional(),
  })
  .strict()
  .refine((l) => l.fiveHour || l.sevenDay, "no limit window")
  .refine(
    (l) => [l.fiveHour, l.sevenDay].every((w) => !w || Math.abs(w.resetsAt - l.ts) <= MAX_RESET_SKEW_MS),
    "resetsAt out of range",
  );
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export type LimitLevel = "ok" | "warn" | "danger";

/** Same thresholds as the context gauge: orange from 80%, red from 95%. */
export function limitLevel(pct: number): LimitLevel {
  return pct >= 95 ? "danger" : pct >= 80 ? "warn" : "ok";
}

/** A window as of `now`: once its reset time passes, the old percentage no longer applies. */
export function windowAt(w: LimitWindow | undefined, now: number): { pct: number; resetsAt: number; reset: boolean } | undefined {
  if (!w) return undefined;
  return now >= w.resetsAt ? { pct: 0, resetsAt: w.resetsAt, reset: true } : { pct: w.usedPercentage, resetsAt: w.resetsAt, reset: false };
}
