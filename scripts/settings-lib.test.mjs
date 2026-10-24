import { test } from "node:test";
import assert from "node:assert/strict";
import { addOurHooks, removeOurHooks, HOOK_EVENTS } from "./settings-lib.mjs";

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
