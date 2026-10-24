import type { OfficeEvent } from "./events";

/** Messages the server pushes to web clients over WebSocket. */
export type ServerMessage =
  | { type: "snapshot"; events: OfficeEvent[] }
  | { type: "event"; event: OfficeEvent };

export const DEFAULT_SERVER_PORT = 7420;
export const DEFAULT_WEB_PORT = 7421;
