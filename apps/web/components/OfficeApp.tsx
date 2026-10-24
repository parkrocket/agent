"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_OFF_DUTY_MS, type OfficeEvent } from "@ai-office/shared";
import type { SceneInput } from "@/office/OfficeScene";
import { formatDateTime } from "@/lib/format";
import { AUTO_LOBBY_MAX_ROOMS, summarizeRooms, type RoomSummary } from "@/lib/rooms";
import { useReplay } from "@/lib/useReplay";
import { WS_URL, useOfficeSocket } from "@/lib/useOfficeSocket";
import { useAlertSetting, useWaitingAlerts } from "@/lib/useWaitingAlerts";
import { AlertToggle } from "./AlertToggle";
import { EventLog } from "./EventLog";
import { ReplayBar } from "./ReplayBar";
import { ReplayPicker } from "./ReplayPicker";
import { RoomTabs } from "./RoomTabs";
import { UsagePanel } from "./UsagePanel";
import styles from "./OfficeApp.module.css";

const OfficeCanvas = dynamic(() => import("./OfficeCanvas"), { ssr: false });

const VIEW_KEY = "ai-office.view";
const LOG_KEY = "ai-office.log";
/** "auto", "lobby", or a room key to focus. */
type View = string;

export function OfficeApp() {
  const { events, sessions, rooms, config, usage, loaded, status, clearEvents } = useOfficeSocket();
  const [usageOpen, setUsageOpen] = useState(false);
  const [view, setView] = useState<View>("auto");
  const [logCollapsed, setLogCollapsed] = useState(false);
  const alerts = useAlertSetting();
  const replay = useReplay(config?.offDutyMs ?? DEFAULT_OFF_DUTY_MS, config?.models);

  useEffect(() => {
    try {
      setView(localStorage.getItem(VIEW_KEY) ?? "auto");
      setLogCollapsed(localStorage.getItem(LOG_KEY) === "collapsed");
    } catch {}
  }, []);

  const toggleLog = () => {
    setLogCollapsed((c) => {
      try {
        localStorage.setItem(LOG_KEY, c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };

  const { exit: exitReplay } = replay;
  // Picking a room or the lobby (tabs, alerts) always leaves a replay for the live office.
  const choose = useCallback(
    (next: View) => {
      exitReplay();
      setView(next);
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {}
    },
    [exitReplay],
  );

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

  // A replay shows a building with just the replayed session's room, rebuilt by the same reducer.
  const replaySummaries = useMemo(
    () => (replay.active ? summarizeRooms(replay.office.rooms, replay.office.sessions) : []),
    [replay.active, replay.office],
  );
  const replayRoom = replay.session ? (replaySummaries[0]?.room.key ?? replay.session.cwd) : undefined;

  const input: SceneInput = useMemo(
    () =>
      replay.active
        ? {
            rooms: replaySummaries.map((r) => ({
              room: r.room,
              sessions: replay.office.sessions,
              label: r.label,
              activity: r.activity,
              usage: replay.usage,
              models: config?.models,
            })),
            visible: replayRoom ? [replayRoom] : [],
            mode: "focus",
            epoch: replay.epoch,
            clock: replay.clock,
          }
        : {
            rooms: summaries.map((r) => ({
              room: r.room,
              sessions,
              label: r.label,
              activity: r.activity,
              usage,
              models: config?.models,
            })),
            // The lobby shows rooms with someone in them; if everyone went home, show the empty rooms instead.
            visible: focusKey ? [focusKey] : (occupied.length ? occupied : summaries).map((r) => r.room.key),
            mode,
            epoch: "live",
          },
    [summaries, sessions, focusKey, occupied, mode, usage, config, replay.active, replaySummaries, replay.office, replay.usage, replay.epoch, replay.clock, replayRoom],
  );

  // Alerts follow the live office only: a hand raised in the replay never alerts or blinks the title.
  useWaitingAlerts({ sessions, rooms: summaries, loaded, enabled: alerts.state === "on", onOpenRoom: choose });

  const focused = focusKey ? summaries.find((r) => r.room.key === focusKey) : undefined;
  const inRoom = useCallback(
    (e: OfficeEvent) => !focusKey || (sessions[e.sessionId]?.room ?? e.cwd) === focusKey,
    [focusKey, sessions],
  );

  return (
    <main className={`${styles.root} ${logCollapsed ? styles.logCollapsed : ""}`}>
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
          <ReplayPicker active={replay.active} loading={replay.loading} error={replay.error} onPick={replay.start} />
          <button className={styles.usageButton} onClick={() => setUsageOpen((v) => !v)} aria-pressed={usageOpen}>
            📊 사용량
          </button>
          <AlertToggle state={alerts.state} onToggle={alerts.toggle} />
          <span className={`${styles.badge} ${styles[status]}`}>{status}</span>
        </div>
      </header>
      {/* Always rendered so the grid rows stay put in the lobby. */}
      <div className={styles.where} title={replay.session?.cwd ?? focused?.room.cwd}>
        {replay.session
          ? `🎞 ${replay.session.cwd ?? replay.session.project ?? ""}`
          : focused
            ? `📁 ${focused.room.cwd}`
            : `로비 · 근무 중인 방 ${occupied.length}개`}
      </div>
      <div className={`${styles.office} ${replay.active ? styles.replay : ""}`}>
        <div className={styles.stage}>
          {/* Clicks in the replayed building don't navigate the live view. */}
          <OfficeCanvas input={input} onOpenRoom={replay.active ? ignore : choose} />
        </div>
        {replay.active && replay.session && replay.timeline && (
          <>
            <div className={styles.replayBand} data-testid="replay-band">
              🎞 다시보기 중 · 실시간 아님 · {replay.session.project ?? ""} {formatDateTime(replay.timeline.start)}
            </div>
            <ReplayBar
              timeline={replay.timeline}
              playing={replay.playing}
              speed={replay.speed}
              playMs={replay.playMs}
              realTs={replay.realTs}
              onToggle={replay.toggle}
              onSpeed={replay.setSpeed}
              onSeek={replay.seek}
              onExit={replay.exit}
            />
          </>
        )}
        {usageOpen && (
          <UsagePanel usage={usage} sessions={sessions} rooms={rooms} models={config?.models} onClose={() => setUsageOpen(false)} />
        )}
      </div>
      <div className={styles.log}>
        <EventLog
          events={replay.active ? replay.played : events}
          title={replay.active ? "이벤트 로그 · 다시보기" : undefined}
          scopeLabel={!replay.active && focused ? `${focused.label} 방만` : undefined}
          inScope={!replay.active && focused ? inRoom : undefined}
          onClear={replay.active ? undefined : clearEvents}
          emptyText={`이벤트 대기 중… (${WS_URL})`}
          collapsed={logCollapsed}
          onToggleCollapsed={toggleLog}
        />
      </div>
    </main>
  );
}

const ignore = () => {};

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
