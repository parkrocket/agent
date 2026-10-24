import type { OfficeEvent } from "./events";
import type { SessionMap, SessionState } from "./office";

/** Messages the server pushes to web clients over WebSocket. */
export type ServerMessage =
  | { type: "snapshot"; events: OfficeEvent[]; sessions: SessionMap }
  | { type: "event"; event: OfficeEvent; session: SessionState };

export const DEFAULT_SERVER_PORT = 7420;
export const DEFAULT_WEB_PORT = 7421;
