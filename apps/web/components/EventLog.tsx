"use client";

import { useEffect, useRef, useState } from "react";
import type { OfficeEvent, ServerMessage } from "@ai-office/shared";
import { formatAgent, formatSummary, formatTime, needsAttention } from "@/lib/format";
import styles from "./EventLog.module.css";

const WS_URL = process.env.NEXT_PUBLIC_AI_OFFICE_WS ?? "ws://localhost:7420/ws";
const MAX_LINES = 500;

type Status = "connecting" | "open" | "closed";

export function EventLog() {
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      setStatus("connecting");
      socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        retry = 0;
        setStatus("open");
      };
      socket.onmessage = (msg) => {
        const data = JSON.parse(msg.data as string) as ServerMessage;
        if (data.type === "snapshot") setEvents(data.events.slice(-MAX_LINES));
        else setEvents((prev) => [...prev, data.event].slice(-MAX_LINES));
      };
      socket.onclose = () => {
        setStatus("closed");
        if (disposed) return;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();

    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events, autoScroll]);

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1>AI Office · event log</h1>
        <span className={`${styles.badge} ${styles[status]}`}>{status}</span>
        <label className={styles.toggle}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          자동 스크롤
        </label>
        <button onClick={() => setEvents([])}>지우기</button>
      </header>
      <div className={styles.log}>
        {events.length === 0 && <p className={styles.empty}>이벤트 대기 중… ({WS_URL})</p>}
        {events.map((e) => (
          <div
            key={e.id}
            className={[
              styles.line,
              needsAttention(e) ? styles.attention : "",
              e.event === "PostToolUseFailure" ? styles.failure : "",
              e.agent.kind === "sub" ? styles.sub : "",
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
        <div ref={bottomRef} />
      </div>
    </main>
  );
}
