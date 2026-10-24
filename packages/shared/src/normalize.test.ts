import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { OfficeEvent } from "./events";
import type { ModelConfig } from "./models";
import { DEFAULT_OFF_DUTY_MS, EMPTY_OFFICE, reduceOffice, type OfficeState } from "./office";
import { usageAt } from "./usage";
import { normalizeHistoryEvents, normalizeHistoryList, normalizeServerMessage } from "./normalize";

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
const event = { v: 1, id: "e1", ts: 1000, event: "PreToolUse", sessionId: "s1", cwd: "/p", project: "p", agent: { kind: "main" } };

test("a current server's state passes through unchanged", () => {
  const events: OfficeEvent[] = [
    { ...event, toolUseId: "t1", tool: "Edit", file: "a.ts" } as OfficeEvent,
    { ...event, id: "e2", ts: 1100, event: "PreToolUse", toolUseId: "t2", tool: "Read", agent: { kind: "sub", id: "x1", type: "Explore" } } as OfficeEvent,
    { ...event, id: "e3", ts: 1200, event: "Notification", notificationType: "permission_prompt" } as OfficeEvent,
    { ...event, id: "e4", ts: 1300, sessionId: "s2", event: "SessionStart" } as OfficeEvent,
  ];
  let office: OfficeState = EMPTY_OFFICE;
  for (const e of events) office = reduceOffice(office, e).state;
  const state = { type: "state", ...office };
  assert.deepEqual(normalizeServerMessage(JSON.parse(JSON.stringify(state))), state);

  const models = JSON.parse(readFileSync(new URL("../../../config/models.default.json", import.meta.url), "utf8")) as ModelConfig;
  const usage = usageAt(
    [
      { sessionId: "s1", messageId: "m1", ts: 1000, model: "claude-opus-5-5", cwd: "/p", tokens: { ...ZERO, input: 10, output: 3 } },
      { sessionId: "s1", agentId: "x1", messageId: "m2", ts: 1100, model: "claude-haiku-5-5", tokens: { ...ZERO, cacheRead: 7 } },
    ],
    models,
    2000,
  );
  const snapshot = { type: "snapshot", events, ...office, config: { offDutyMs: 60_000, models }, usage };
  assert.deepEqual(normalizeServerMessage(JSON.parse(JSON.stringify(snapshot))), snapshot);
});

test("snapshot from an older server: missing rooms, usage and config get empty values", () => {
  const msg = normalizeServerMessage({ type: "snapshot", events: [event], sessions: {} });
  assert.deepEqual(msg, {
    type: "snapshot",
    events: [event],
    sessions: {},
    rooms: {},
    config: { offDutyMs: DEFAULT_OFF_DUTY_MS, models: { defaultContextLimit: 200_000, models: {} } },
    usage: { sessions: {}, hours: {} },
  });
});

test("nested state missing newer fields is filled so the renderer can iterate it", () => {
  const msg = normalizeServerMessage({
    type: "state",
    sessions: { s1: { sessionId: "s1", cwd: "/p", agents: { main: { kind: "main", status: "thinking" } } } },
    rooms: { "/p": { cwd: "/p" } },
  });
  assert.equal(msg?.type, "state");
  if (msg?.type !== "state") return;
  const s = msg.sessions.s1!;
  assert.equal(s.room, "/p", "room falls back to cwd");
  assert.equal(s.offDuty, false);
  const a = s.agents.main!;
  assert.equal(a.key, "main");
  assert.equal(a.status, "thinking");
  assert.deepEqual(a.activeTools, []);
  assert.deepEqual(a.recentDone, []);
  assert.equal(a.waiting, undefined);
  assert.deepEqual(msg.rooms["/p"], { cwd: "/p", key: "/p", project: "", pods: [], firstSeenAt: 0, lastEventAt: 0 });
});

test("fields from a newer server are kept, not stripped", () => {
  const msg = normalizeServerMessage({ type: "state", sessions: { s1: { sessionId: "s1", agents: {}, mood: "happy" } }, rooms: {} });
  assert.equal(msg?.type === "state" && (msg.sessions.s1 as unknown as { mood: string }).mood, "happy");
});

test("usage with missing token fields and cost becomes zeros", () => {
  const msg = normalizeServerMessage({
    type: "usage",
    usage: { sessions: { s1: { agents: { main: { tokens: { input: 5 }, context: 5 } } } }, hours: { "1": {} } },
  });
  assert.deepEqual(msg, {
    type: "usage",
    usage: {
      sessions: {
        s1: {
          sessionId: "s1",
          firstTs: 0,
          lastTs: 0,
          agents: { main: { tokens: { ...ZERO, input: 5 }, context: 5, model: "", lastTs: 0, messages: 0, cost: 0 } },
        },
      },
      hours: { "1": { tokens: ZERO, cost: 0 } },
    },
  });
});

test("unusable messages are dropped instead of throwing", () => {
  for (const raw of [null, 3, "x", [], {}, { type: "later-kind" }, { type: "event", event }, { type: "event", session: {}, room: {} }]) {
    assert.equal(normalizeServerMessage(raw), undefined, JSON.stringify(raw));
  }
  // garbage inside a valid message is skipped entry by entry
  const msg = normalizeServerMessage({ type: "snapshot", events: [event, null, { id: "x" }], sessions: { a: null, b: 3 }, rooms: [], usage: "?" });
  assert.equal(msg?.type, "snapshot");
  if (msg?.type !== "snapshot") return;
  assert.deepEqual(msg.events, [event]);
  assert.deepEqual(msg.sessions, {});
  assert.deepEqual(msg.rooms, {});
});

test("history list and events tolerate missing fields", () => {
  assert.deepEqual(normalizeHistoryList({}), { sessions: [] });
  const list = normalizeHistoryList({ sessions: [{ sessionId: "s1", startedAt: 1, endedAt: 2, events: 3 }, { nope: true }] });
  assert.deepEqual(list.sessions, [
    { sessionId: "s1", startedAt: 1, endedAt: 2, events: 3, tokens: ZERO, replayable: true, live: false },
  ]);
  assert.equal(normalizeHistoryList({ sessions: [{ sessionId: "s2", events: 0 }] }).sessions[0]!.replayable, false);

  assert.deepEqual(normalizeHistoryEvents({ events: [event] }), { events: [event], usage: [] });
  const body = normalizeHistoryEvents({ events: [], usage: [{ sessionId: "s1", ts: 5, messageId: "m" }, { ts: 6 }] });
  assert.deepEqual(body.usage, [{ sessionId: "s1", ts: 5, messageId: "m", model: "", tokens: ZERO }]);
});
