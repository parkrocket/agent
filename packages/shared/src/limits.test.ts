import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLimits, windowAt, type PlanLimits } from "./limits";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = 1_800_000_000_000;
const FIVE_RESET = T + 3 * HOUR;
const WEEK_RESET = T + 3 * DAY;

const report = (ts: number, w: Partial<Pick<PlanLimits, "fiveHour" | "sevenDay">>): PlanLimits => ({ v: 1, ts, ...w });

test("an idle session's stale report doesn't flip the display (what happened with two sessions)", () => {
  // active session: fresh numbers for both windows
  const active = report(T, { fiveHour: { usedPercentage: 74, resetsAt: FIVE_RESET }, sevenDay: { usedPercentage: 91, resetsAt: WEEK_RESET } });
  // idle session, a minute later: hours-old weekly number, its 5-hour window already dropped
  const idle = report(T + MIN, { sevenDay: { usedPercentage: 72, resetsAt: WEEK_RESET } });

  let state = mergeLimits(null, active);
  for (let i = 0; i < 3; i++) {
    state = mergeLimits(state, idle);
    state = mergeLimits(state, { ...active, ts: active.ts });
  }
  assert.deepEqual(state, active, "both windows stay, with the higher (current) usage");
  assert.equal(mergeLimits(active, idle), active, "a stale report changes nothing (same object, no broadcast)");
});

test("higher usage in the same window and a later window both win; ts advances only on agreeing reports", () => {
  const base = report(T, { fiveHour: { usedPercentage: 10, resetsAt: FIVE_RESET }, sevenDay: { usedPercentage: 50, resetsAt: WEEK_RESET } });

  const more = mergeLimits(base, report(T + MIN, { fiveHour: { usedPercentage: 12, resetsAt: FIVE_RESET + 1000 } }));
  assert.deepEqual(more.fiveHour, { usedPercentage: 12, resetsAt: FIVE_RESET + 1000 });
  assert.deepEqual(more.sevenDay, base.sevenDay, "a window missing from the report is kept");
  assert.equal(more.ts, T + MIN);

  // the same numbers again just refresh "reported N minutes ago"
  const confirmed = mergeLimits(more, report(T + 2 * MIN, { fiveHour: { usedPercentage: 12, resetsAt: FIVE_RESET } }));
  assert.equal(confirmed.ts, T + 2 * MIN);
  assert.deepEqual(confirmed.fiveHour, more.fiveHour);

  // after the reset, a new window starts low but is newer
  const next = mergeLimits(confirmed, report(FIVE_RESET + MIN, { fiveHour: { usedPercentage: 1, resetsAt: FIVE_RESET + 5 * HOUR } }));
  assert.deepEqual(next.fiveHour, { usedPercentage: 1, resetsAt: FIVE_RESET + 5 * HOUR });

  // a report from the old window arriving afterwards is ignored, and doesn't refresh ts
  const late = report(FIVE_RESET + 2 * MIN, { fiveHour: { usedPercentage: 12, resetsAt: FIVE_RESET } });
  assert.equal(mergeLimits(next, late), next);

  // mixed: newer weekly but stale 5-hour → takes the weekly, ts stays
  const mixed = mergeLimits(next, report(FIVE_RESET + 3 * MIN, { fiveHour: { usedPercentage: 0.5, resetsAt: FIVE_RESET + 5 * HOUR }, sevenDay: { usedPercentage: 60, resetsAt: WEEK_RESET } }));
  assert.equal(mixed.sevenDay!.usedPercentage, 60);
  assert.equal(mixed.fiveHour!.usedPercentage, 1);
  assert.equal(mixed.ts, next.ts);
});

test("windowAt: a passed reset reads as 0% and reset", () => {
  const w = { usedPercentage: 80, resetsAt: T };
  assert.deepEqual(windowAt(w, T - 1), { pct: 80, resetsAt: T, reset: false });
  assert.deepEqual(windowAt(w, T), { pct: 0, resetsAt: T, reset: true });
  assert.equal(windowAt(undefined, T), undefined);
});
