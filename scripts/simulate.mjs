#!/usr/bin/env node
// Plays a scripted fake Claude Code session against the local server, so the
// office can be demoed without a real session. Raw hook payloads go through
// the same sanitize() as the real hook.
// Usage: node scripts/simulate.mjs [--speed 1] [--session demo-xxxx] [--cwd /path/project] [--until <step>]
import { randomUUID } from "node:crypto";
import { sanitize } from "../hooks/sanitize.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const speed = Number(opt("speed", "1"));
const sessionId = opt("session", `demo-${randomUUID().slice(0, 8)}`);
const cwd = opt("cwd", "/home/demo/projects/pixel-shop");
const until = opt("until", "");
const url = process.env.AI_OFFICE_URL ?? "http://127.0.0.1:7420/events";

let n = 0;
const id = () => `toolu_sim_${++n}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed));

async function send(raw) {
  const event = sanitize({ session_id: sessionId, cwd, permission_mode: "default", ...raw });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

const sub = (agent_id, agent_type) => ({ agent_id, agent_type });

async function tool(name, input, { agent = {}, ms = 800, deny = false, ask = false } = {}) {
  const tool_use_id = id();
  await send({ hook_event_name: "PreToolUse", tool_name: name, tool_input: input, tool_use_id, ...agent });
  if (ask || deny) {
    await send({ hook_event_name: "PermissionRequest", tool_name: name, tool_input: input, ...agent });
    await send({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "needs permission" });
    await sleep(2500);
    if (deny) return; // denied: no PostToolUse ever arrives
  }
  await sleep(ms);
  await send({ hook_event_name: "PostToolUse", tool_name: name, tool_input: input, tool_use_id, duration_ms: ms, ...agent });
}

const p = (f) => `${cwd}/${f}`;

const steps = {
  async start() {
    await send({ hook_event_name: "SessionStart", source: "startup", model: "claude-opus-5-5" });
    await sleep(1200);
    await send({ hook_event_name: "UserPromptSubmit", prompt: "장바구니 버그 고쳐줘" });
    await sleep(1500);
  },
  async solo() {
    await tool("Read", { file_path: p("src/cart.ts") });
    await tool("Grep", { pattern: "total", path: p("src") });
    await tool("Edit", { file_path: p("src/cart.ts"), old_string: "a", new_string: "b" }, { ms: 1500 });
    await tool("Bash", { command: "pnpm test" }, { ms: 2000, ask: true });
  },
  async team() {
    const leadAgent = id();
    await send({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { prompt: "explore" }, tool_use_id: leadAgent });
    const a = sub("agent-explore-1", "Explore");
    const b = sub("agent-plan-2", "Plan");
    await send({ hook_event_name: "SubagentStart", ...a });
    await sleep(600);
    await send({ hook_event_name: "SubagentStart", ...b });
    await sleep(2500); // let them walk in
    await Promise.all([
      (async () => {
        await tool("Glob", { pattern: "**/*.ts" }, { agent: a, ms: 1200 });
        await tool("Read", { file_path: p("src/checkout/payment.ts") }, { agent: a, ms: 1800 });
        await tool("Bash", { command: "rm -rf dist" }, { agent: a, deny: true });
        await tool("Read", { file_path: p("README.md") }, { agent: a, ms: 1200 });
      })(),
      (async () => {
        await sleep(400);
        await tool("Read", { file_path: p("docs/설계.md") }, { agent: b, ms: 2200 });
        await tool("Write", { file_path: p("plan.md"), content: "x" }, { agent: b, ms: 2500 });
      })(),
    ]);
    await send({ hook_event_name: "SubagentStop", last_assistant_message: "done", ...b });
    await sleep(1500);
    await send({ hook_event_name: "SubagentStop", last_assistant_message: "done", ...a });
    await send({ hook_event_name: "PostToolUse", tool_name: "Agent", tool_input: {}, tool_use_id: leadAgent, duration_ms: 9000 });
  },
  async parallel() {
    // three parallel reads, finishing out of order
    const ids = [id(), id(), id()];
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    for (let i = 0; i < 3; i++)
      await send({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: p(files[i]) }, tool_use_id: ids[i] });
    for (const i of [0, 2, 1]) {
      await sleep(700);
      await send({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, tool_use_id: ids[i] });
    }
  },
  async finish() {
    await sleep(800);
    await send({ hook_event_name: "Stop", last_assistant_message: "고쳤습니다" });
  },
};

console.log(`session ${sessionId} → ${url}`);
for (const [name, run] of Object.entries(steps)) {
  console.log(`· ${name}`);
  await run();
  if (name === until) break;
}
console.log("done");
