#!/usr/bin/env node
// Merges AI Office hooks into ~/.claude/settings.json (backs up first).
// Usage: node scripts/install-hooks.mjs [--dry-run] [--settings <path>]
import { addOurHooks, run } from "./settings-lib.mjs";

run((s) => addOurHooks(s), "hooks 설치");
