import { after, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelConfig, ServerMessage } from "@ai-office/shared";
import { EventDb } from "../db";
import { buildServer } from "../app";
import { allowedTranscript } from "./paths";
import { readIncrement } from "./reader";
import { UsageTracker } from "./tracker";

const SECRET = "SECRET-RESPONSE-TEXT";
let seq = 0;

/** A fake assistant transcript line (our own sample, not a real file). */
function line(o: { id?: string; session?: string; agent?: string; input?: number; output?: number; read?: number; ts?: number } = {}) {
  return (
    JSON.stringify({
      type: "assistant",
      sessionId: o.session ?? "s1",
      ...(o.agent ? { agentId: o.agent, isSidechain: true } : {}),
      timestamp: new Date(o.ts ?? Date.now()).toISOString(),
      cwd: "/home/u/proj",
      message: {
        id: o.id ?? `msg_${++seq}`,
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: SECRET }],
        usage: { input_tokens: o.input ?? 10, output_tokens: o.output ?? 5, cache_read_input_tokens: o.read ?? 0, cache_creation_input_tokens: 0 },
      },
    }) + "\n"
  );
}

// Removed once the whole file is done, not per test: a test's server (or DB) is closed in its
// own after-hook, and Windows can't delete a folder while the SQLite file in it is still open.
const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "ai-office-usage-"));
  tempDirs.push(dir);
  return dir;
}

const models: ModelConfig = {
  defaultContextLimit: 200_000,
  models: { "claude-opus-5-5": { contextLimit: 1_000_000, contextVerified: true, price: { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 } } },
};

test("incremental reads: appended lines, a cut-off last line, replaced and truncated files", (t) => {
  const dir = tempDir();
  const f = join(dir, "s1.jsonl");
  const second = line({ id: "m2" });
  writeFileSync(f, line({ id: "m1" }) + second.slice(0, 40)); // second line still being written

  let r = readIncrement(f, undefined);
  assert.deepEqual(r.records.map((x) => x.messageId), ["m1"]);
  assert.equal(r.next.offset, Buffer.byteLength(line({ id: "m1" })), "stops after the last complete line");

  appendFileSync(f, second.slice(40) + line({ id: "m3" }));
  r = readIncrement(f, r.next);
  assert.deepEqual(r.records.map((x) => x.messageId), ["m2", "m3"], "the cut-off line is read once complete");

  r = readIncrement(f, r.next);
  assert.deepEqual(r.records, [], "nothing new");

  // replaced by a new file (new inode): read from the start
  const g = join(dir, "tmp.jsonl");
  writeFileSync(g, line({ id: "n1" }));
  renameSync(g, f);
  r = readIncrement(f, r.next);
  assert.deepEqual(r.records.map((x) => x.messageId), ["n1"]);

  // truncated in place: read from the start
  writeFileSync(f, "");
  appendFileSync(f, line({ id: "n2" }));
  r = readIncrement(f, { offset: 10_000, ino: r.next.ino });
  assert.deepEqual(r.records.map((x) => x.messageId), ["n2"]);
});

test("only .jsonl files inside the projects root are readable", (t) => {
  const dir = tempDir();
  const root = join(dir, "projects");
  mkdirSync(join(root, "p"), { recursive: true });
  writeFileSync(join(root, "p", "s.jsonl"), "");
  writeFileSync(join(dir, "outside.jsonl"), "");
  writeFileSync(join(root, "p", "notes.txt"), "");
  // a directory link pointing outside: "junction" needs no admin rights on Windows (a plain symlink elsewhere)
  mkdirSync(join(dir, "elsewhere"));
  writeFileSync(join(dir, "elsewhere", "x.jsonl"), "");
  symlinkSync(join(dir, "elsewhere"), join(root, "p", "link"), "junction");

  assert.ok(allowedTranscript(root, join(root, "p", "s.jsonl")));
  assert.equal(allowedTranscript(root, join(dir, "outside.jsonl")), undefined);
  assert.equal(allowedTranscript(root, join(root, "p", "..", "..", "outside.jsonl")), undefined);
  assert.equal(allowedTranscript(root, join(root, "p", "link", "x.jsonl")), undefined, "a link pointing outside is refused");
  assert.equal(allowedTranscript(root, join(root, "p", "notes.txt")), undefined);
  assert.equal(allowedTranscript(root, "/etc/passwd"), undefined);
});

test("tracker: dedupes repeated message ids, follows sub-agents, tracks context, import is idempotent", (t) => {
  const dir = tempDir();
  const root = join(dir, "projects");
  const proj = join(root, "-home-u-proj");
  mkdirSync(join(proj, "s1", "subagents"), { recursive: true });
  const main = join(proj, "s1.jsonl");
  // the same API message repeated across lines (as Claude Code writes it) counts once
  writeFileSync(main, line({ id: "a", input: 100, read: 1_000 }) + line({ id: "a", input: 100, read: 1_000 }) + line({ id: "b", input: 5, read: 120_000, output: 7 }));
  writeFileSync(join(proj, "s1", "subagents", "agent-abc.jsonl"), line({ id: "c", agent: "abc", input: 50 }));

  const db = new EventDb(join(dir, "db.sqlite"));
  t.after(() => db.close());
  let changes = 0;
  const tracker = new UsageTracker(db, models, root, () => changes++);
  tracker.follow(main);

  const s = tracker.current.sessions.s1!;
  assert.equal(s.cwd, "/home/u/proj");
  assert.equal(s.agents.main!.messages, 2);
  assert.equal(s.agents.main!.tokens.input, 105);
  assert.equal(s.agents.main!.context, 5 + 120_000, "context = the latest request's prompt size");
  assert.equal(s.agents.abc!.tokens.input, 50, "sub-agent transcript found and keyed by agent id");
  assert.ok(changes > 0);
  assert.ok(!JSON.stringify(tracker.current).includes(SECRET));

  // more lines appended, then a full import: only new messages are added
  appendFileSync(main, line({ id: "d", input: 1 }));
  tracker.refresh();
  assert.equal(tracker.current.sessions.s1!.agents.main!.messages, 3);
  writeFileSync(join(proj, "old.jsonl"), line({ id: "e", session: "old" }));
  assert.deepEqual(tracker.importAll(), { files: 3, added: 1 });
  assert.deepEqual(tracker.importAll(), { files: 3, added: 0 });

  // a new tracker on the same DB rebuilds the same totals and resumes from stored positions
  const again = new UsageTracker(db, models, root, () => {});
  assert.equal(again.current.sessions.s1!.agents.main!.messages, 3);
  assert.equal(again.read(main), 0);
});

test("server: a hook event's transcript is followed and usage reaches clients; /usage/import scans the rest", async (t) => {
  const dir = tempDir();
  const root = join(dir, "projects");
  const proj = join(root, "-home-u-proj");
  mkdirSync(proj, { recursive: true });
  const main = join(proj, "s1.jsonl");
  writeFileSync(main, line({ id: "x1", input: 1_000, read: 99_000 }));
  writeFileSync(join(proj, "past.jsonl"), line({ id: "p1", session: "past" }));

  const app = await buildServer({
    dbPath: join(dir, "db.sqlite"),
    offDutyMs: 600_000,
    retentionMs: 7 * 86_400_000,
    webOrigins: [],
    logLevel: "silent",
    projectsRoot: root,
    models,
    usagePollMs: 50,
  });
  t.after(() => app.close());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/events",
    payload: { v: 1, id: "e1", ts: Date.now(), event: "UserPromptSubmit", sessionId: "s1", cwd: "/home/u/proj", project: "proj", agent: { kind: "main" }, transcript: main },
  });
  assert.equal(res.statusCode, 204);
  await new Promise((r) => setTimeout(r, 100));

  const messages: ServerMessage[] = [];
  const ws = await app.injectWS("/ws", {}, { onInit: (w) => w.on("message", (d) => messages.push(JSON.parse(String(d)))) });
  await new Promise((r) => setTimeout(r, 50));
  const snap = messages[0] as Extract<ServerMessage, { type: "snapshot" }>;
  assert.equal(snap.usage.sessions.s1!.agents.main!.context, 100_000);
  assert.equal(snap.usage.sessions.past, undefined, "unrelated transcripts aren't read until imported");
  assert.equal(snap.config.models.models["claude-opus-5-5"]!.contextLimit, 1_000_000);

  // live: a new line in the followed transcript is pushed as a usage message (throttled to ~1s)
  appendFileSync(main, line({ id: "x2", input: 1, read: 0 }));
  await new Promise((r) => setTimeout(r, 1_300));
  const update = messages.find((m) => m.type === "usage") as Extract<ServerMessage, { type: "usage" }> | undefined;
  assert.ok(update, "a usage message was broadcast");
  assert.equal(update!.usage.sessions.s1!.agents.main!.messages, 2);
  ws.terminate();

  const imported = await app.inject({ method: "POST", url: "/usage/import" });
  assert.deepEqual(imported.json(), { files: 2, added: 1 });

  // a transcript path outside the projects root is ignored
  const outside = join(dir, "evil.jsonl");
  writeFileSync(outside, line({ id: "evil", session: "s1", input: 9_999_999 }));
  await app.inject({
    method: "POST",
    url: "/events",
    payload: { v: 1, id: "e2", ts: Date.now(), event: "Stop", sessionId: "s1", cwd: "/home/u/proj", project: "proj", agent: { kind: "main" }, transcript: outside },
  });
  await new Promise((r) => setTimeout(r, 100));
  const check = await app.injectWS("/ws", {}, { onInit: (w) => w.on("message", (d) => messages.push(JSON.parse(String(d)))) });
  await new Promise((r) => setTimeout(r, 50));
  const last = messages.filter((m) => m.type === "snapshot").at(-1) as Extract<ServerMessage, { type: "snapshot" }>;
  assert.equal(last.usage.sessions.s1!.agents.main!.messages, 2, "the outside file was not read");
  check.terminate();
});
