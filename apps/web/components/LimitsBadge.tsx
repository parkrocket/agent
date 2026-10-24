"use client";

import { useEffect, useState } from "react";
import type { PlanLimits } from "@ai-office/shared";
import { STALE_MS, limitRows, reportedText } from "@/lib/limits";
import styles from "./LimitsBadge.module.css";

/** Re-renders every 30 s so countdowns and "초기화됨" stay current between reports. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Header badge: plan usage of the 5-hour and weekly windows. Hidden until the status line has reported. */
export function LimitsBadge({ limits }: { limits: PlanLimits | null }) {
  const now = useNow();
  if (!limits) return null;
  const rows = limitRows(limits, now);
  const stale = now - limits.ts > STALE_MS;
  const title = [
    ...rows.map((r) => `${r.label} 한도 ${Math.round(r.pct)}% · ${r.resetText}`),
    `${reportedText(limits, now)} (Claude Code 상태 줄이 보고)`,
  ].join("\n");
  return (
    <span className={`${styles.badge} ${stale ? styles.stale : ""}`} title={title} data-testid="limits-badge">
      {rows.map((r) => (
        <span key={r.key} className={`${styles.item} ${styles[r.level]}`}>
          <span className={styles.label}>{r.label}</span>
          <span className={styles.bar} aria-hidden>
            <span style={{ width: `${Math.min(100, r.pct)}%` }} />
          </span>
          <b>{r.reset ? "—" : `${Math.round(r.pct)}%`}</b>
          <span className={styles.reset}>{r.resetText}</span>
        </span>
      ))}
    </span>
  );
}
