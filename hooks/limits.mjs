/**
 * Plan-limits payload version (PlanLimits.v). Bump together with LIMITS_VERSION
 * in packages/shared/src/limits.ts: the server's strict schema rejects fields
 * it doesn't know.
 */
export const LIMITS_VERSION = 1;

const pct = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const epochSec = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** One rate-limit window, or undefined when either number is missing. */
function limitWindow(w) {
  if (!w || typeof w !== "object") return undefined;
  const usedPercentage = pct(w.used_percentage);
  const resetsAt = epochSec(w.resets_at);
  return usedPercentage === undefined || resetsAt === undefined ? undefined : { usedPercentage, resetsAt: resetsAt * 1000 };
}

/**
 * Builds the plan-limits report from raw status line stdin by copying only the
 * 5-hour and 7-day percentages and reset times. Session ids, paths, model,
 * cost and everything else stay behind. Null when there is nothing to report
 * (API-key users, or before the session's first response).
 */
export function extractLimits(raw, now = Date.now()) {
  const limits = raw && typeof raw === "object" ? raw.rate_limits : undefined;
  if (!limits || typeof limits !== "object") return null;
  const fiveHour = limitWindow(limits.five_hour);
  const sevenDay = limitWindow(limits.seven_day);
  if (!fiveHour && !sevenDay) return null;
  const out = { v: LIMITS_VERSION, ts: now };
  if (fiveHour) out.fiveHour = fiveHour;
  if (sevenDay) out.sevenDay = sevenDay;
  return out;
}

const pad = (n) => String(n).padStart(2, "0");

/** "1시간 12분 후", "8분 후" */
function untilText(ms) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분 후` : `${m}분 후`;
}

/** "수 08:09" */
function weekdayTime(ms) {
  const d = new Date(ms);
  return `${"일월화수목금토"[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Orange from 80%, red from 95% (the office uses the same thresholds). */
function color(p, text) {
  return p >= 95 ? `\x1b[31m${text}\x1b[0m` : p >= 80 ? `\x1b[33m${text}\x1b[0m` : text;
}

/** The one line shown under Claude Code's prompt: model · context · 5-hour · weekly. */
export function statusLine(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return "";
  const parts = [];
  const model = raw.model?.display_name;
  if (typeof model === "string" && model) parts.push(model.slice(0, 40));
  const ctx = pct(raw.context_window?.used_percentage);
  if (ctx !== undefined) parts.push(color(ctx, `ctx ${Math.round(ctx)}%`));
  const limits = extractLimits(raw, now);
  const five = limits?.fiveHour;
  if (five && five.resetsAt > now) parts.push(`${color(five.usedPercentage, `5h ${Math.round(five.usedPercentage)}%`)} (${untilText(five.resetsAt - now)})`);
  const week = limits?.sevenDay;
  if (week && week.resetsAt > now) parts.push(`${color(week.usedPercentage, `주간 ${Math.round(week.usedPercentage)}%`)} (${weekdayTime(week.resetsAt)} 초기화)`);
  return parts.join(" · ");
}
