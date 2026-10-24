"use client";

import type { RoomSummary } from "@/lib/rooms";
import styles from "./RoomTabs.module.css";

const ACTIVITY_LABEL = { waiting: "손 듦", working: "작업 중", idle: "휴식", empty: "비움" } as const;

export function RoomTabs({
  rooms,
  current,
  lobby,
  onLobby,
  onRoom,
}: {
  rooms: RoomSummary[];
  /** Focused room key, if any. */
  current?: string;
  lobby: boolean;
  onLobby: () => void;
  onRoom: (key: string) => void;
}) {
  return (
    <nav className={styles.tabs} aria-label="방">
      <button className={`${styles.tab} ${lobby ? styles.selected : ""}`} onClick={onLobby}>
        로비
      </button>
      {rooms.map((r) => (
        <button
          key={r.room.key}
          className={[styles.tab, styles[r.activity], r.room.key === current && !lobby ? styles.selected : ""].join(" ")}
          title={`${r.room.cwd} · ${ACTIVITY_LABEL[r.activity]}`}
          onClick={() => onRoom(r.room.key)}
        >
          <span className={styles.dot} aria-label={ACTIVITY_LABEL[r.activity]} />
          {r.label}
          {r.present > 1 && <span className={styles.count}>{r.present}</span>}
        </button>
      ))}
    </nav>
  );
}
