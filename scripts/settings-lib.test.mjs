import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addOurHooks,
  removeOurHooks,
  hookCommand,
  hookState,
  installHookFiles,
  removeHookFiles,
  repoHookDir,
  HOOK_EVENTS,
  HOOK_FILES,
  HOOK_MARKER,
  STATUSLINE_MARKER,
  STATUSLINE_REFRESH_SEC,
  addOurStatusLine,
  backupPath,
  removeOurStatusLine,
  statuslineState,
} from "./settings-lib.mjs";

const CMD = '"/usr/bin/node" "/repo/hooks/ai-office-hook.mjs"';
const userHook = { matcher: "Bash", hooks: [{ type: "command", command: "./my-guard.sh" }] };

test("adds an async hook for every event and keeps other settings", () => {
  const out = addOurHooks({ theme: "dark", hooks: { PreToolUse: [userHook] } }, CMD);
  assert.equal(out.theme, "dark");
  for (const e of HOOK_EVENTS) {
    const ours = out.hooks[e].at(-1).hooks[0];
    assert.deepEqual(ours, { type: "command", command: CMD, timeout: 5, async: true });
  }
  assert.deepEqual(out.hooks.PreToolUse[0], userHook);
});

test("install is idempotent", () => {
  const once = addOurHooks({}, CMD);
  assert.deepEqual(addOurHooks(once, CMD), once);
});

test("uninstall restores the original settings", () => {
  const original = { theme: "dark", hooks: { PreToolUse: [userHook] } };
  assert.deepEqual(removeOurHooks(addOurHooks(original, CMD)), original);
  assert.deepEqual(removeOurHooks(addOurHooks({ theme: "dark" }, CMD)), { theme: "dark" });
});

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "ai-office-hook-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("installHookFiles copies the hook with a version record; removeHookFiles deletes only our files", (t) => {
  const dest = join(tempDir(t), "hook");
  const v = installHookFiles(dest);
  for (const f of HOOK_FILES) assert.equal(readFileSync(join(dest, f), "utf8"), readFileSync(join(repoHookDir, f), "utf8"));
  assert.equal(v.eventVersion, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "version.json"), "utf8")).files, v.files);

  const settings = addOurHooks({}, hookCommand("/usr/bin/node", dest));
  let state = hookState(settings, dest);
  assert.equal(state.usesCopy, true);
  assert.equal(state.matchesRepo, true);
  assert.equal(state.events, HOOK_EVENTS.length);

  // the working tree moving on (another branch) shows up as a mismatch, not as a changed hook
  const fakeRepo = tempDir(t);
  cpSync(repoHookDir, fakeRepo, { recursive: true });
  writeFileSync(join(fakeRepo, "sanitize.mjs"), "// changed\n", { flag: "a" });
  state = hookState(settings, dest, fakeRepo);
  assert.equal(state.matchesRepo, false);
  assert.equal(state.copyPresent, true);

  // an old-style install that runs the working tree directly is reported as such
  assert.equal(hookState(addOurHooks({}, `"/usr/bin/node" "/repo/hooks/${HOOK_MARKER}"`), dest).usesCopy, false);

  writeFileSync(join(dest, "notes.txt"), "user file");
  assert.equal(removeHookFiles(dest), true);
  assert.deepEqual(readdir(dest), ["notes.txt"], "only our files go");
  rmSync(join(dest, "notes.txt"));
  installHookFiles(dest);
  removeHookFiles(dest);
  assert.equal(existsSync(dest), false, "an emptied folder goes too");
});

const readdir = (d) => readdirSync(d).sort();

test("hooks:install registers the copy, which keeps working when the working tree changes; uninstall removes both", (t) => {
  const root = tempDir(t);
  const env = { ...process.env, XDG_DATA_HOME: join(root, "data") };
  const settingsPath = join(root, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));
  const cli = (script, ...args) =>
    execFileSync(process.execPath, [join(repoHookDir, "..", "scripts", script), "--settings", settingsPath, ...args], { env, encoding: "utf8" });

  cli("install-hooks.mjs", "--dry-run");
  assert.equal(existsSync(join(root, "data", "ai-office", "hook")), false, "dry run copies nothing");

  cli("install-hooks.mjs");
  const copy = join(root, "data", "ai-office", "hook", HOOK_MARKER);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.theme, "dark");
  const command = settings.hooks.Stop[0].hooks[0].command;
  assert.ok(command.includes(copy), command);
  assert.ok(!command.includes(repoHookDir), "never the working tree");

  // the copy runs on its own: no output, exit 0, even with the server down
  const res = spawnSync(process.execPath, [copy], {
    input: JSON.stringify({ hook_event_name: "Stop", session_id: "s", cwd: "/x" }),
    env: { ...env, AI_OFFICE_URL: "http://127.0.0.1:9/events" },
    encoding: "utf8",
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "");

  // reinstalling replaces, doesn't duplicate
  cli("install-hooks.mjs");
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).hooks.Stop.length, 1);

  cli("uninstall-hooks.mjs");
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), { theme: "dark" });
  assert.equal(existsSync(copy), false);
});

const LINE = '"/usr/bin/node" "/data/ai-office/statusline/ai-office-statusline.mjs"';

test("status line: set, replaced on reinstall, removed only when ours", () => {
  const out = addOurStatusLine({ theme: "dark" }, LINE);
  assert.deepEqual(out, { theme: "dark", statusLine: { type: "command", command: LINE, refreshInterval: STATUSLINE_REFRESH_SEC } });
  assert.deepEqual(addOurStatusLine(out, LINE), out, "idempotent");
  assert.deepEqual(removeOurStatusLine(out), { theme: "dark" });

  const theirs = { statusLine: { type: "command", command: "~/.claude/my-line.sh" } };
  assert.throws(() => addOurStatusLine(theirs, LINE), /--replace/, "never silently takes over someone else's status line");
  assert.equal(addOurStatusLine(theirs, LINE, { replace: true }).statusLine.command, LINE);
  assert.deepEqual(removeOurStatusLine(theirs), theirs, "uninstall leaves a foreign one alone");
});

test("statusline:install copies and registers; refuses a foreign one; uninstall restores", (t) => {
  const root = tempDir(t);
  const env = { ...process.env, XDG_DATA_HOME: join(root, "data") };
  const settingsPath = join(root, "settings.json");
  const original = { theme: "dark", statusLine: { type: "command", command: "my-line.sh" } };
  writeFileSync(settingsPath, JSON.stringify(original));
  const cli = (script, ...args) =>
    spawnSync(process.execPath, [join(repoHookDir, "..", "scripts", script), "--settings", settingsPath, ...args], { env, encoding: "utf8" });
  const dir = join(root, "data", "ai-office", "statusline");

  const refused = cli("install-statusline.mjs");
  assert.equal(refused.status, 1);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), original, "untouched");

  assert.equal(cli("install-statusline.mjs", "--replace").status, 0);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.ok(settings.statusLine.command.includes(join(dir, STATUSLINE_MARKER)));
  assert.equal(JSON.parse(readFileSync(join(dir, "version.json"), "utf8")).limitsVersion, 1);
  assert.deepEqual(statuslineState(settings, dir), { registered: "ours", copyPresent: true, matchesRepo: true });

  // the copy runs on its own with the server down
  const res = spawnSync(process.execPath, [join(dir, STATUSLINE_MARKER)], {
    input: JSON.stringify({ model: { display_name: "Opus 5.5" } }),
    env: { ...env, AI_OFFICE_LIMITS_URL: "http://127.0.0.1:9/limits" },
    encoding: "utf8",
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, "Opus 5.5");

  assert.equal(cli("uninstall-statusline.mjs").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), { theme: "dark" });
  assert.equal(existsSync(dir), false);
});

test("backups never overwrite each other (two installs in the same second)", (t) => {
  const root = tempDir(t);
  const settings = join(root, "settings.json");
  writeFileSync(settings, "{}");
  const first = backupPath(settings, "20261024-215743");
  assert.equal(first, `${settings}.bak-20261024-215743`);
  writeFileSync(first, "{}");
  const second = backupPath(settings, "20261024-215743");
  assert.equal(second, `${settings}.bak-20261024-215743-2`);
  writeFileSync(second, "{}");
  assert.equal(backupPath(settings, "20261024-215743"), `${settings}.bak-20261024-215743-3`);
});
