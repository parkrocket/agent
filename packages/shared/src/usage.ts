import { ZERO_TOKENS, addTokens, messageCost, promptTokens, resolveModel, type ModelConfig, type TokenCounts } from "./models";
import type { UsageRecord } from "./transcript";

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

/**
 * Adds one message to the per-session totals (cumulative tokens, cost, and the
 * latest request's prompt size as the current context). Mutates `sessions`.
 */
export function addSessionUsage(sessions: Record<string, SessionUsage>, r: UsageRecord, models: ModelConfig): number {
  const s = (sessions[r.sessionId] ??= { sessionId: r.sessionId, firstTs: r.ts, lastTs: r.ts, agents: {} });
  if (r.cwd && !r.agentId) s.cwd ??= r.cwd;
  s.firstTs = Math.min(s.firstTs, r.ts);
  s.lastTs = Math.max(s.lastTs, r.ts);

  const cost = messageCost(resolveModel(models, r.model), r.tokens) ?? 0;
  const key = r.agentId ?? MAIN_AGENT;
  const a = (s.agents[key] ??= { tokens: ZERO_TOKENS, context: 0, model: r.model, lastTs: 0, messages: 0, cost: 0 });
  a.tokens = addTokens(a.tokens, r.tokens);
  a.messages++;
  a.cost += cost;
  if (r.ts >= a.lastTs) {
    // the latest request's prompt size is how full the context window is now
    a.lastTs = r.ts;
    a.context = promptTokens(r.tokens);
    a.model = r.model;
  }
  return cost;
}

/** Usage as it stood at `ts`: only messages up to then count (for replays). Pure. */
export function usageAt(records: readonly UsageRecord[], models: ModelConfig, ts: number): UsageSnapshot {
  const sessions: Record<string, SessionUsage> = {};
  for (const r of records) if (r.ts <= ts) addSessionUsage(sessions, r, models);
  return { sessions, hours: {} };
}
