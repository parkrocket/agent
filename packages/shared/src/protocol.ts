import type { OfficeEvent } from "./events";
import type { ModelConfig } from "./models";
import type { RoomMap, RoomState, SessionMap, SessionState } from "./office";
import type { UsageSnapshot } from "./usage";

/** Server settings the client needs to draw correctly. */
export interface OfficeConfig {
  offDutyMs: number;
  /** Context limits and prices (defaults merged with the user's override file). */
  models: ModelConfig;
}

/** Messages the server pushes to web clients over WebSocket. */
export type ServerMessage =
  /** On connect: recent events and the full office, so a refresh restores everything. */
  | {
      type: "snapshot";
      events: OfficeEvent[];
      sessions: SessionMap;
      rooms: RoomMap;
      config: OfficeConfig;
      usage: UsageSnapshot;
    }
  /** One event plus the session and room it changed. */
  | { type: "event"; event: OfficeEvent; session: SessionState; room: RoomState }
  /** Full replacement after off-duty sweeps or pruning. */
  | { type: "state"; sessions: SessionMap; rooms: RoomMap }
  /** Token usage read from transcripts (throttled). */
  | { type: "usage"; usage: UsageSnapshot };

/** Recent events the server keeps for snapshots and the client keeps for the log. */
export const MAX_RECENT_EVENTS = 500;

export const DEFAULT_SERVER_PORT = 7420;
export const DEFAULT_WEB_PORT = 7421;
