"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { WS_URL, useOfficeSocket } from "@/lib/useOfficeSocket";
import { EventLog } from "./EventLog";
import { AUTO, SessionPicker, sortedSessions } from "./SessionPicker";
import styles from "./OfficeApp.module.css";

const OfficeCanvas = dynamic(() => import("./OfficeCanvas"), { ssr: false });

const PICK_KEY = "ai-office.session";

export function OfficeApp() {
  const { events, sessions, status, clearEvents } = useOfficeSocket();
  const [pick, setPick] = useState(AUTO);

  useEffect(() => {
    try {
      setPick(localStorage.getItem(PICK_KEY) ?? AUTO);
    } catch {}
  }, []);

  const choose = (value: string) => {
    setPick(value);
    try {
      localStorage.setItem(PICK_KEY, value);
    } catch {}
  };

  // "Auto" follows the most recently active session; a pinned one stays put.
  const pinned = pick !== AUTO ? sessions[pick] : undefined;
  const session = pinned ?? sortedSessions(sessions)[0];

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1>AI Office</h1>
        <SessionPicker sessions={sessions} value={pinned ? pick : AUTO} onChange={choose} />
        {session && (
          <span className={styles.where} title={session.cwd}>
            📁 {session.project}
          </span>
        )}
        <span className={`${styles.badge} ${styles[status]}`}>{status}</span>
      </header>
      <div className={styles.office}>
        <OfficeCanvas session={session} />
      </div>
      <div className={styles.log}>
        <EventLog
          events={events}
          currentSessionId={session?.sessionId}
          onClear={clearEvents}
          emptyText={`이벤트 대기 중… (${WS_URL})`}
        />
      </div>
    </main>
  );
}
