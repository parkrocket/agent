import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { LIMITS_VERSION, extractLimits, statusLine } from "./limits.mjs";

const NOW = 1_800_000_000_000;
const SEC = NOW / 1000;
const SECRET = "TOP-SECRET-7c1f";

/** Status line stdin shaped like the documented one, with a marker in every field that must stay home. */
function input(rateLimits) {
  return {
    hook_event_name: "Status",
    session_id: `sess-${SECRET}`,
    transcript_path: `/home/u/.claude/projects/${SECRET}.jsonl`,
    cwd: `/home/u/${SECRET}`,
    model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
    workspace: { current_dir: `/home/u/${SECRET}`, project_dir: `/home/u/${SECRET}` },
    version: "2.1.310",
    output_style: { name: SECRET },
    cost: { total_cost_usd: 1.23, total_lines_added: 42 },
    context_window: { used_percentage: 12.3, current_usage: { input_tokens: 5 } },
    ...(rateLimits && { rate_limits: rateLimits }),
  };
}

const LIMITS = {
  five_hour: { used_percentage: 23.5, resets_at: SEC + 72 * 60 },
  seven_day: { used_percentage: 82, resets_at: SEC + 3 * 86400 },
};

test("copies only the window numbers (no session, path, model or cost)", () => {
  const out = extractLimits(input(LIMITS), NOW);
  assert.deepEqual(out, {
    v: LIMITS_VERSION,
    ts: NOW,
    fiveHour: { usedPercentage: 23.5, resetsAt: (SEC + 72 * 60) * 1000 },
    sevenDay: { usedPercentage: 82, resetsAt: (SEC + 3 * 86400) * 1000 },
  });
  assert.ok(!JSON.stringify(out).includes(SECRET));
  assert.ok(!JSON.stringify(out).includes("opus"));
});

test("nothing to report without rate limits, and partial or broken windows are skipped", () => {
  assert.equal(extractLimits(input(), NOW), null, "API-key users get no rate_limits");
  assert.equal(extractLimits(input({}), NOW), null);
  assert.equal(extractLimits(null), null);
  assert.equal(extractLimits(input({ five_hour: { used_percentage: "x", resets_at: SEC } }), NOW), null);
  const onlyWeek = extractLimits(input({ five_hour: { used_percentage: 5 }, seven_day: LIMITS.seven_day }), NOW);
  assert.deepEqual(Object.keys(onlyWeek), ["v", "ts", "sevenDay"]);
  // spend_limit and anything else Claude Code adds later are not forwarded
  const extra = extractLimits(input({ ...LIMITS, spend_limit: { used_percentage: 1, resets_at: SEC, used_usd: 9 } }), NOW);
  assert.deepEqual(Object.keys(extra), ["v", "ts", "fiveHour", "sevenDay"]);
});

test("status line text: model, context, 5-hour countdown, weekly reset; colored from 80%", () => {
  const line = statusLine(input(LIMITS), NOW);
  const plain = line.replace(/\x1b\[\d+m/g, "");
  assert.match(plain, /^Opus 5\.5 · ctx 12% · 5h 24% \(1시간 12분 후\) · 주간 82% \(. \d\d:\d\d 초기화\)$/);
  assert.ok(line.includes("\x1b[33m주간 82%\x1b[0m"), "weekly at 82% is orange");
  assert.ok(!line.includes(SECRET));
  // a window whose reset already passed is dropped rather than shown stale
  assert.equal(statusLine(input({ five_hour: { used_percentage: 99, resets_at: SEC - 1 } }), NOW), "Opus 5.5 · ctx 12%");
  assert.equal(statusLine("nope"), "");
});

test("version matches the shared schema", () => {
  const src = readFileSync(new URL("../packages/shared/src/limits.ts", import.meta.url), "utf8");
  assert.equal(LIMITS_VERSION, Number(src.match(/export const LIMITS_VERSION = (\d+)/)[1]));
});

/** Runs the real script with `stdin`, posting to `url`. */
function runScript(stdin, url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL("./ai-office-statusline.mjs", import.meta.url).pathname], {
      env: { ...process.env, AI_OFFICE_LIMITS_URL: url },
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("exit", (code) => resolve({ code, stdout }));
    child.stdin.end(stdin);
  });
}

test("the script prints the line and posts only the limits", async (t) => {
  const bodies = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      bodies.push(body);
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/limits`;

  const data = input({
    five_hour: { used_percentage: 10, resets_at: Date.now() / 1000 + 3600 },
    seven_day: { used_percentage: 20, resets_at: Date.now() / 1000 + 86400 },
  });
  const res = await runScript(JSON.stringify(data), url);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /^Opus 5\.5 · ctx 12% · 5h 10% /);
  assert.equal(bodies.length, 1);
  assert.ok(!bodies[0].includes(SECRET));
  assert.deepEqual(Object.keys(JSON.parse(bodies[0])), ["v", "ts", "fiveHour", "sevenDay"]);

  // no limits → nothing posted; broken input or a dead server still exits 0
  assert.equal((await runScript(JSON.stringify(input()), url)).code, 0);
  assert.equal(bodies.length, 1);
  assert.deepEqual(await runScript("{not json", url), { code: 0, stdout: "" });
  const down = await runScript(JSON.stringify(data), "http://127.0.0.1:9/limits");
  assert.equal(down.code, 0);
  assert.match(down.stdout, /^Opus 5\.5/);
});
