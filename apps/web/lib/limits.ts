import { limitLevel, windowAt, type LimitLevel, type PlanLimits } from "@ai-office/shared";
import { formatDuration } from "./format";

const pad = (n: number) => String(n).padStart(2, "0");

/** A report older than this is shown dimmed: no session has run the status line for a while. */
export const STALE_MS = 15 * 60_000;

export interface LimitRow {
  key: "fiveHour" | "sevenDay";
  label: string;
  pct: number;
  level: LimitLevel;
  /** "1시간 12분 후 초기화", "수 08:09 초기화", or "초기화됨" once the reset time has passed. */
  resetText: string;
  reset: boolean;
}

/** "수 08:09" */
function weekdayTime(ts: number): string {
  const d = new Date(ts);
  return `${"일월화수목금토"[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The 5-hour and weekly windows as of `now`, for the header badge and the usage panel. */
export function limitRows(limits: PlanLimits, now: number): LimitRow[] {
  const rows: LimitRow[] = [];
  const five = windowAt(limits.fiveHour, now);
  if (five)
    rows.push({
      key: "fiveHour",
      label: "5시간",
      pct: five.pct,
      level: limitLevel(five.pct),
      resetText: five.reset ? "초기화됨" : `${formatDuration(five.resetsAt - now)} 후 초기화`,
      reset: five.reset,
    });
  const week = windowAt(limits.sevenDay, now);
  if (week)
    rows.push({
      key: "sevenDay",
      label: "주간",
      pct: week.pct,
      level: limitLevel(week.pct),
      resetText: week.reset ? "초기화됨" : `${weekdayTime(week.resetsAt)} 초기화`,
      reset: week.reset,
    });
  return rows;
}

/** "방금 기준", "12분 전 기준" */
export function reportedText(limits: PlanLimits, now: number): string {
  const ago = now - limits.ts;
  return ago < 60_000 ? "방금 기준" : `${formatDuration(ago)} 전 기준`;
}
