"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionMap } from "@ai-office/shared";
import type { RoomSummary } from "./rooms";

export const BASE_TITLE = "AI 오피스";
const ALERT_TITLE = `(!) ${BASE_TITLE}`;
const PREF_KEY = "ai-office.alerts";

export type AlertState = "unsupported" | "off" | "on" | "denied";

/** Alerts on/off. Permission is only requested when the user turns them on. */
export function useAlertSetting() {
  const [state, setState] = useState<AlertState>("off");

  useEffect(() => {
    if (typeof Notification === "undefined") return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    let wanted = false;
    try {
      wanted = localStorage.getItem(PREF_KEY) === "on";
    } catch {}
    setState(wanted && Notification.permission === "granted" ? "on" : "off");
  }, []);

  const toggle = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    let next: AlertState = "off";
    if (state !== "on") {
      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      next = permission === "granted" ? "on" : permission === "denied" ? "denied" : "off";
    }
    setState(next);
    try {
      localStorage.setItem(PREF_KEY, next === "on" ? "on" : "off");
    } catch {}
  }, [state]);

  return { state, toggle };
}

interface Waiting {
  /** Unique per waiting episode, so one prompt alerts once. */
  key: string;
  roomKey: string;
  roomLabel: string;
  who: string;
  tool?: string;
}

function collectWaiting(sessions: SessionMap, rooms: RoomSummary[]): Waiting[] {
  const labels = new Map(rooms.map((r) => [r.room.key, r.label]));
  const out: Waiting[] = [];
  for (const s of Object.values(sessions)) {
    if (s.offDuty) continue;
    for (const a of Object.values(s.agents)) {
      if (a.status !== "waiting") continue;
      out.push({
        key: `${s.sessionId}:${a.key}:${a.waiting?.at ?? a.since}`,
        roomKey: s.room,
        roomLabel: labels.get(s.room) ?? s.project,
        who: a.kind === "main" ? "팀장" : (a.type ?? "직원"),
        ...(a.waiting?.tool ? { tool: a.waiting.tool } : {}),
      });
    }
  }
  return out;
}

/**
 * Browser notification once per waiting episode, plus a blinking tab title
 * while anyone waits. Agents already waiting when the page loads only blink
 * the title, so a refresh doesn't replay old alerts.
 */
export function useWaitingAlerts(opts: {
  sessions: SessionMap;
  rooms: RoomSummary[];
  loaded: boolean;
  enabled: boolean;
  onOpenRoom: (roomKey: string) => void;
}) {
  const { sessions, rooms, loaded, enabled } = opts;
  const seen = useRef<Set<string> | null>(null);
  const openRoom = useRef(opts.onOpenRoom);
  openRoom.current = opts.onOpenRoom;

  const waiting = collectWaiting(sessions, rooms);
  const anyWaiting = waiting.length > 0;

  useEffect(() => {
    if (!loaded) return;
    if (!seen.current) {
      seen.current = new Set(waiting.map((w) => w.key));
      return;
    }
    for (const w of waiting) {
      if (seen.current.has(w.key)) continue;
      seen.current.add(w.key);
      if (!enabled || typeof Notification === "undefined" || Notification.permission !== "granted") continue;
      const n = new Notification(`손 들었어요 · ${w.roomLabel}`, {
        body: `${w.who}: ${w.tool ? `승인 대기 (${w.tool})` : "입력 기다리는 중"}`,
        tag: w.key,
      });
      n.onclick = () => {
        window.focus();
        openRoom.current(w.roomKey);
        n.close();
      };
    }
    // Forget finished episodes so the set doesn't grow forever.
    const live = new Set(waiting.map((w) => w.key));
    for (const key of seen.current) if (!live.has(key)) seen.current.delete(key);
  });

  useEffect(() => {
    if (!anyWaiting) {
      document.title = BASE_TITLE;
      return;
    }
    let on = true;
    document.title = ALERT_TITLE;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? ALERT_TITLE : BASE_TITLE;
    }, 1000);
    return () => {
      clearInterval(timer);
      document.title = BASE_TITLE;
    };
  }, [anyWaiting]);

  return waiting;
}
