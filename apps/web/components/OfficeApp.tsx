"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeEvent } from "@ai-office/shared";
import type { SceneInput } from "@/office/OfficeScene";
import { AUTO_LOBBY_MAX_ROOMS, summarizeRooms, type RoomSummary } from "@/lib/rooms";
import { WS_URL, useOfficeSocket } from "@/lib/useOfficeSocket";
import { useAlertSetting, useWaitingAlerts } from "@/lib/useWaitingAlerts";
import { AlertToggle } from "./AlertToggle";
import { EventLog } from "./EventLog";
import { RoomTabs } from "./RoomTabs";
import styles from "./OfficeApp.module.css";

const OfficeCanvas = dynamic(() => import("./OfficeCanvas"), { ssr: false });

const VIEW_KEY = "ai-office.view";
/** "auto", "lobby", or a room key to focus. */
type View = string;

export function OfficeApp() {
  const { events, sessions, rooms, config, loaded, status, clearEvents } = useOfficeSocket();
  const [view, setView] = useState<View>("auto");
  const alerts = useAlertSetting();

  useEffect(() => {
    try {
      setView(localStorage.getItem(VIEW_KEY) ?? "auto");
    } catch {}
  }, []);

  const choose = useCallback((next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }, []);

  const summaries = useMemo(() => summarizeRooms(rooms, sessions), [rooms, sessions]);
  const occupied = useMemo(() => summaries.filter((r) => r.activity !== "empty"), [summaries]);

  // Auto: up to two busy rooms fit side by side in the lobby; with more, one room gets focus.
  const autoFocus = useRef<string | undefined>(undefined);
  const focusKey =
    view !== "auto" && view !== "lobby" && rooms[view]
      ? view
      : view === "auto" && occupied.length > AUTO_LOBBY_MAX_ROOMS
        ? (autoFocus.current = pickAutoFocus(autoFocus.current, occupied))
        : undefined;
  const mode = focusKey ? "focus" : "lobby";

  const input: SceneInput = useMemo(
    () => ({
      rooms: summaries.map((r) => ({ room: r.room, sessions, label: r.label, activity: r.activity })),
      // The lobby shows rooms with someone in them; if everyone went home, show the empty rooms instead.
      visible: focusKey ? [focusKey] : (occupied.length ? occupied : summaries).map((r) => r.room.key),
      mode,
    }),
    [summaries, sessions, focusKey, occupied, mode],
  );

  useWaitingAlerts({ sessions, rooms: summaries, loaded, enabled: alerts.state === "on", onOpenRoom: choose });

  const focused = focusKey ? summaries.find((r) => r.room.key === focusKey) : undefined;
  const inRoom = useCallback(
    (e: OfficeEvent) => !focusKey || (sessions[e.sessionId]?.room ?? e.cwd) === focusKey,
    [focusKey, sessions],
  );

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <h1>AI 오피스</h1>
        <RoomTabs
          rooms={summaries}
          current={focusKey}
          lobby={mode === "lobby"}
          onLobby={() => choose("lobby")}
          onRoom={choose}
        />
        <div className={styles.right}>
          {config && (
            <span className={styles.hint} title="마지막 이벤트 후 이 시간이 지나면 퇴근합니다 (AI_OFFICE_OFF_DUTY_MIN)">
              퇴근 {Math.round((config.offDutyMs / 60_000) * 10) / 10}분
            </span>
          )}
          <AlertToggle state={alerts.state} onToggle={alerts.toggle} />
          <span className={`${styles.badge} ${styles[status]}`}>{status}</span>
        </div>
      </header>
      {/* Always rendered so the grid rows stay put in the lobby. */}
      <div className={styles.where} title={focused?.room.cwd}>
        {focused ? `📁 ${focused.room.cwd}` : `로비 · 근무 중인 방 ${occupied.length}개`}
      </div>
      <div className={styles.office}>
        <OfficeCanvas input={input} onOpenRoom={choose} />
      </div>
      <div className={styles.log}>
        <EventLog
          events={events}
          scopeLabel={focused ? `${focused.label} 방만` : undefined}
          inScope={focused ? inRoom : undefined}
          onClear={clearEvents}
          emptyText={`이벤트 대기 중… (${WS_URL})`}
        />
      </div>
    </main>
  );
}

const busy = (r: RoomSummary) => r.activity === "working" || r.activity === "waiting";

/**
 * Sticky auto focus: stay on the current room while it's busy, so concurrent
 * sessions don't flip the view on every event. Move to the most recently
 * active busy room only once the current one goes quiet.
 */
function pickAutoFocus(current: string | undefined, occupied: RoomSummary[]): string {
  const now = occupied.find((r) => r.room.key === current);
  if (now && busy(now)) return now.room.key;
  const byRecent = [...occupied].sort((a, b) => b.room.lastEventAt - a.room.lastEventAt);
  return (byRecent.find(busy) ?? now ?? byRecent[0]!).room.key;
}
