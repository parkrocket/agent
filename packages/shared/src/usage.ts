import type { TokenCounts } from "./models";

/** Usage of one agent (the lead is "main"; staff by normalized agent id). */
export interface AgentUsage {
  tokens: TokenCounts;
  /** Prompt size of the latest request: how full the context window is right now. */
  context: number;
  model: string;
  /** Timestamp of the latest request. */
  lastTs: number;
  messages: number;
  /** Estimated list-price cost (USD), summed per message. */
  cost: number;
}

export interface SessionUsage {
  sessionId: string;
  /** Working directory from the transcript, when known. */
  cwd?: string;
  firstTs: number;
  lastTs: number;
  agents: Record<string, AgentUsage>;
}

export interface UsageSnapshot {
  sessions: Record<string, SessionUsage>;
  /** Per-hour totals (key: epoch hour = floor(ms / 3_600_000)) for recent days; the client sums its local "today". */
  hours: Record<string, { tokens: TokenCounts; cost: number }>;
}

export const MAIN_AGENT = "main";
