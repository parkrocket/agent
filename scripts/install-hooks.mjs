#!/usr/bin/env node
// Copies the hook to ~/.local/share/ai-office/hook/ and registers that copy in
// ~/.claude/settings.json (backs up first). Re-run after changing hooks/.
// Usage: node scripts/install-hooks.mjs [--dry-run] [--settings <path>]
import { addOurHooks, hookCommand, installHookFiles, installedHookDir, run } from "./settings-lib.mjs";

const dir = installedHookDir();
run((s) => addOurHooks(s, hookCommand(process.execPath, dir)), "hooks 설치", {
  // copy first, so the registered command never points at a missing file
  beforeWrite: () => {
    const v = installHookFiles(dir);
    console.log(`hook 사본: ${dir} (이벤트 v${v.eventVersion}${v.commit ? `, ${v.commit}` : ""})`);
  },
});
