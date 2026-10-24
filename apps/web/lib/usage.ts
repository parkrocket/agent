import {
  MAIN_AGENT,
  ZERO_TOKENS,
  addTokens,
  formatTokens,
  normalizeAgentId,
  resolveModel,
  type AgentState,
  type AgentUsage,
  type ModelConfig,
  type TokenCounts,
  type UsageSnapshot,
} from "@ai-office/shared";

export interface ContextGauge {
  tokens: number;
  limit: number;
  /** 0..100+ */
  pct: number;
  verified: boolean;
  model: string;
}

/** Usage of one character: the lead is "main", staff are matched by agent id (with or without "agent-"). */
export function agentUsage(usage: UsageSnapshot, sessionId: string, agent: Pick<AgentState, "kind" | "key">): AgentUsage | undefined {
  const s = usage.sessions[sessionId];
  if (!s) return undefined;
  return agent.kind === "main" ? s.agents[MAIN_AGENT] : s.agents[normalizeAgentId(agent.key)];
}

export function contextGauge(
  usage: UsageSnapshot,
  models: ModelConfig | undefined,
  sessionId: string,
  agent: Pick<AgentState, "kind" | "key">,
): ContextGauge | undefined {
  const u = agentUsage(usage, sessionId, agent);
  if (!u || !models) return undefined;
  const m = resolveModel(models, u.model);
  return { tokens: u.context, limit: m.contextLimit, pct: (u.context / m.contextLimit) * 100, verified: m.contextVerified, model: u.model };
}

/** "12% · 120K" — the token count is shown too, since a 1M limit keeps percentages small. */
export function gaugeLabel(g: ContextGauge): string {
  const pct = g.pct < 1 && g.tokens > 0 ? "<1%" : `${Math.round(g.pct)}%`;
  return `${pct} · ${formatTokens(g.tokens)}${g.verified ? "" : " ?"}`;
}

export type GaugeLevel = "ok" | "warn" | "danger";
export const gaugeLevel = (g: ContextGauge): GaugeLevel => (g.pct >= 95 ? "danger" : g.pct >= 80 ? "warn" : "ok");

export const totalTokens = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;

/** Sum of the hourly buckets that fall on the viewer's local "today". */
export function todayTotals(usage: UsageSnapshot, now = new Date()): { tokens: TokenCounts; cost: number } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let tokens = ZERO_TOKENS;
  let cost = 0;
  for (const [hour, h] of Object.entries(usage.hours)) {
    if (Number(hour) * 3_600_000 >= midnight) {
      tokens = addTokens(tokens, h.tokens);
      cost += h.cost;
    }
  }
  return { tokens, cost };
}
