#!/usr/bin/env node
// Plays scripted fake Claude Code sessions against the local server, so the
// office can be demoed without real sessions. Raw hook payloads go through
// the same sanitize() as the real hook.
//
// Usage:
//   node scripts/simulate.mjs                              # one project, one session
//   node scripts/simulate.mjs --projects 3 --sessions 2    # 3 projects × 2 sessions, concurrently
//   options: --seed N  --speed 2  --prefix demo  --hold (no Stop at the end)
//            --session ID --cwd PATH  (single-session mode only)
//            --transcripts DIR  also write fake transcripts (token usage only) under DIR, which
//                               should be the server's projects folder (CLAUDE_CONFIG_DIR/projects)
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sanitize } from "../hooks/sanitize.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const projects = Number(opt("projects", "1"));
const perProject = Number(opt("sessions", "1"));
const speed = Number(opt("speed", "1"));
const prefix = opt("prefix", "demo");
const hold = args.includes("--hold");
const transcripts = opt("transcripts", "");
const url = process.env.AI_OFFICE_URL ?? "http://127.0.0.1:7420/events";

// Small deterministic PRNG (mulberry32) so a seed replays the same show.
let seed = Number(opt("seed", String(Date.now() % 100000)));
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / speed));

const PROJECTS = ["pixel-shop", "api-server", "docs-site", "mobile-app", "data-pipeline", "infra", "design-kit", "cli-tool"];
const FILES = ["src/index.ts", "src/cart.ts", "src/api/users.ts", "README.md", "package.json", "src/db/schema.sql", "docs/설계.md", "test/cart.test.ts"];
const AGENT_TYPES = ["Explore", "Plan", "general-purpose", "code-reviewer"];

let toolSeq = 0;

/**
 * Fake transcript writer: one assistant usage line per call, with a growing
 * context so gauges move. Some sessions run hot to show the warning colours.
 */
function transcriptWriter(sessionId, cwd) {
  if (!transcripts) return { path: undefined, subPath: () => undefined, bump: () => {} };
  const dir = join(transcripts, cwd.replace(/[^A-Za-z0-9]/g, "-"));
  const path = join(dir, `${sessionId}.jsonl`);
  mkdirSync(join(dir, sessionId, "subagents"), { recursive: true });
  const subPath = (agentId) => join(dir, sessionId, "subagents", `agent-${agentId}.jsonl`);
  const hot = rand() < 0.5;
  const context = new Map([["main", hot ? 760_000 : 40_000]]);
  let n = 0;
  const bump = (agentId) => {
    const key = agentId ?? "main";
    const prev = context.get(key) ?? 15_000;
    const next = Math.min(990_000, prev + Math.round(between(8_000, hot && !agentId ? 45_000 : 20_000)));
    context.set(key, next);
    const line = {
      type: "assistant",
      sessionId,
      ...(agentId ? { agentId, isSidechain: true } : {}),
      timestamp: new Date().toISOString(),
      cwd,
      message: {
        id: `msg_sim_${sessionId}_${++n}`,
        role: "assistant",
        model: "claude-opus-5-5",
        usage: { input_tokens: 200, output_tokens: Math.round(between(100, 2_000)), cache_read_input_tokens: next - 2_200, cache_creation_input_tokens: 2_000 },
      },
    };
    appendFileSync(agentId ? subPath(agentId) : path, JSON.stringify(line) + "\n");
  };
  return { path, subPath, bump };
}

function session(sessionId, cwd) {
  const tx = transcriptWriter(sessionId, cwd);
  const send = async (raw) => {
    // usage grows as the agent works: a transcript line per tool start (and per prompt)
    if (raw.hook_event_name === "PreToolUse" || raw.hook_event_name === "UserPromptSubmit") {
      tx.bump(raw.agent_id ? raw.agent_id.replace(/^agent-/, "") : undefined);
    }
    const transcript = raw.hook_event_name === "SubagentStop" && raw.agent_id ? tx.subPath(raw.agent_id.replace(/^agent-/, "")) : tx.path;
    const event = sanitize({ session_id: sessionId, cwd, permission_mode: "default", ...(transcript ? { transcript_path: transcript } : {}), ...raw });
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  };
  const p = (f) => `${cwd}/${f}`;

  async function tool(name, input, { agent = {}, ms = between(500, 1500), deny = false, ask = false } = {}) {
    const tool_use_id = `toolu_sim_${++toolSeq}`;
    await send({ hook_event_name: "PreToolUse", tool_name: name, tool_input: input, tool_use_id, ...agent });
    if (ask || deny) {
      await send({ hook_event_name: "PermissionRequest", tool_name: name, tool_input: input, ...agent });
      await send({ hook_event_name: "Notification", notification_type: "permission_prompt", message: "needs permission" });
      await sleep(between(2500, 4000));
      if (deny) return; // denied: no PostToolUse ever arrives
    }
    await sleep(ms);
    await send({ hook_event_name: "PostToolUse", tool_name: name, tool_input: input, tool_use_id, duration_ms: Math.round(ms), ...agent });
  }

  const randomTool = (agent) =>
    pick([
      () => tool("Read", { file_path: p(pick(FILES)) }, { agent }),
      () => tool("Grep", { pattern: "TODO", path: p("src") }, { agent }),
      () => tool("Edit", { file_path: p(pick(FILES)), old_string: "a", new_string: "b" }, { agent, ms: between(1000, 2000) }),
      () => tool("Bash", { command: "pnpm test" }, { agent, ms: between(1500, 3000) }),
    ])();

  const scenes = {
    async solo() {
      for (let i = 0; i < 3; i++) await randomTool({});
    },
    async ask() {
      await tool("Read", { file_path: p(pick(FILES)) });
      await tool("Bash", { command: "rm -rf dist" }, { ask: true, ms: 1500 });
    },
    async deny() {
      await tool("Bash", { command: "git push --force" }, { deny: true });
      await tool("Read", { file_path: p("README.md") });
    },
    async parallel() {
      const ids = [0, 1, 2].map(() => `toolu_sim_${++toolSeq}`);
      for (const id of ids) await send({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: p(pick(FILES)) }, tool_use_id: id });
      for (const id of [ids[0], ids[2], ids[1]]) {
        await sleep(600);
        await send({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, tool_use_id: id });
      }
    },
    async team() {
      const lead = `toolu_sim_${++toolSeq}`;
      await send({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { prompt: "x" }, tool_use_id: lead });
      const staff = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({
        agent_id: `agent-${sessionId}-${toolSeq}-${i}`,
        agent_type: pick(AGENT_TYPES),
      }));
      for (const a of staff) {
        await send({ hook_event_name: "SubagentStart", ...a });
        await sleep(500);
      }
      await sleep(2500); // let them walk in
      await Promise.all(
        staff.map(async (a, i) => {
          await sleep(i * 300);
          const steps = 2 + Math.floor(rand() * 2);
          for (let k = 0; k < steps; k++) await randomTool(a);
          if (rand() < 0.3) await tool("Bash", { command: "npm publish" }, { agent: a, ask: true });
          await send({ hook_event_name: "SubagentStop", last_assistant_message: "done", ...a });
        }),
      );
      await send({ hook_event_name: "PostToolUse", tool_name: "Agent", tool_input: {}, tool_use_id: lead, duration_ms: 9000 });
    },
  };

  return async function run() {
    await send({ hook_event_name: "SessionStart", source: "startup", model: "claude-opus-5-5" });
    await sleep(800);
    await send({ hook_event_name: "UserPromptSubmit", prompt: "작업해줘" });
    await sleep(1000);
    const plan = ["solo", pick(["team", "ask", "parallel"]), pick(["team", "deny", "solo"])];
    for (const name of plan) await scenes[name]();
    if (hold) return;
    await sleep(800);
    await send({ hook_event_name: "Stop", last_assistant_message: "끝났습니다" });
  };
}

const runs = [];
if (projects === 1 && perProject === 1) {
  const id = opt("session", `${prefix}-${Math.floor(rand() * 1e6).toString(36)}`);
  const cwd = opt("cwd", `/home/demo/projects/${PROJECTS[0]}`);
  runs.push({ id, cwd, delay: 0 });
} else {
  for (let pi = 0; pi < projects; pi++) {
    for (let si = 0; si < perProject; si++) {
      runs.push({
        id: `${prefix}-p${pi}s${si}-${Math.floor(rand() * 1e4).toString(36)}`,
        cwd: `/home/demo/projects/${PROJECTS[pi % PROJECTS.length]}${pi >= PROJECTS.length ? `-${pi}` : ""}`,
        delay: between(0, 4000),
      });
    }
  }
}

console.log(`seed ${seed} · ${runs.length} session(s) → ${url}`);
await Promise.all(
  runs.map(async (r) => {
    await sleep(r.delay);
    console.log(`· start ${r.id} (${r.cwd.split("/").at(-1)})`);
    await session(r.id, r.cwd)();
    console.log(`· done  ${r.id}`);
  }),
);
console.log("all done");
