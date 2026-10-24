import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OfficeEvent, ServerMessage } from "@ai-office/shared";
import { buildServer, type ServerOptions } from "./app";
import { EventDb } from "./db";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function tempDb(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "ai-office-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "nested", "events.db");
}

async function server(dbPath: string, extra: Partial<ServerOptions> = {}) {
  const app = await buildServer({
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
  assert.deepEqual(snap.config, { offDutyMs: 10 * MIN });
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
