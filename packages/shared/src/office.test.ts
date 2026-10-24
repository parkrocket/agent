import { test } from "node:test";
import assert from "node:assert/strict";
import type { OfficeEvent } from "./events";
import {
  EMPTY_OFFICE,
  compactPods,
  dirName,
  MAX_SESSIONS,
  SUB_DESK_COUNT,
  reduceOffice,
  reduceSession,
  roomActivity,
  roomLabels,
  sweepOffDuty,
  type OfficeState,
  type SessionState,
} from "./office";

let clock = 1000;
type Extra = Partial<Omit<OfficeEvent, "event" | "agent">> & { sub?: string; subType?: string };

function ev(event: OfficeEvent["event"], extra: Extra = {}): OfficeEvent {
  const { sub, subType, ...rest } = extra;
  return {
    v: 1,
    id: `e${clock}`,
    ts: (clock += 10),
    event,
    sessionId: "s1",
    cwd: "/home/u/demo",
    project: "demo",
    agent: sub ? { kind: "sub", id: sub, ...(subType ? { type: subType } : {}) } : { kind: "main" },
    ...rest,
  };
}

function run(...events: OfficeEvent[]): SessionState {
  return events.reduce<SessionState | undefined>((s, e) => reduceSession(s, e), undefined)!;
}

const main = (s: SessionState) => s.agents.main!;

test("SessionStart → idle, prompt → thinking, Stop → done", () => {
  let s = run(ev("SessionStart", { detail: { source: "startup" } }));
  assert.equal(main(s).status, "idle");
  s = reduceSession(s, ev("UserPromptSubmit"));
  assert.equal(main(s).status, "thinking");
  s = reduceSession(s, ev("Stop"));
  assert.equal(main(s).status, "done");
});

test("tool categories map to statuses with a bubble", () => {
  for (const [tool, status] of [
    ["Read", "reading"],
    ["Grep", "reading"],
    ["Glob", "reading"],
    ["Edit", "writing"],
    ["Write", "writing"],
    ["Bash", "running"],
    ["TodoWrite", "thinking"],
  ] as const) {
    const s = run(ev("UserPromptSubmit"), ev("PreToolUse", { tool, file: "a.ts", toolUseId: "t1" }));
    assert.equal(main(s).status, status, tool);
    assert.equal(main(s).tool, tool);
    assert.equal(main(s).file, "a.ts");
    const after = reduceSession(s, ev("PostToolUse", { tool, toolUseId: "t1" }));
    assert.equal(main(after).status, "thinking");
    assert.equal(main(after).tool, undefined);
  }
});

test("starts a session without SessionStart (missed events)", () => {
  const s = run(ev("PreToolUse", { tool: "Read", file: "x.md", toolUseId: "t1" }));
  assert.equal(s.sessionId, "s1");
  assert.equal(main(s).status, "reading");
});

test("parallel tools: thinking only after all finish; bubble follows latest", () => {
  let s = run(
    ev("UserPromptSubmit"),
    ev("PreToolUse", { tool: "Read", file: "a.ts", toolUseId: "t1" }),
    ev("PreToolUse", { tool: "Grep", toolUseId: "t2" }),
    ev("PreToolUse", { tool: "Bash", toolUseId: "t3" }),
  );
  assert.equal(main(s).status, "running");
  assert.equal(main(s).tool, "Bash");

  s = reduceSession(s, ev("PostToolUse", { tool: "Read", toolUseId: "t1" }));
  assert.equal(main(s).tool, "Bash", "finishing an older tool keeps the latest bubble");

  s = reduceSession(s, ev("PostToolUse", { tool: "Bash", toolUseId: "t3" }));
  assert.equal(main(s).status, "reading", "falls back to the latest still-running tool");
  assert.equal(main(s).tool, "Grep");

  s = reduceSession(s, ev("PostToolUseFailure", { tool: "Grep", toolUseId: "t2" }));
  assert.equal(main(s).status, "thinking");
  assert.deepEqual(main(s).activeTools, []);
});

test("Post arriving before its Pre (async hooks) does not leave a stuck tool", () => {
  let s = run(ev("UserPromptSubmit"));
  s = reduceSession(s, ev("PostToolUse", { tool: "Read", toolUseId: "t1" }));
  s = reduceSession(s, ev("PreToolUse", { tool: "Read", file: "a.ts", toolUseId: "t1" }));
  assert.equal(main(s).status, "thinking");
  assert.deepEqual(main(s).activeTools, []);
});

test("tool events stamped before Stop are ignored", () => {
  const late = ev("PreToolUse", { tool: "Read", toolUseId: "t9" });
  const s = reduceSession(run(ev("UserPromptSubmit"), ev("Stop")), late);
  assert.equal(main(s).status, "done");
});

test("PermissionRequest raises a hand; approval clears it via the tool's Post", () => {
  let s = run(
    ev("UserPromptSubmit"),
    ev("PreToolUse", { tool: "Bash", toolUseId: "t1" }),
    ev("PermissionRequest", { tool: "Bash" }),
    ev("Notification", { detail: { notificationType: "permission_prompt" } }),
  );
  assert.equal(main(s).status, "waiting");
  assert.equal(main(s).tool, "Bash");
  s = reduceSession(s, ev("PostToolUse", { tool: "Bash", toolUseId: "t1" }));
  assert.equal(main(s).status, "thinking");
});

test("denied permission: next PreToolUse or Stop clears waiting even without a Post", () => {
  const base = [
    ev("UserPromptSubmit"),
    ev("PreToolUse", { tool: "Bash", toolUseId: "t1" }),
    ev("PermissionRequest", { tool: "Bash" }),
  ];
  let s = run(...base, ev("PreToolUse", { tool: "Read", file: "b.ts", toolUseId: "t2" }));
  assert.equal(main(s).status, "reading");
  assert.equal(main(s).tool, "Read");
  s = reduceSession(s, ev("PostToolUse", { tool: "Read", toolUseId: "t2" }));
  assert.equal(main(s).status, "thinking", "the denied Bash does not come back as a stale bubble");

  s = run(...base, ev("Stop"));
  assert.equal(main(s).status, "done");
  assert.deepEqual(main(s).activeTools, [], "Stop drops the denied tool that never got a Post");
});

test("waiting is cleared only by the same agent's events", () => {
  let s = run(
    ev("UserPromptSubmit"),
    ev("SubagentStart", { sub: "a1", subType: "Explore" }),
    ev("PermissionRequest", { sub: "a1", tool: "Bash" }),
    ev("Notification", { detail: { notificationType: "permission_prompt" } }),
  );
  assert.equal(s.agents.a1!.status, "waiting");
  assert.notEqual(main(s).status, "waiting", "Notification does not double-raise the lead");

  s = reduceSession(s, ev("PostToolUse", { tool: "Agent", toolUseId: "other" }));
  assert.equal(s.agents.a1!.status, "waiting", "another agent's event does not clear it");

  s = reduceSession(s, ev("PreToolUse", { sub: "a1", tool: "Read", toolUseId: "t5" }));
  assert.equal(s.agents.a1!.status, "reading");
});

test("idle_prompt notification makes the lead wait until the next prompt", () => {
  let s = run(ev("UserPromptSubmit"), ev("Stop"), ev("Notification", { detail: { notificationType: "idle_prompt" } }));
  assert.equal(main(s).status, "waiting");
  s = reduceSession(s, ev("UserPromptSubmit"));
  assert.equal(main(s).status, "thinking");
  const ignored = reduceSession(s, ev("Notification", { detail: { notificationType: "auth_success" } }));
  assert.equal(main(ignored).status, "thinking");
});

test("sub-agents take the first free desk and free it on SubagentStop", () => {
  let s = run(
    ev("UserPromptSubmit"),
    ev("SubagentStart", { sub: "a1", subType: "Explore" }),
    ev("SubagentStart", { sub: "a2", subType: "Plan" }),
  );
  assert.equal(s.agents.a1!.desk, 1);
  assert.equal(s.agents.a2!.desk, 2);
  assert.equal(s.agents.a1!.type, "Explore");

  s = reduceSession(s, ev("SubagentStop", { sub: "a1" }));
  assert.equal(s.agents.a1, undefined);
  s = reduceSession(s, ev("SubagentStart", { sub: "a3" }));
  assert.equal(s.agents.a3!.desk, 1, "reuses the freed desk");
});

test("sub-agent tools are tracked separately from the lead", () => {
  const s = run(
    ev("UserPromptSubmit"),
    ev("PreToolUse", { tool: "Agent", toolUseId: "m1" }),
    ev("SubagentStart", { sub: "a1" }),
    ev("PreToolUse", { sub: "a1", tool: "Grep", toolUseId: "t1" }),
  );
  assert.equal(main(s).tool, "Agent");
  assert.equal(s.agents.a1!.status, "reading");
});

test("unknown sub-agent is auto-added; overflow stands without a desk", () => {
  const events = [ev("UserPromptSubmit")];
  for (let i = 0; i <= SUB_DESK_COUNT; i++) events.push(ev("PreToolUse", { sub: `a${i}`, tool: "Read", toolUseId: `t${i}` }));
  const s = run(...events);
  assert.equal(s.agents.a0!.desk, 1);
  assert.equal(s.agents[`a${SUB_DESK_COUNT}`]!.desk, -1);
});

test("SessionEnd removes sub-agents; SessionStart(compact) keeps state", () => {
  let s = run(ev("UserPromptSubmit"), ev("SubagentStart", { sub: "a1" }), ev("PreToolUse", { tool: "Read", toolUseId: "t1" }));
  const compacted = reduceSession(s, ev("SessionStart", { detail: { source: "compact" } }));
  assert.ok(compacted.agents.a1);
  assert.equal(main(compacted).status, "reading");

  s = reduceSession(s, ev("SessionEnd", { detail: { reason: "prompt_input_exit" } }));
  assert.equal(s.ended, true);
  assert.deepEqual(Object.keys(s.agents), ["main"]);
});

test("reducer does not mutate the previous state", () => {
  const s1 = run(ev("UserPromptSubmit"));
  const frozen = structuredClone(s1);
  reduceSession(s1, ev("PreToolUse", { tool: "Read", toolUseId: "t1" }));
  assert.deepEqual(s1, frozen);
});

// ------------------------------------------------------------------ rooms

function office(...events: OfficeEvent[]): OfficeState {
  return events.reduce((st, e) => reduceOffice(st, e).state, EMPTY_OFFICE);
}
const at = (e: OfficeEvent, sessionId: string, cwd: string) => ({
  ...e,
  sessionId,
  cwd,
  project: cwd.split("/").at(-1)!,
});

test("sessions in the same cwd share a room, each with its own pod", () => {
  const st = office(
    at(ev("UserPromptSubmit"), "a", "/p/shop"),
    at(ev("UserPromptSubmit"), "b", "/p/shop"),
    at(ev("UserPromptSubmit"), "c", "/p/api"),
  );
  assert.deepEqual(Object.keys(st.rooms).sort(), ["/p/api", "/p/shop"]);
  assert.deepEqual(st.rooms["/p/shop"]!.pods, ["a", "b"]);
  assert.deepEqual(st.rooms["/p/api"]!.pods, ["c"]);
});

test("a session keeps its room even if its cwd changes later", () => {
  const st = office(at(ev("UserPromptSubmit"), "a", "/p/shop"), at(ev("PreToolUse", { tool: "Read", toolUseId: "t" }), "a", "/p/shop/sub"));
  assert.deepEqual(Object.keys(st.rooms), ["/p/shop"]);
  assert.equal(st.sessions.a!.room, "/p/shop");
  assert.equal(st.sessions.a!.cwd, "/p/shop/sub");
});

test("pods are stable: a freed pod leaves a hole that the next session fills", () => {
  let st = office(
    at(ev("UserPromptSubmit"), "a", "/p/shop"),
    at(ev("UserPromptSubmit"), "b", "/p/shop"),
    at(ev("UserPromptSubmit"), "c", "/p/shop"),
  );
  st = reduceOffice(st, at(ev("SessionEnd"), "a", "/p/shop")).state;
  assert.deepEqual(st.rooms["/p/shop"]!.pods, [null, "b", "c"], "b and c keep their pods");
  st = reduceOffice(st, at(ev("UserPromptSubmit"), "d", "/p/shop")).state;
  assert.deepEqual(st.rooms["/p/shop"]!.pods, ["d", "b", "c"]);
  st = reduceOffice(st, at(ev("SessionEnd"), "c", "/p/shop")).state;
  assert.deepEqual(st.rooms["/p/shop"]!.pods, ["d", "b"], "trailing holes are trimmed");
});

test("compactPods closes holes (used once at boot) without touching sessions", () => {
  let st = office(at(ev("UserPromptSubmit"), "a", "/p/shop"), at(ev("UserPromptSubmit"), "b", "/p/shop"));
  st = reduceOffice(st, at(ev("SessionEnd"), "a", "/p/shop")).state;
  const compact = compactPods(st);
  assert.deepEqual(compact.rooms["/p/shop"]!.pods, ["b"]);
  assert.deepEqual(st.rooms["/p/shop"]!.pods, [null, "b"], "input is not mutated");
  assert.equal(compact.sessions, st.sessions);
});

test("SessionEnd sends the session home at once", () => {
  const st = office(at(ev("UserPromptSubmit"), "a", "/p/shop"), at(ev("SessionEnd"), "a", "/p/shop"));
  assert.equal(st.sessions.a!.offDuty, true);
  assert.equal(roomActivity(st.rooms["/p/shop"]!, st.sessions), "empty");
});

test("off duty after the configured idle time; back to work on the next event", () => {
  const OFF = 10 * 60_000;
  let st = office(at(ev("UserPromptSubmit"), "a", "/p/shop"), at(ev("Stop"), "a", "/p/shop"));
  const last = st.sessions.a!.lastEventAt;

  assert.equal(sweepOffDuty(st, last + OFF - 1, OFF), st, "unchanged state is returned as-is");
  st = sweepOffDuty(st, last + OFF, OFF);
  assert.equal(st.sessions.a!.offDuty, true);
  assert.deepEqual(st.rooms["/p/shop"]!.pods, []);
  assert.equal(roomActivity(st.rooms["/p/shop"]!, st.sessions), "empty");

  const custom = sweepOffDuty(office(at(ev("UserPromptSubmit"), "x", "/p/q")), clock + 30_001, 30_000);
  assert.equal(custom.sessions.x!.offDuty, true, "the threshold comes from the caller");

  st = reduceOffice(st, at(ev("UserPromptSubmit"), "a", "/p/shop")).state;
  assert.equal(st.sessions.a!.offDuty, false);
  assert.deepEqual(st.rooms["/p/shop"]!.pods, ["a"]);
});

test("a session waiting for permission is not sent home; one idle at the prompt is", () => {
  const OFF = 60_000;
  const blocked = office(
    at(ev("UserPromptSubmit"), "a", "/p/shop"),
    at(ev("PermissionRequest", { tool: "Bash" }), "a", "/p/shop"),
  );
  assert.equal(sweepOffDuty(blocked, clock + OFF * 5, OFF).sessions.a!.offDuty, false);

  const idle = office(
    at(ev("Stop"), "b", "/p/shop"),
    at(ev("Notification", { detail: { notificationType: "idle_prompt" } }), "b", "/p/shop"),
  );
  assert.equal(sweepOffDuty(idle, clock + OFF * 5, OFF).sessions.b!.offDuty, true);
});

test("room with every session off duty is empty; others keep working", () => {
  let st = office(
    at(ev("UserPromptSubmit"), "a", "/p/shop"),
    at(ev("UserPromptSubmit"), "b", "/p/shop"),
  );
  st = reduceOffice(st, at(ev("PreToolUse", { tool: "Edit", toolUseId: "t" }), "b", "/p/shop")).state;
  st = reduceOffice(st, at(ev("SessionEnd"), "a", "/p/shop")).state;
  assert.equal(roomActivity(st.rooms["/p/shop"]!, st.sessions), "working");
  st = reduceOffice(st, at(ev("SessionEnd"), "b", "/p/shop")).state;
  assert.equal(roomActivity(st.rooms["/p/shop"]!, st.sessions), "empty");
});

test("roomActivity: waiting beats working beats idle", () => {
  let st = office(at(ev("SessionStart"), "a", "/p/shop"), at(ev("SessionStart"), "b", "/p/shop"));
  assert.equal(roomActivity(st.rooms["/p/shop"]!, st.sessions), "idle");
  st = reduceOffice(st, at(ev("PreToolUse", { tool: "Read", toolUseId: "t" }), "a", "/p/shop")).state;
  assert.equal(roomActivity(st.rooms["/p/shop"]!, st.sessions), "working");
  st = reduceOffice(st, at(ev("PermissionRequest", { tool: "Bash" }), "b", "/p/shop")).state;
  assert.equal(roomActivity(st.rooms["/p/shop"]!, st.sessions), "waiting");
});

test("roomLabels disambiguates rooms with the same directory name", () => {
  const st = office(
    at(ev("UserPromptSubmit"), "a", "/home/u/work/agent"),
    at(ev("UserPromptSubmit"), "b", "/home/u/play/agent"),
    at(ev("UserPromptSubmit"), "c", "/home/u/shop"),
  );
  assert.deepEqual(roomLabels(Object.values(st.rooms)), {
    "/home/u/work/agent": "work/agent",
    "/home/u/play/agent": "play/agent",
    "/home/u/shop": "shop",
  });
});

test("reduceOffice caps sessions, dropping off-duty ones first, and is pure", () => {
  let st = office(at(ev("UserPromptSubmit"), "keep", "/p/a"));
  st = reduceOffice(st, at(ev("SessionEnd"), "gone", "/p/old")).state;
  // keep + gone + (MAX_SESSIONS - 2) = MAX_SESSIONS; one more forces exactly one drop
  for (let i = 0; i < MAX_SESSIONS - 2; i++) st = reduceOffice(st, at(ev("UserPromptSubmit"), `n${i}`, "/p/a")).state;
  const before = structuredClone(st);
  const { state, pruned } = reduceOffice(st, at(ev("UserPromptSubmit"), "new", "/p/a"));
  assert.equal(pruned, true);
  assert.equal(Object.keys(state.sessions).length, MAX_SESSIONS);
  assert.ok(!state.sessions.gone, "the off-duty session goes first");
  assert.ok(state.sessions.keep, "an older but present session stays");
  assert.ok(!state.rooms["/p/old"], "a room with no sessions left is removed");
  assert.deepEqual(st, before, "previous state is not mutated");
});

test("dirName: last path segment for POSIX and Windows paths", () => {
  assert.equal(dirName("/home/u/shop"), "shop");
  assert.equal(dirName("/home/u/shop/"), "shop");
  assert.equal(dirName("C:\\work\\shop"), "shop");
  assert.equal(dirName("C:\\work\\shop\\"), "shop");
  assert.equal(dirName("C:/work/shop"), "shop");
  assert.equal(dirName("/"), "/");
});
