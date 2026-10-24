"use client";

import { useEffect, useState } from "react";
import {
  MAX_RECENT_EVENTS,
  type OfficeConfig,
  type OfficeEvent,
  type RoomMap,
  type ServerMessage,
  type SessionMap,
  type UsageSnapshot,
} from "@ai-office/shared";

export const WS_URL = process.env.NEXT_PUBLIC_AI_OFFICE_WS ?? "ws://localhost:7420/ws";
/** HTTP base of the same server (for one-off requests such as the usage import). */
export const SERVER_URL = WS_URL.replace(/^ws/, "http").replace(/\/ws$/, "");

const EMPTY_USAGE: UsageSnapshot = { sessions: {}, hours: {} };

export type ConnectionStatus = "connecting" | "open" | "closed";

/** One WebSocket connection shared by the office canvas, tabs, alerts and the log. */
export function useOfficeSocket() {
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [sessions, setSessions] = useState<SessionMap>({});
  const [rooms, setRooms] = useState<RoomMap>({});
  const [config, setConfig] = useState<OfficeConfig | undefined>();
  const [usage, setUsage] = useState<UsageSnapshot>(EMPTY_USAGE);
  /** True once the first snapshot arrived (alerts use it to skip already-waiting agents). */
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

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
        let data: ServerMessage;
        try {
          data = JSON.parse(msg.data as string) as ServerMessage;
        } catch (err) {
          console.warn("[ai-office] ignoring malformed WebSocket message", err);
          return;
        }
        switch (data?.type) {
          case "snapshot":
            setEvents(data.events.slice(-MAX_RECENT_EVENTS));
            setSessions(data.sessions);
            setRooms(data.rooms);
            setConfig(data.config);
            setUsage(data.usage ?? EMPTY_USAGE);
            setLoaded(true);
            break;
          case "event":
            setEvents((prev) => [...prev, data.event].slice(-MAX_RECENT_EVENTS));
            setSessions((prev) => ({ ...prev, [data.session.sessionId]: data.session }));
            setRooms((prev) => ({ ...prev, [data.room.key]: data.room }));
            break;
          case "state":
            setSessions(data.sessions);
            setRooms(data.rooms);
            break;
          case "usage":
            setUsage(data.usage);
            break;
          default:
            console.warn("[ai-office] ignoring unknown WebSocket message", data);
        }
      };
      // The browser always fires close after error, and onclose handles the reconnect.
      socket.onerror = () => {
        console.warn(`[ai-office] WebSocket error (${WS_URL}); reconnecting`);
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

  return { events, sessions, rooms, config, usage, loaded, status, clearEvents: () => setEvents([]) };
}
