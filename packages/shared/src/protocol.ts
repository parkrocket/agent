import type { OfficeEvent } from "./events";
import type { PlanLimits } from "./limits";
import type { ModelConfig, TokenCounts } from "./models";
import type { RoomMap, RoomState, SessionMap, SessionState } from "./office";
import type { UsageRecord } from "./transcript";
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
      /** Latest plan limits from the status line; null until one has reported. */
      limits: PlanLimits | null;
    }
  /** One event plus the session and room it changed. */
  | { type: "event"; event: OfficeEvent; session: SessionState; room: RoomState }
  /** Full replacement after off-duty sweeps or pruning. */
  | { type: "state"; sessions: SessionMap; rooms: RoomMap }
  /** Token usage read from transcripts (throttled). */
  | { type: "usage"; usage: UsageSnapshot }
  /** A newer plan-limits report. */
  | { type: "limits"; limits: PlanLimits };

/** Recent events the server keeps for snapshots and the client keeps for the log. */
export const MAX_RECENT_EVENTS = 500;

export const DEFAULT_SERVER_PORT = 7420;
export const DEFAULT_WEB_PORT = 7421;

/** One past session in `GET /history` (newest first). */
export interface HistorySession {
  sessionId: string;
  cwd?: string;
  project?: string;
  startedAt: number;
  endedAt: number;
  /** Stored hook events; 0 for a transcript-only ("기록만") session. */
  events: number;
  tokens: TokenCounts;
  /** False when there are no hook events to replay (only transcript usage). */
  replayable: boolean;
  /** At work right now. */
  live: boolean;
}

export interface HistoryList {
  sessions: HistorySession[];
}

/** `GET /history/:sessionId/events`: the session's events and per-message usage, both in time order. */
export interface HistoryEvents {
  events: OfficeEvent[];
  usage: UsageRecord[];
}
