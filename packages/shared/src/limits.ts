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

/**
 * Resets closer than this are the same window. A new window only starts after
 * the old one resets, so its reset is at least ~5 hours (or a week) later.
 */
const SAME_WINDOW_MS = 30 * 60_000;

type WindowKey = "fiveHour" | "sevenDay";
const WINDOW_KEYS: WindowKey[] = ["fiveHour", "sevenDay"];

/** -1: `next` is stale (older window, or lower usage in the same one), 0: same, 1: newer. */
function compareWindow(prev: LimitWindow, next: LimitWindow): -1 | 0 | 1 {
  if (next.resetsAt > prev.resetsAt + SAME_WINDOW_MS) return 1;
  if (next.resetsAt < prev.resetsAt - SAME_WINDOW_MS) return -1;
  return next.usedPercentage > prev.usedPercentage ? 1 : next.usedPercentage < prev.usedPercentage ? -1 : 0;
}

/**
 * Folds a status line report into the current limits, window by window.
 *
 * Each Claude Code session reports what it got with its own last API
 * response, and an idle session keeps re-sending that (with a fresh `ts`, and
 * minus any window whose reset has passed). So the newest report is not the
 * newest data. Usage within a window only grows, which gives a total order:
 * a later window wins, then higher usage in the same window. A window missing
 * from the report is kept. `ts` advances only when the report agrees with or
 * improves on every window it carries, so a stale session can't make old data
 * look fresh. Returns `prev` itself when nothing changed. Pure.
 */
export function mergeLimits(prev: PlanLimits | null, next: PlanLimits): PlanLimits {
  if (!prev) return next;
  const merged: PlanLimits = { ...prev };
  let changed = false;
  let stale = false;
  for (const key of WINDOW_KEYS) {
    const n = next[key];
    if (!n) continue;
    const p = prev[key];
    const order = p ? compareWindow(p, n) : 1;
    if (order < 0) stale = true;
    if (order > 0) {
      merged[key] = n;
      changed = true;
    }
  }
  if (!stale && next.ts > prev.ts) {
    merged.ts = next.ts;
    changed = true;
  }
  return changed ? merged : prev;
}

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
