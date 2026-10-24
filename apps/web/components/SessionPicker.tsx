"use client";

import type { SessionMap } from "@ai-office/shared";
import { STATUS_LABEL } from "@/office/status";
import styles from "./SessionPicker.module.css";

export const AUTO = "auto";

/** Sessions, most recently active first. */
export function sortedSessions(sessions: SessionMap) {
  return Object.values(sessions).sort((a, b) => b.lastEventAt - a.lastEventAt);
}

export function SessionPicker({
  sessions,
  value,
  onChange,
}: {
  sessions: SessionMap;
  value: string;
  onChange: (value: string) => void;
}) {
  const list = sortedSessions(sessions);
  return (
    <label className={styles.picker}>
      <span>세션</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={AUTO}>자동 (최근 세션)</option>
        {list.map((s) => {
          const main = s.agents.main;
          const state = s.ended ? "종료" : main ? STATUS_LABEL[main.status] : "";
          const staff = Object.keys(s.agents).length - 1;
          return (
            <option key={s.sessionId} value={s.sessionId}>
              {s.project} · {s.sessionId.slice(0, 8)} · {state}
              {staff > 0 ? ` · 직원 ${staff}` : ""}
            </option>
          );
        })}
      </select>
    </label>
  );
}
