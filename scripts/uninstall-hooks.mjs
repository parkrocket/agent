#!/usr/bin/env node
// Removes only the AI Office hooks from ~/.claude/settings.json (backs up first).
// Usage: node scripts/uninstall-hooks.mjs [--dry-run] [--settings <path>]
import { removeOurHooks, run } from "./settings-lib.mjs";

run(removeOurHooks, "hooks 제거");
