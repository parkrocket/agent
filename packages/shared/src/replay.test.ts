import { test } from "node:test";
import assert from "node:assert/strict";
import type { OfficeEvent } from "./events";
import type { ModelConfig } from "./models";
import type { UsageRecord } from "./transcript";
import { Replayer, advance, buildTimeline, officeAt, toPlay, toReal } from "./replay";
import { usageAt } from "./usage";

const T0 = 1_700_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const OFF = 10 * MIN;

let n = 0;
function ev(event: OfficeEvent["event"], at: number, extra: Partial<OfficeEvent> = {}): OfficeEvent {
  return {
    v: 1,
    id: `e${++n}`,
    ts: T0 + at,
    event,
    sessionId: "s1",
    cwd: "/home/u/demo",
    project: "demo",
    agent: { kind: "main" },
    ...extra,
  };
}

/** 0–20s busy, a 15-minute quiet stretch, then 10s more work. */
function session(): OfficeEvent[] {
  return [
    ev("SessionStart", 0, { detail: { source: "startup" } }),
    ev("UserPromptSubmit", 1 * SEC),
    ev("PreToolUse", 2 * SEC, { tool: "Read", toolUseId: "t1", file: "a.ts" }),
    ev("PostToolUse", 5 * SEC, { tool: "Read", toolUseId: "t1" }),
    ev("SubagentStart", 6 * SEC, { agent: { kind: "sub", id: "x1", type: "Explore" } }),
    ev("PreToolUse", 8 * SEC, { tool: "Edit", toolUseId: "t2", file: "b.ts" }),
    ev("PermissionRequest", 9 * SEC, { tool: "Edit", file: "b.ts" }),
    ev("SubagentStop", 15 * SEC, { agent: { kind: "sub", id: "x1" } }),
    ev("Stop", 20 * SEC),
    // 15 minutes of nothing
    ev("UserPromptSubmit", 20 * SEC + 15 * MIN),
    ev("PreToolUse", 22 * SEC + 15 * MIN, { tool: "Bash", toolUseId: "t3" }),
    ev("PostToolUse", 25 * SEC + 15 * MIN, { tool: "Bash", toolUseId: "t3" }),
    ev("Stop", 30 * SEC + 15 * MIN),
  ];
}

test("timeline squeezes only gaps longer than 30s, into 2s", () => {
  const tl = buildTimeline(session(), { tailMs: 0 });
  const squeezed = tl.segments.filter((s) => s.skippedMs !== undefined);
  assert.equal(squeezed.length, 1);
  assert.equal(squeezed[0]!.skippedMs, 15 * MIN);
  assert.equal(squeezed[0]!.playEnd - squeezed[0]!.playStart, 2 * SEC);
  // 20s + 2s + 10s of playback
  assert.equal(tl.playDuration, 32 * SEC);
  // a 30s gap (not longer) stays as it is
  const edge = buildTimeline([ev("UserPromptSubmit", 0), ev("Stop", 30 * SEC)], { tailMs: 0 });
  assert.equal(edge.playDuration, 30 * SEC);
  assert.equal(edge.segments.some((s) => s.skippedMs !== undefined), false);
});

test("timeline sorts events that arrived out of order", () => {
  const events = session();
  const tl = buildTimeline([...events].reverse());
  assert.deepEqual(tl.events.map((e) => e.id), events.map((e) => e.id));
  assert.equal(tl.start, T0);
});

test("play time ↔ real time: true clock inside the squeezed stretch", () => {
  const tl = buildTimeline(session());
  assert.equal(toReal(tl, 0), T0);
  assert.equal(toReal(tl, 10 * SEC), T0 + 10 * SEC);
  // halfway through the 2s squeeze is halfway through the 15 minutes
  assert.equal(toReal(tl, 21 * SEC), T0 + 20 * SEC + 7.5 * MIN);
  assert.equal(toReal(tl, 22 * SEC), T0 + 20 * SEC + 15 * MIN);
  assert.equal(toReal(tl, 25 * SEC), T0 + 23 * SEC + 15 * MIN);
  for (const p of [0, 3 * SEC, 20.5 * SEC, 21 * SEC, 30 * SEC, tl.playDuration]) assert.equal(toPlay(tl, toReal(tl, p)), p);
  // the tail runs past the last event, and nothing goes beyond the end
  assert.equal(toReal(tl, tl.playDuration), tl.end);
  assert.equal(toReal(tl, tl.playDuration + 99 * SEC), tl.end);
});

test("speeds 1x / 4x / 16x advance the playhead accordingly", () => {
  const tl = buildTimeline(session());
  for (const speed of [1, 4, 16]) {
    let play = 0;
    for (let i = 0; i < 10; i++) play = advance(play, 100, speed, tl.playDuration).playMs; // one wall second
    assert.equal(play, speed * SEC);
    assert.equal(toReal(tl, play), T0 + speed * SEC);
  }
  // 16x crosses the squeezed 15 minutes in an eighth of a wall second
  const before = 20 * SEC;
  const after = advance(before, 125, 16, tl.playDuration).playMs;
  assert.equal(toReal(tl, after) - toReal(tl, before), 15 * MIN);
});

test("playback stops at the end", () => {
  const tl = buildTimeline(session());
  let r = { playMs: tl.playDuration - 500, ended: false };
  r = advance(r.playMs, 1000, 16, tl.playDuration);
  assert.deepEqual(r, { playMs: tl.playDuration, ended: true });
  assert.equal(advance(0, 100, 1, tl.playDuration).ended, false);
});

test("seeking (forward, back, forward) matches a recompute from the start", () => {
  const tl = buildTimeline(session());
  const replayer = new Replayer(tl.events, OFF);
  const points = [0, 3, 9.5, 30, 12, 6, 16, 21, 25, 32, 1, tl.playDuration / SEC].map((s) => toReal(tl, s * SEC));
  for (const ts of points) assert.deepEqual(replayer.at(ts), officeAt(tl.events, ts, OFF), `at +${ts - T0}ms`);
  // incremental steps at a fine grain too
  const fresh = new Replayer(tl.events, OFF);
  for (let p = 0; p <= tl.playDuration; p += 250) {
    const ts = toReal(tl, p);
    assert.deepEqual(fresh.at(ts), officeAt(tl.events, ts, OFF));
  }
});

test("the replayer hands back the same object while nothing changes", () => {
  const tl = buildTimeline(session());
  const replayer = new Replayer(tl.events, OFF);
  const a = replayer.at(T0 + 3 * SEC);
  assert.equal(replayer.at(T0 + 3.5 * SEC), a);
  assert.notEqual(replayer.at(T0 + 5 * SEC), a, "a new event");
  const b = replayer.at(T0 + 21 * SEC);
  assert.notEqual(replayer.at(T0 + 20 * SEC + 11 * MIN), b, "went off duty");
});

test("state at a point in time: hand raised, staff present, then gone", () => {
  const tl = buildTimeline(session());
  const at = (s: number) => officeAt(tl.events, T0 + s * SEC, OFF).sessions.s1!;
  assert.equal(at(3).agents.main!.status, "reading");
  assert.equal(at(10).agents.main!.status, "waiting");
  assert.equal(at(10).agents.x1?.type, "Explore");
  assert.equal(at(16).agents.x1, undefined);
  assert.equal(at(21).agents.main!.status, "done");
  // before the first event there is nothing yet
  assert.deepEqual(officeAt(tl.events, T0 - 1, OFF), { sessions: {}, rooms: {} });
});

test("the team goes home during a long squeezed stretch, and comes back", () => {
  const tl = buildTimeline(session());
  const replayer = new Replayer(tl.events, OFF);
  const mid = replayer.at(toReal(tl, 21.9 * SEC)); // ~14 minutes into the quiet stretch
  assert.equal(mid.sessions.s1!.offDuty, true);
  assert.deepEqual(mid.rooms["/home/u/demo"]!.pods, []);
  const back = replayer.at(toReal(tl, 23 * SEC));
  assert.equal(back.sessions.s1!.offDuty, false);
  assert.deepEqual(back.rooms["/home/u/demo"]!.pods, ["s1"]);
});

const models: ModelConfig = {
  defaultContextLimit: 200_000,
  models: { "claude-x": { contextLimit: 1_000_000, contextVerified: true, price: { input: 1, output: 2, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } } },
};
const rec = (id: string, at: number, input: number, agentId?: string): UsageRecord => ({
  messageId: id,
  sessionId: "s1",
  ...(agentId ? { agentId } : {}),
  model: "claude-x",
  ts: T0 + at,
  tokens: { input, output: 10, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
});

test("usageAt counts only messages up to then; context is the latest request at that time", () => {
  const records = [rec("m1", 1 * SEC, 1000), rec("m2", 4 * SEC, 5000), rec("m3", 7 * SEC, 800, "x1"), rec("m4", 20 * SEC, 9000)];
  assert.deepEqual(usageAt(records, models, T0).sessions, {});
  const mid = usageAt(records, models, T0 + 7 * SEC).sessions.s1!;
  assert.equal(mid.agents.main!.context, 5000);
  assert.equal(mid.agents.main!.messages, 2);
  assert.equal(mid.agents.main!.tokens.input, 6000);
  assert.equal(mid.agents.x1!.context, 800);
  const end = usageAt(records, models, T0 + 30 * SEC).sessions.s1!;
  assert.equal(end.agents.main!.context, 9000);
  assert.equal(end.agents.main!.messages, 3);
});
