#!/usr/bin/env node
// Removes the AI Office status line from ~/.claude/settings.json (only if it
// is ours; backs up first), then deletes the installed copy.
// Usage: node scripts/uninstall-statusline.mjs [--dry-run] [--settings <path>]
import { STATUSLINE_FILES, installedStatuslineDir, removeHookFiles, removeOurStatusLine, run } from "./settings-lib.mjs";

const dir = installedStatuslineDir();
run(removeOurStatusLine, "상태 줄 제거", {
  // delete only once settings.json no longer points at the copy
  afterWrite: () => {
    if (removeHookFiles(dir, STATUSLINE_FILES)) console.log(`상태 줄 사본 삭제: ${dir}`);
  },
});
