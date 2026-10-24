import type { OfficeEvent } from "./events";

export const AGENT_STATUSES = ["idle", "thinking", "reading", "writing", "running", "waiting", "done"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Status an agent rests in when no tool is running and nobody is waiting. */
export type BaseStatus = "idle" | "thinking" | "done";

/** Sub-agent desks are 1..SUB_DESK_COUNT; desk 0 is the lead's. -1 means standing (no free desk). */
export const SUB_DESK_COUNT = 6;
export const MAX_SESSIONS = 50;
/** Default time without events before a session goes off duty. */
export const DEFAULT_OFF_DUTY_MS = 10 * 60_000;

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
  /** `idle` marks an idle_prompt (finished, waiting for the next request) rather than a blocking question. */
  waiting?: { tool?: string; file?: string; at: number; idle?: boolean };
  /** Tool events stamped before this (turn start/end) are stale and ignored. */
  resetAt: number;
}

export interface SessionState {
  sessionId: string;
  /** Room key: the cwd the session was first seen in, so a later `cd` doesn't move it. */
  room: string;
  cwd: string;
  project: string;
  startedAt: number;
  lastEventAt: number;
  ended: boolean;
  /** Gone home: no events for a while, or SessionEnd. Any new event brings it back. */
  offDuty: boolean;
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
    room: e.cwd,
    cwd: e.cwd,
    project: e.project,
    startedAt: e.ts,
    lastEventAt: e.ts,
    ended: false,
    offDuty: false,
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
  session.offDuty = false;

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
    session.offDuty = true;
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
    agent.waiting ??= { at: e.ts, ...(e.detail?.notificationType === "idle_prompt" ? { idle: true } : {}) };
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

// --------------------------------------------------------------------- rooms

/** One office room per project directory; each present session gets a pod (lead desk + staff desks). */
export interface RoomState {
  key: string;
  cwd: string;
  project: string;
  /** Pod index → session id. Holes stay put so other teams don't jump seats; trailing holes are trimmed. */
  pods: (string | null)[];
  firstSeenAt: number;
  lastEventAt: number;
}

export type RoomMap = Record<string, RoomState>;

export interface OfficeState {
  sessions: SessionMap;
  rooms: RoomMap;
}

export const EMPTY_OFFICE: OfficeState = { sessions: {}, rooms: {} };

function trimPods(room: RoomState) {
  while (room.pods.length && room.pods.at(-1) === null) room.pods.pop();
}

function seat(room: RoomState, sessionId: string) {
  if (room.pods.includes(sessionId)) return;
  const free = room.pods.indexOf(null);
  if (free >= 0) room.pods[free] = sessionId;
  else room.pods.push(sessionId);
}

function unseat(room: RoomState | undefined, sessionId: string) {
  if (!room) return;
  const i = room.pods.indexOf(sessionId);
  if (i >= 0) room.pods[i] = null;
  trimPods(room);
}

/** Drops the oldest sessions past MAX_SESSIONS (off-duty first) and rooms left without sessions. */
function prune(state: OfficeState): boolean {
  const ids = Object.keys(state.sessions);
  let pruned = false;
  if (ids.length > MAX_SESSIONS) {
    ids.sort((a, b) => {
      const sa = state.sessions[a]!;
      const sb = state.sessions[b]!;
      return Number(sa.offDuty) - Number(sb.offDuty) || sb.lastEventAt - sa.lastEventAt;
    });
    for (const id of ids.slice(MAX_SESSIONS)) {
      const key = state.sessions[id]!.room;
      if (state.rooms[key]) {
        state.rooms[key] = structuredClone(state.rooms[key]);
        unseat(state.rooms[key], id);
      }
      delete state.sessions[id];
      pruned = true;
    }
  }
  const used = new Set(Object.values(state.sessions).map((s) => s.room));
  for (const key of Object.keys(state.rooms)) {
    if (!used.has(key)) {
      delete state.rooms[key];
      pruned = true;
    }
  }
  return pruned;
}

export interface OfficeUpdate {
  state: OfficeState;
  session: SessionState;
  room: RoomState;
  /** Sessions or rooms were dropped; clients should take the full state. */
  pruned: boolean;
}

/** Applies one event: updates the session, seats it in its room, prunes old sessions. Pure. */
export function reduceOffice(prev: OfficeState, e: OfficeEvent): OfficeUpdate {
  const session = reduceSession(prev.sessions[e.sessionId], e);
  const sessions = { ...prev.sessions, [e.sessionId]: session };
  const rooms = { ...prev.rooms };
  const room: RoomState = rooms[session.room]
    ? structuredClone(rooms[session.room]!)
    : { key: session.room, cwd: session.room, project: session.project, pods: [], firstSeenAt: e.ts, lastEventAt: e.ts };
  room.lastEventAt = Math.max(room.lastEventAt, e.ts);
  if (session.offDuty) unseat(room, session.sessionId);
  else seat(room, session.sessionId);
  rooms[room.key] = room;

  const state = { sessions, rooms };
  const pruned = prune(state);
  return { state, session, room: state.rooms[room.key] ?? room, pruned };
}

/** A session blocked on the user (permission, question) stays at work; finished ones may leave. */
function blockedOnUser(session: SessionState): boolean {
  return Object.values(session.agents).some((a) => a.waiting && !a.waiting.idle);
}

/**
 * Sends sessions home after `offDutyMs` without events. Returns the same
 * object when nothing changed so callers can skip broadcasting. Pure.
 */
export function sweepOffDuty(prev: OfficeState, now: number, offDutyMs: number): OfficeState {
  let next: OfficeState | undefined;
  for (const s of Object.values(prev.sessions)) {
    if (s.offDuty || now - s.lastEventAt < offDutyMs || blockedOnUser(s)) continue;
    next ??= { sessions: { ...prev.sessions }, rooms: { ...prev.rooms } };
    next.sessions[s.sessionId] = { ...s, offDuty: true };
    const room = next.rooms[s.room];
    if (room) {
      const copy = structuredClone(room);
      unseat(copy, s.sessionId);
      next.rooms[s.room] = copy;
    }
  }
  return next ?? prev;
}

/** Closes pod holes. Only safe when nobody is watching (e.g. right after a restart), since teams move seats. */
export function compactPods(prev: OfficeState): OfficeState {
  const rooms: RoomMap = {};
  for (const [key, room] of Object.entries(prev.rooms)) rooms[key] = { ...room, pods: room.pods.filter((p) => p !== null) };
  return { sessions: prev.sessions, rooms };
}

export type RoomActivity = "waiting" | "working" | "idle" | "empty";

/** Summary for room tabs: someone waiting > someone working > present but idle > nobody there. */
export function roomActivity(room: RoomState, sessions: SessionMap): RoomActivity {
  const present = room.pods.flatMap((id) => (id && sessions[id] && !sessions[id].offDuty ? [sessions[id]] : []));
  if (!present.length) return "empty";
  const agents = present.flatMap((s) => Object.values(s.agents));
  if (agents.some((a) => a.status === "waiting" && !a.waiting?.idle)) return "waiting";
  if (agents.some((a) => a.status !== "idle" && a.status !== "done" && a.status !== "waiting")) return "working";
  return "idle";
}

/** Display names: the directory name, prefixed with its parent when two rooms share a name. */
export function roomLabels(rooms: RoomState[]): Record<string, string> {
  const base = (cwd: string) => cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  const counts = new Map<string, number>();
  for (const r of rooms) counts.set(r.project, (counts.get(r.project) ?? 0) + 1);
  const labels: Record<string, string> = {};
  for (const r of rooms) {
    const parts = base(r.cwd);
    labels[r.key] = (counts.get(r.project) ?? 0) > 1 && parts.length > 1 ? parts.slice(-2).join("/") : r.project;
  }
  return labels;
}
