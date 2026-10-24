import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitize } from "./sanitize.mjs";

const TRANSCRIPT = "/home/u/.claude/projects/-home-u-projects-agent/s1.jsonl";
const base = { session_id: "s1", cwd: "/home/u/projects/agent", transcript_path: TRANSCRIPT, permission_mode: "default" };
const SECRET = "TOP-SECRET-CONTENT";

function assertNoSecret(out) {
  const json = JSON.stringify(out);
  assert.ok(!json.includes(SECRET), `leaked: ${json}`);
  // the transcript is forwarded as a path only (the server reads usage numbers from it)
  if (out?.transcript !== undefined) assert.ok(out.transcript.endsWith(".jsonl"), `odd transcript: ${json}`);
}

test("UserPromptSubmit drops prompt", () => {
  const out = sanitize({ ...base, hook_event_name: "UserPromptSubmit", prompt: SECRET, session_title: SECRET });
  assert.equal(out.event, "UserPromptSubmit");
  assert.equal(out.project, "agent");
  assert.deepEqual(out.agent, { kind: "main" });
  assertNoSecret(out);
});

test("PreToolUse Write keeps tool and basename only", () => {
  const out = sanitize({
    ...base,
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: "/home/u/projects/agent/src/index.ts", content: SECRET },
    tool_use_id: "toolu_1",
  });
  assert.equal(out.tool, "Write");
  assert.equal(out.file, "index.ts");
  assert.equal(out.toolUseId, "toolu_1");
  assertNoSecret(out);
});

test("Windows paths reduce to basename", () => {
  const out = sanitize({ ...base, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "C:\\proj\\src\\a.ts" } });
  assert.equal(out.file, "a.ts");
});

test("Bash command, Edit strings and tool_response are dropped", () => {
  for (const tool_input of [
    { command: `echo ${SECRET}`, description: SECRET },
    { file_path: "/x/y.ts", old_string: SECRET, new_string: SECRET },
  ]) {
    const out = sanitize({
      ...base,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input,
      tool_response: { stdout: SECRET },
      duration_ms: 12,
    });
    assert.equal(out.detail.durationMs, 12);
    assertNoSecret(out);
  }
});

test("Agent tool prompt is dropped", () => {
  const out = sanitize({ ...base, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { prompt: SECRET, description: SECRET, subagent_type: "Explore" } });
  assert.equal(out.file, undefined);
  assertNoSecret(out);
});

test("PostToolUseFailure drops error", () => {
  const out = sanitize({ ...base, hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: {}, error: SECRET, is_interrupt: true });
  assert.equal(out.detail.isInterrupt, true);
  assertNoSecret(out);
});

test("Notification keeps only notification_type", () => {
  const out = sanitize({ ...base, hook_event_name: "Notification", message: SECRET, title: SECRET, notification_type: "permission_prompt" });
  assert.equal(out.detail.notificationType, "permission_prompt");
  assertNoSecret(out);
});

test("subagent events identify the agent and drop last message", () => {
  const out = sanitize({
    ...base,
    hook_event_name: "SubagentStop",
    agent_id: "a1",
    agent_type: "Explore",
    agent_transcript_path: "/home/u/.claude/projects/p/s1/subagents/agent-a1.jsonl",
    last_assistant_message: SECRET,
    stop_hook_active: false,
  });
  assert.deepEqual(out.agent, { kind: "sub", id: "a1", type: "Explore" });
  assertNoSecret(out);
});

test("Stop drops last_assistant_message", () => {
  assertNoSecret(sanitize({ ...base, hook_event_name: "Stop", last_assistant_message: SECRET, background_tasks: [SECRET] }));
});

test("unknown or incomplete input returns null", () => {
  assert.equal(sanitize(null), null);
  assert.equal(sanitize({}), null);
  assert.equal(sanitize({ ...base, hook_event_name: "PreCompact" }), null);
  assert.equal(sanitize({ hook_event_name: "Stop", cwd: "/x" }), null);
});

test("transcript paths are forwarded as paths: the session's, or the sub-agent's on SubagentStop", () => {
  assert.equal(sanitize({ ...base, hook_event_name: "UserPromptSubmit", prompt: SECRET }).transcript, TRANSCRIPT);
  const stop = sanitize({ ...base, hook_event_name: "SubagentStop", agent_id: "a1", agent_transcript_path: "/x/s1/subagents/agent-a1.jsonl" });
  assert.equal(stop.transcript, "/x/s1/subagents/agent-a1.jsonl");
  assert.equal(sanitize({ ...base, transcript_path: "/etc/passwd", hook_event_name: "Stop" }).transcript, undefined, "only .jsonl paths");
  assert.equal(sanitize({ ...base, transcript_path: 42, hook_event_name: "Stop" }).transcript, undefined);
});
