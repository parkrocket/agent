import type { OfficeEvent } from "./events";
import type { ModelConfig, ModelInfo, TokenCounts } from "./models";
import { DEFAULT_OFF_DUTY_MS, type AgentState, type RoomMap, type RoomState, type SessionMap, type SessionState } from "./office";
import type { HistoryEvents, HistoryList, HistorySession, OfficeConfig, ServerMessage } from "./protocol";
import type { UsageRecord } from "./transcript";
import type { AgentUsage, SessionUsage, UsageSnapshot } from "./usage";

/*
 * The server and the web build can be from different commits (e.g. `pnpm start`
 * still running old code). Everything the web reads from the server goes through
 * these functions, which fill missing fields with empty values so an older or
 * newer server degrades the page instead of crashing it. Pure; never throws.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

/** Keeps object entries only, normalized; drops anything else. */
function record<T>(v: unknown, f: (value: Obj, key: string) => T): Record<string, T> {
  const out: Record<string, T> = {};
  if (isObj(v)) for (const [k, value] of Object.entries(v)) if (isObj(value)) out[k] = f(value, k);
  return out;
}

export function normalizeTokens(v: unknown): TokenCounts {
  const t = isObj(v) ? v : {};
  return {
    input: num(t.input),
    output: num(t.output),
    cacheRead: num(t.cacheRead),
    cacheWrite5m: num(t.cacheWrite5m),
    cacheWrite1h: num(t.cacheWrite1h),
  };
}

function normalizeAgent(a: Obj, key: string): AgentState {
  const agent: AgentState = {
    ...(a as unknown as AgentState),
    key: str(a.key, key),
    kind: a.kind === "sub" ? "sub" : "main",
    desk: num(a.desk),
    status: str(a.status, "idle") as AgentState["status"],
    since: num(a.since),
    base: str(a.base, "idle") as AgentState["base"],
    activeTools: arr(a.activeTools),
    recentDone: arr(a.recentDone),
    resetAt: num(a.resetAt),
  };
  // absent rather than undefined, so a well-formed agent comes out deep-equal to what went in
  if (isObj(a.waiting)) agent.waiting = { ...a.waiting, at: num(a.waiting.at) };
  else delete agent.waiting;
  return agent;
}

export function normalizeSession(s: Obj, key = ""): SessionState {
  const cwd = str(s.cwd);
  return {
    ...(s as unknown as SessionState),
    sessionId: str(s.sessionId, key),
    room: str(s.room, cwd),
    cwd,
    project: str(s.project),
    startedAt: num(s.startedAt),
    lastEventAt: num(s.lastEventAt),
    ended: s.ended === true,
    offDuty: s.offDuty === true,
    agents: record(s.agents, normalizeAgent),
  };
}

export function normalizeRoom(r: Obj, key = ""): RoomState {
  const cwd = str(r.cwd, key);
  return {
    ...(r as unknown as RoomState),
    key: str(r.key, key || cwd),
    cwd,
    project: str(r.project),
    pods: arr<unknown>(r.pods).map((p) => (typeof p === "string" ? p : null)),
    firstSeenAt: num(r.firstSeenAt),
    lastEventAt: num(r.lastEventAt),
  };
}

export const normalizeSessions = (v: unknown): SessionMap => record(v, normalizeSession);
export const normalizeRooms = (v: unknown): RoomMap => record(v, normalizeRoom);

function normalizeAgentUsage(a: Obj): AgentUsage {
  return {
    tokens: normalizeTokens(a.tokens),
    context: num(a.context),
    model: str(a.model),
    lastTs: num(a.lastTs),
    messages: num(a.messages),
    cost: num(a.cost),
  };
}

export function normalizeUsage(v: unknown): UsageSnapshot {
  const u = isObj(v) ? v : {};
  return {
    sessions: record(u.sessions, (s, key): SessionUsage => ({
      sessionId: str(s.sessionId, key),
      ...(typeof s.cwd === "string" && { cwd: s.cwd }),
      firstTs: num(s.firstTs),
      lastTs: num(s.lastTs),
      agents: record(s.agents, normalizeAgentUsage),
    })),
    hours: record(u.hours, (h) => ({ tokens: normalizeTokens(h.tokens), cost: num(h.cost) })),
  };
}

/** No model table yields an empty one: contexts fall back to the default limit and costs to unknown. */
function normalizeModels(v: unknown): ModelConfig {
  const m = isObj(v) ? v : {};
  return {
    ...(m as unknown as ModelConfig),
    defaultContextLimit: num(m.defaultContextLimit, 200_000),
    models: record(m.models, (info) => info as unknown as ModelInfo),
  };
}

export function normalizeConfig(v: unknown): OfficeConfig {
  const c = isObj(v) ? v : {};
  return { offDutyMs: num(c.offDutyMs, DEFAULT_OFF_DUTY_MS), models: normalizeModels(c.models) };
}

/** Events without the fields the reducer keys on are dropped. */
function normalizeEvents(v: unknown): OfficeEvent[] {
  return arr<unknown>(v).filter(
    (e): e is OfficeEvent => isObj(e) && typeof e.event === "string" && typeof e.sessionId === "string" && typeof e.ts === "number",
  );
}

/**
 * Parses one WebSocket message from the server. Undefined for a message the web
 * can't use (unknown type, or an `event` without its session or room).
 */
export function normalizeServerMessage(raw: unknown): ServerMessage | undefined {
  if (!isObj(raw)) return undefined;
  switch (raw.type) {
    case "snapshot":
      return {
        type: "snapshot",
        events: normalizeEvents(raw.events),
        sessions: normalizeSessions(raw.sessions),
        rooms: normalizeRooms(raw.rooms),
        config: normalizeConfig(raw.config),
        usage: normalizeUsage(raw.usage),
      };
    case "event": {
      const [event] = normalizeEvents([raw.event]);
      if (!event || !isObj(raw.session) || !isObj(raw.room)) return undefined;
      return { type: "event", event, session: normalizeSession(raw.session), room: normalizeRoom(raw.room) };
    }
    case "state":
      return { type: "state", sessions: normalizeSessions(raw.sessions), rooms: normalizeRooms(raw.rooms) };
    case "usage":
      return { type: "usage", usage: normalizeUsage(raw.usage) };
    default:
      return undefined;
  }
}

/** `GET /history`. */
export function normalizeHistoryList(raw: unknown): HistoryList {
  const sessions = arr<unknown>(isObj(raw) ? raw.sessions : undefined).filter(isObj);
  return {
    sessions: sessions
      .filter((s) => typeof s.sessionId === "string")
      .map(
        (s): HistorySession => ({
          ...(s as unknown as HistorySession),
          startedAt: num(s.startedAt),
          endedAt: num(s.endedAt),
          events: num(s.events),
          tokens: normalizeTokens(s.tokens),
          replayable: s.replayable !== false && num(s.events) > 0,
          live: s.live === true,
        }),
      ),
  };
}

/** `GET /history/:sessionId/events`. Usage records without a timestamp are dropped. */
export function normalizeHistoryEvents(raw: unknown): HistoryEvents {
  const body = isObj(raw) ? raw : {};
  return {
    events: normalizeEvents(body.events),
    usage: arr<unknown>(body.usage)
      .filter(isObj)
      .filter((r) => typeof r.sessionId === "string" && typeof r.ts === "number")
      .map((r) => ({ ...(r as unknown as UsageRecord), model: str(r.model), tokens: normalizeTokens(r.tokens) })),
  };
}
