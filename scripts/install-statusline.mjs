#!/usr/bin/env node
// Copies the status line to ~/.local/share/ai-office/statusline/ and registers
// it as Claude Code's statusLine in ~/.claude/settings.json (backs up first).
// It shows model · context · plan limits under the prompt and reports the
// limit numbers to the office. Re-run after changing hooks/limits.mjs.
// Usage: node scripts/install-statusline.mjs [--dry-run] [--replace] [--settings <path>]
import {
  STATUSLINE_FILES,
  addOurStatusLine,
  installHookFiles,
  installedStatuslineDir,
  repoHookDir,
  repoRoot,
  run,
  statuslineCommand,
} from "./settings-lib.mjs";
import { LIMITS_VERSION } from "../hooks/limits.mjs";

const dir = installedStatuslineDir();
const replace = process.argv.includes("--replace");
run((s) => addOurStatusLine(s, statuslineCommand(process.execPath, dir), { replace }), "상태 줄 설치", {
  // copy first, so the registered command never points at a missing file
  beforeWrite: () => {
    const v = installHookFiles(dir, repoHookDir, repoRoot, STATUSLINE_FILES, { limitsVersion: LIMITS_VERSION });
    console.log(`상태 줄 사본: ${dir}${v.commit ? ` (${v.commit})` : ""}`);
  },
});
