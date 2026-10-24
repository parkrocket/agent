"use client";

import { useEffect, useRef, useState } from "react";
import type { OfficeEvent } from "@ai-office/shared";
import { formatAgent, formatSummary, formatTime, needsAttention } from "@/lib/format";
import styles from "./EventLog.module.css";

export function EventLog({
  events,
  currentSessionId,
  onClear,
  emptyText,
}: {
  events: OfficeEvent[];
  currentSessionId?: string;
  onClear: () => void;
  emptyText: string;
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const shown = onlyCurrent && currentSessionId ? events.filter((e) => e.sessionId === currentSessionId) : events;

  useEffect(() => {
    const el = logRef.current;
    if (autoScroll && el) el.scrollTop = el.scrollHeight;
  }, [shown, autoScroll]);

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <h2>이벤트 로그</h2>
        <label className={styles.toggle}>
          <input type="checkbox" checked={onlyCurrent} onChange={(e) => setOnlyCurrent(e.target.checked)} />
          현재 세션만
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          자동 스크롤
        </label>
        <button onClick={onClear}>지우기</button>
      </header>
      <div className={styles.log} ref={logRef}>
        {shown.length === 0 && <p className={styles.empty}>{emptyText}</p>}
        {shown.map((e) => (
          <div
            key={e.id}
            className={[
              styles.line,
              needsAttention(e) ? styles.attention : "",
              e.event === "PostToolUseFailure" ? styles.failure : "",
              e.agent.kind === "sub" ? styles.sub : "",
              e.sessionId === currentSessionId ? "" : styles.otherSession,
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
