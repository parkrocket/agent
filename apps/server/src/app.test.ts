import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HistoryEvents, HistoryList, OfficeEvent, ServerMessage, UsageRecord } from "@ai-office/shared";
import { buildServer, type ServerOptions } from "./app";
import { EventDb } from "./db";
import { loadModelConfig } from "./usage/models";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function tempDb(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "ai-office-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "nested", "events.db");
}

async function server(dbPath: string, extra: Partial<ServerOptions> = {}) {
  const app = await buildServer({
    // never read the real ~/.claude/projects or the user's model overrides from tests
    projectsRoot: join(dbPath, "..", "no-projects"),
    models: loadModelConfig(join(dbPath, "..", "no-user-models.json")),
    dbPath,
    offDutyMs: 10 * MIN,
    retentionMs: 7 * DAY,
    webOrigins: ["http://localhost:7421"],
    logLevel: "silent",
    ...extra,
  });
  await app.ready();
  return app;
}

let n = 0;
function event(partial: Partial<OfficeEvent> & Pick<OfficeEvent, "event">): OfficeEvent {
  return {
    v: 1,
    id: `e${++n}`,
    ts: Date.now(),
    sessionId: "s1",
    cwd: "/home/u/shop",
    project: "shop",
    agent: { kind: "main" },
    ...partial,
  };
}

/** Opens a socket and collects messages; listeners attach before open so the snapshot isn't missed. */
async function connect(app: Awaited<ReturnType<typeof server>>, origin?: string) {
  const messages: ServerMessage[] = [];
  const ws = await app.injectWS(
    "/ws",
    origin ? { headers: { origin } } : {},
    { onInit: (w) => w.on("message", (d) => messages.push(JSON.parse(String(d)))) },
  );
  return { ws, messages };
}

async function snapshot(app: Awaited<ReturnType<typeof server>>) {
  const { ws, messages } = await connect(app);
  for (let i = 0; i < 50 && !messages.length; i++) await new Promise((r) => setTimeout(r, 10));
  ws.terminate();
  const message = messages[0];
  assert.equal(message?.type, "snapshot");
  return message as Extract<ServerMessage, { type: "snapshot" }>;
}

test("POST /events accepts a valid event with 204", async (t) => {
  const app = await server(tempDb(t));
  t.after(() => app.close());
  const res = await app.inject({ method: "POST", url: "/events", payload: event({ event: "UserPromptSubmit" }) });
  assert.equal(res.statusCode, 204);
});

test("POST /events rejects unknown fields (e.g. a leaked prompt) and bad shapes with 400", async (t) => {
  const app = await server(tempDb(t));
  t.after(() => app.close());
  for (const payload of [
    { ...event({ event: "UserPromptSubmit" }), prompt: "secret" },
    { ...event({ event: "Stop" }), agent: { kind: "main", extra: 1 } },
    { ...event({ event: "Stop" }), event: "NotAnEvent" },
    { hello: "world" },
  ]) {
    const res = await app.inject({ method: "POST", url: "/events", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual((await snapshot(app)).events, [], "rejected events are not stored");
});

test("/ws rejects other origins and accepts the web app's", async (t) => {
  const app = await server(tempDb(t));
  t.after(() => app.close());
  const upgrade = { connection: "upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" };
  const evil = await app.inject({ method: "GET", url: "/ws", headers: { ...upgrade, origin: "http://evil.example" } });
  assert.equal(evil.statusCode, 403);
  const { ws } = await connect(app, "http://localhost:7421");
  ws.terminate();
});

test("events go to SQLite and a restarted server restores the office", async (t) => {
  const dbPath = tempDb(t);
  const first = await server(dbPath);
  for (const e of [
    event({ event: "UserPromptSubmit" }),
    event({ event: "SubagentStart", agent: { kind: "sub", id: "a1", type: "Explore" } }),
    event({ event: "PreToolUse", tool: "Read", file: "cart.ts", toolUseId: "t1", agent: { kind: "sub", id: "a1", type: "Explore" } }),
    event({ event: "UserPromptSubmit", sessionId: "s2", cwd: "/home/u/api", project: "api" }),
  ]) {
    assert.equal((await first.inject({ method: "POST", url: "/events", payload: e })).statusCode, 204);
  }
  await first.close();

  const second = await server(dbPath);
  t.after(() => second.close());
  const snap = await snapshot(second);
  assert.equal(snap.events.length, 4);
  assert.deepEqual(Object.keys(snap.rooms).sort(), ["/home/u/api", "/home/u/shop"]);
  const s1 = snap.sessions.s1!;
  assert.equal(s1.agents.main!.status, "thinking");
  assert.equal(s1.agents.a1!.status, "reading");
  assert.equal(s1.agents.a1!.file, "cart.ts");
  assert.equal(snap.config.offDutyMs, 10 * MIN);
  assert.ok(snap.config.models.models["claude-opus-5-5"], "model limits/prices are sent to clients");
});

test("on restart, events past retention are deleted and stale sessions are off duty", async (t) => {
  const dbPath = tempDb(t);
  const now = Date.now();
  const db = new EventDb(dbPath);
  db.insert(event({ event: "UserPromptSubmit", sessionId: "ancient", ts: now - 8 * DAY }));
  db.insert(event({ event: "UserPromptSubmit", sessionId: "stale", ts: now - 30 * MIN }));
  db.insert(event({ event: "UserPromptSubmit", sessionId: "fresh", ts: now - MIN }));
  db.close();

  const app = await server(dbPath, { now: () => now });
  t.after(() => app.close());
  const snap = await snapshot(app);
  assert.equal(snap.sessions.ancient, undefined, "older than 7 days: purged");
  assert.equal(snap.sessions.stale!.offDuty, true, "30 min idle: off duty");
  assert.equal(snap.sessions.fresh!.offDuty, false);
  assert.deepEqual(snap.rooms["/home/u/shop"]!.pods, ["fresh"]);

  const check = new EventDb(dbPath);
  assert.equal(check.count(), 2, "the purge is persisted");
  check.close();
});

test("the off-duty sweep broadcasts a state message", async (t) => {
  let clock = Date.now();
  const app = await server(tempDb(t), { now: () => clock, sweepIntervalMs: 20 });
  t.after(() => app.close());
  await app.inject({ method: "POST", url: "/events", payload: event({ event: "Stop", ts: clock }) });

  const { ws, messages } = await connect(app);
  clock += 11 * MIN;
  await new Promise((r) => setTimeout(r, 120));
  ws.terminate();

  const state = messages.find((m) => m.type === "state");
  assert.ok(state && state.type === "state", "a state message was sent");
  assert.equal(state.sessions.s1!.offDuty, true);
  assert.deepEqual(state.rooms["/home/u/shop"]!.pods, []);
});

const usageRec = (messageId: string, sessionId: string, ts: number, input: number, extra: Partial<UsageRecord> = {}): UsageRecord => ({
  messageId,
  sessionId,
  model: "claude-opus-5-5",
  ts,
  tokens: { input, output: 10, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  ...extra,
});

test("GET /history lists past sessions with events and tokens; transcript-only ones are not replayable", async (t) => {
  const dbPath = tempDb(t);
  const now = Date.now();
  const db = new EventDb(dbPath);
  db.insert(event({ event: "UserPromptSubmit", sessionId: "old", ts: now - 60 * MIN }));
  db.insert(event({ event: "Stop", sessionId: "old", ts: now - 50 * MIN }));
  db.insert(event({ event: "UserPromptSubmit", sessionId: "cur", cwd: "/home/u/api", project: "api", ts: now - MIN }));
  db.insertUsage(usageRec("m1", "old", now - 55 * MIN, 100));
  db.insertUsage(usageRec("m2", "old", now - 52 * MIN, 200, { agentId: "a1" }));
  db.insertUsage(usageRec("m3", "gone", now - 3 * DAY, 50, { cwd: "/home/u/legacy" }));
  db.close();

  const app = await server(dbPath, { now: () => now });
  t.after(() => app.close());
  const res = await app.inject({ method: "GET", url: "/history", headers: { origin: "http://localhost:7421" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], "http://localhost:7421");
  const { sessions } = res.json() as HistoryList;
  assert.deepEqual(sessions.map((s) => s.sessionId), ["cur", "old", "gone"], "newest first");
  const [cur, old, gone] = sessions;
  assert.equal(cur!.live, true);
  assert.equal(cur!.project, "api");
  assert.equal(old!.live, false);
  assert.equal(old!.events, 2);
  assert.equal(old!.startedAt, now - 60 * MIN);
  assert.equal(old!.endedAt, now - 50 * MIN);
  assert.equal(old!.tokens.input, 300, "lead and staff usage are summed");
  assert.equal(old!.replayable, true);
  assert.equal(gone!.replayable, false);
  assert.equal(gone!.events, 0);
  assert.equal(gone!.cwd, "/home/u/legacy");
  assert.equal(gone!.project, "legacy");
});

test("GET /history/:id/events returns one session's events and usage in time order, 404 when none", async (t) => {
  const dbPath = tempDb(t);
  const now = Date.now();
  const db = new EventDb(dbPath);
  // stored out of order, as async hooks can deliver them
  db.insert(event({ event: "Stop", sessionId: "s1", ts: now - 10 * MIN }));
  db.insert(event({ event: "UserPromptSubmit", sessionId: "s1", ts: now - 20 * MIN }));
  db.insert(event({ event: "UserPromptSubmit", sessionId: "other", ts: now - 15 * MIN }));
  db.insertUsage(usageRec("m2", "s1", now - 12 * MIN, 2));
  db.insertUsage(usageRec("m1", "s1", now - 18 * MIN, 1));
  db.insertUsage(usageRec("m9", "other", now - 14 * MIN, 9));
  db.insertUsage(usageRec("m5", "usageOnly", now - 14 * MIN, 5));
  db.close();

  const app = await server(dbPath, { now: () => now });
  t.after(() => app.close());
  const res = await app.inject({ method: "GET", url: "/history/s1/events" });
  assert.equal(res.statusCode, 200);
  const body = res.json() as HistoryEvents;
  assert.deepEqual(body.events.map((e) => e.event), ["UserPromptSubmit", "Stop"]);
  assert.ok(body.events.every((e) => e.sessionId === "s1"));
  assert.deepEqual(body.usage.map((u) => u.messageId), ["m1", "m2"]);

  assert.equal((await app.inject({ method: "GET", url: "/history/nope/events" })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/history/usageOnly/events" })).statusCode, 404, "transcript-only: nothing to replay");
  const long = (await app.inject({ method: "GET", url: `/history/${"x".repeat(300)}/events` })).statusCode;
  assert.ok(long >= 400 && long < 500, `overlong id rejected (${long})`);
});
