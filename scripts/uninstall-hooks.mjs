#!/usr/bin/env node
// Removes only the AI Office hooks from ~/.claude/settings.json (backs up
// first), then deletes the installed hook copy.
// Usage: node scripts/uninstall-hooks.mjs [--dry-run] [--settings <path>]
import { installedHookDir, removeHookFiles, removeOurHooks, run } from "./settings-lib.mjs";

const dir = installedHookDir();
run(removeOurHooks, "hooks 제거", {
  // delete only once settings.json no longer points at the copy
  afterWrite: () => {
    if (removeHookFiles(dir)) console.log(`hook 사본 삭제: ${dir}`);
  },
});
