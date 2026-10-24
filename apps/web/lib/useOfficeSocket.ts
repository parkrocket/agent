"use client";

import { useEffect, useState } from "react";
import { MAX_RECENT_EVENTS, type OfficeEvent, type ServerMessage, type SessionMap } from "@ai-office/shared";

export const WS_URL = process.env.NEXT_PUBLIC_AI_OFFICE_WS ?? "ws://localhost:7420/ws";

export type ConnectionStatus = "connecting" | "open" | "closed";

/** One WebSocket connection shared by the office canvas and the log panel. */
export function useOfficeSocket() {
  const [events, setEvents] = useState<OfficeEvent[]>([]);
  const [sessions, setSessions] = useState<SessionMap>({});
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
        if (data?.type === "snapshot") {
          setEvents(data.events.slice(-MAX_RECENT_EVENTS));
          setSessions(data.sessions);
        } else if (data?.type === "event") {
          setEvents((prev) => [...prev, data.event].slice(-MAX_RECENT_EVENTS));
          setSessions((prev) => ({ ...prev, [data.session.sessionId]: data.session }));
        } else {
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

  return { events, sessions, status, clearEvents: () => setEvents([]) };
}
