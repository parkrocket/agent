"use client";

import { useEffect, useRef, useState } from "react";
import type { OfficeEvent } from "@ai-office/shared";
import { formatAgent, formatSummary, formatTime, needsAttention } from "@/lib/format";
import styles from "./EventLog.module.css";

export function EventLog({
  events,
  title = "이벤트 로그",
  scopeLabel,
  inScope,
  onClear,
  emptyText,
  collapsed,
  onToggleCollapsed,
}: {
  events: OfficeEvent[];
  title?: string;
  /** Label for the "only this room" filter; omitted in the lobby, where there's no single room. */
  scopeLabel?: string;
  inScope?: (e: OfficeEvent) => boolean;
  /** Omitted when there is nothing to clear (a replay shows its own events), which hides the button. */
  onClear?: () => void;
  emptyText: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [onlyScope, setOnlyScope] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const shown = onlyScope && inScope ? events.filter(inScope) : events;

  useEffect(() => {
    const el = logRef.current;
    if (autoScroll && el) el.scrollTop = el.scrollHeight;
  }, [shown, autoScroll]);

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h2>{title}</h2>
        <button onClick={onToggleCollapsed} aria-expanded={!collapsed}>
          {collapsed ? "▴ 펼치기" : "▾ 접기"}
        </button>
        {scopeLabel && (
          <label className={styles.toggle}>
            <input type="checkbox" checked={onlyScope} onChange={(e) => setOnlyScope(e.target.checked)} />
            {scopeLabel}
          </label>
        )}
        <label className={styles.toggle}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          자동 스크롤
        </label>
        {onClear && <button onClick={onClear}>지우기</button>}
      </header>
      <div className={styles.log} ref={logRef} hidden={collapsed}>
        {shown.length === 0 && <p className={styles.empty}>{emptyText}</p>}
        {shown.map((e) => (
          <div
            key={e.id}
            className={[
              styles.line,
              needsAttention(e) ? styles.attention : "",
              e.event === "PostToolUseFailure" ? styles.failure : "",
              e.agent.kind === "sub" ? styles.sub : "",
              !inScope || inScope(e) ? "" : styles.otherSession,
            ].join(" ")}
          >
            <span className={styles.time}>{formatTime(e.ts)}</span>
            <span className={styles.project} title={e.cwd}>{e.project}</span>
            <span className={styles.session}>{e.sessionId.slice(0, 8)}</span>
            <span className={styles.agent}>{formatAgent(e)}</span>
            <span className={styles.event}>{e.event}</span>
            <span>{formatSummary(e)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
