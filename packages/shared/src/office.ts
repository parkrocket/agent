import type { OfficeEvent } from "./events";

export const AGENT_STATUSES = ["idle", "thinking", "reading", "writing", "running", "waiting", "done"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Status an agent rests in when no tool is running and nobody is waiting. */
export type BaseStatus = "idle" | "thinking" | "done";

/** Sub-agent desks are 1..SUB_DESK_COUNT; desk 0 is the lead's. -1 means standing (no free desk). */
export const SUB_DESK_COUNT = 6;
export const MAX_SESSIONS = 20;

const MAX_ACTIVE_TOOLS = 16;
const MAX_RECENT_DONE = 32;

export interface ActiveTool {
  id: string;
  tool: string;
  file?: string;
  status: AgentStatus;
  startedAt: number;
}

export interface AgentState {
  key: string;
  kind: "main" | "sub";
  type?: string;
  desk: number;
  /** Derived from base/activeTools/waiting by refresh(). */
  status: AgentStatus;
  /** Bubble contents, derived alongside status. */
  tool?: string;
  file?: string;
  since: number;
  base: BaseStatus;
  /** In-flight tool calls in start order; the bubble shows the latest. */
  activeTools: ActiveTool[];
  /** Tool ids whose Post arrived, so a late (out-of-order) Pre is ignored. */
  recentDone: string[];
  waiting?: { tool?: string; file?: string; at: number };
  /** Tool events stamped before this (turn start/end) are stale and ignored. */
  resetAt: number;
}

export interface SessionState {
  sessionId: string;
  cwd: string;
  project: string;
  startedAt: number;
  lastEventAt: number;
  ended: boolean;
  agents: Record<string, AgentState>;
}

export type SessionMap = Record<string, SessionState>;

export const MAIN_KEY = "main";

const READ_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch", "NotebookRead"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const RUN_TOOLS = new Set(["Bash", "BashOutput", "KillShell"]);

/** Notification types that mean the user is needed. */
export const WAITING_NOTIFICATIONS = new Set([
  "permission_prompt",
  "idle_prompt",
  "elicitation_dialog",
  "elicitation_url_dialog",
  "agent_needs_input",
]);

export function toolStatus(tool: string): AgentStatus {
  if (READ_TOOLS.has(tool)) return "reading";
  if (WRITE_TOOLS.has(tool)) return "writing";
  if (RUN_TOOLS.has(tool)) return "running";
  return "thinking";
}

function newAgent(key: string, kind: "main" | "sub", desk: number, ts: number, type?: string): AgentState {
  return {
    key,
    kind,
    ...(type ? { type } : {}),
    desk,
    status: kind === "main" ? "idle" : "thinking",
    since: ts,
    base: kind === "main" ? "idle" : "thinking",
    activeTools: [],
    recentDone: [],
    resetAt: 0,
  };
}

function refresh(agent: AgentState, ts: number): void {
  let status: AgentStatus = agent.base;
  let tool: string | undefined;
  let file: string | undefined;
  const latest = agent.activeTools.at(-1);
  if (agent.waiting) {
    status = "waiting";
    ({ tool, file } = agent.waiting);
  } else if (latest) {
    ({ status, tool, file } = latest);
  }
  if (status !== agent.status) agent.since = ts;
  agent.status = status;
  if (tool) agent.tool = tool;
  else delete agent.tool;
  if (file) agent.file = file;
  else delete agent.file;
}

function freeDesk(session: SessionState): number {
  const taken = new Set(Object.values(session.agents).map((a) => a.desk));
  for (let d = 1; d <= SUB_DESK_COUNT; d++) if (!taken.has(d)) return d;
  return -1;
}

function resetTurn(agent: AgentState, base: BaseStatus, ts: number): void {
  agent.base = base;
  agent.activeTools = [];
  delete agent.waiting;
  agent.resetAt = ts;
}

function removeSubs(session: SessionState): void {
  for (const key of Object.keys(session.agents)) if (key !== MAIN_KEY) delete session.agents[key];
}

function ensureSession(prev: SessionState | undefined, e: OfficeEvent): SessionState {
  if (prev) return structuredClone(prev);
  return {
    sessionId: e.sessionId,
    cwd: e.cwd,
    project: e.project,
    startedAt: e.ts,
    lastEventAt: e.ts,
    ended: false,
    agents: { [MAIN_KEY]: newAgent(MAIN_KEY, "main", 0, e.ts) },
  };
}

function ensureAgent(session: SessionState, e: OfficeEvent): AgentState {
  const key = e.agent.kind === "main" ? MAIN_KEY : e.agent.id;
  let agent = session.agents[key];
  if (!agent) {
    agent =
      e.agent.kind === "main"
        ? newAgent(MAIN_KEY, "main", 0, e.ts)
        : newAgent(key, "sub", freeDesk(session), e.ts, e.agent.type);
    session.agents[key] = agent;
  } else if (e.agent.kind === "sub" && e.agent.type && !agent.type) {
    agent.type = e.agent.type;
  }
  return agent;
}

/** Pure reducer: applies one event to a session (undefined = not seen yet). */
export function reduceSession(prev: SessionState | undefined, e: OfficeEvent): SessionState {
  const session = ensureSession(prev, e);
  session.lastEventAt = Math.max(session.lastEventAt, e.ts);
  session.cwd = e.cwd;
  session.project = e.project;

  if (e.event === "SessionStart") {
    session.ended = false;
    // Compaction happens mid-turn; anything else starts the office fresh.
    if (e.detail?.source !== "compact") {
      removeSubs(session);
      const main = ensureAgent(session, e);
      resetTurn(main, "idle", e.ts);
      refresh(main, e.ts);
    }
    return session;
  }

  if (e.event === "SessionEnd") {
    session.ended = true;
    removeSubs(session);
    const main = session.agents[MAIN_KEY];
    if (main) {
      resetTurn(main, "idle", e.ts);
      refresh(main, e.ts);
    }
    return session;
  }

  if (e.event === "SubagentStop") {
    if (e.agent.kind === "sub") delete session.agents[e.agent.id];
    return session;
  }

  if (e.event === "Notification") {
    if (!WAITING_NOTIFICATIONS.has(e.detail?.notificationType ?? "")) return session;
    // A PermissionRequest already raised someone's hand for this prompt.
    const someoneWaiting = Object.values(session.agents).some((a) => a.waiting);
    if (e.agent.kind === "main" && someoneWaiting) return session;
    const agent = ensureAgent(session, e);
    agent.waiting ??= { at: e.ts };
    refresh(agent, e.ts);
    return session;
  }

  const agent = ensureAgent(session, e);

  if (e.event === "PermissionRequest") {
    agent.waiting = { at: e.ts, ...(e.tool ? { tool: e.tool } : {}), ...(e.file ? { file: e.file } : {}) };
    refresh(agent, e.ts);
    return session;
  }

  // Any other event from this agent means it moved on (approved, denied, or answered).
  const waited = agent.waiting;
  delete agent.waiting;
  // Tools needing permission run one at a time, so a new tool starting before the
  // awaited tool's Post means it was denied and no Post will ever come.
  if (waited?.tool && e.event === "PreToolUse") {
    const denied = agent.activeTools.findLastIndex((t) => t.tool === waited.tool && t.startedAt <= waited.at);
    if (denied >= 0) agent.activeTools.splice(denied, 1);
  }

  switch (e.event) {
    case "UserPromptSubmit":
      resetTurn(agent, "thinking", e.ts);
      break;
    case "Stop":
      resetTurn(agent, "done", e.ts);
      break;
    case "SubagentStart":
      break;
    case "PreToolUse": {
      if (e.ts < agent.resetAt || !e.tool) break;
      const id = e.toolUseId ?? `${e.tool}@${e.ts}`;
      if (agent.recentDone.includes(id) || agent.activeTools.some((t) => t.id === id)) break;
      agent.activeTools.push({
        id,
        tool: e.tool,
        ...(e.file ? { file: e.file } : {}),
        status: toolStatus(e.tool),
        startedAt: e.ts,
      });
      if (agent.activeTools.length > MAX_ACTIVE_TOOLS) agent.activeTools.shift();
      agent.base = "thinking";
      break;
    }
    case "PostToolUse":
    case "PostToolUseFailure": {
      if (e.ts < agent.resetAt) break;
      let idx = e.toolUseId ? agent.activeTools.findIndex((t) => t.id === e.toolUseId) : -1;
      if (idx < 0 && !e.toolUseId && e.tool) idx = agent.activeTools.findIndex((t) => t.tool === e.tool);
      if (idx >= 0) agent.activeTools.splice(idx, 1);
      else if (e.toolUseId) {
        agent.recentDone.push(e.toolUseId);
        if (agent.recentDone.length > MAX_RECENT_DONE) agent.recentDone.shift();
      }
      agent.base = "thinking";
      break;
    }
  }
  refresh(agent, e.ts);
  return session;
}

/** Applies an event to the session map, keeping only the most recent MAX_SESSIONS sessions. */
export function reduceSessions(prev: SessionMap, e: OfficeEvent): SessionMap {
  const next: SessionMap = { ...prev, [e.sessionId]: reduceSession(prev[e.sessionId], e) };
  const ids = Object.keys(next);
  if (ids.length <= MAX_SESSIONS) return next;
  ids.sort((a, b) => next[b]!.lastEventAt - next[a]!.lastEventAt);
  for (const id of ids.slice(MAX_SESSIONS)) delete next[id];
  return next;
}
