import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOOK_MARKER = "ai-office-hook.mjs";

export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function hookCommand(nodePath = process.execPath, root = repoRoot) {
  return `"${nodePath}" "${join(root, "hooks", HOOK_MARKER)}"`;
}

export function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const i = argv.indexOf("--settings");
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  const settingsPath = i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : join(configDir, "settings.json");
  return { dryRun, settingsPath };
}

export function readSettings(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (!text.trim()) return {};
  const data = JSON.parse(text); // throws on invalid JSON: never overwrite a file we can't read
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${path} is not a JSON object`);
  return data;
}

const isOurs = (h) => typeof h?.command === "string" && h.command.includes(HOOK_MARKER);

/** Removes our hook entries, keeping every other user hook. Pure. */
export function removeOurHooks(settings) {
  const next = structuredClone(settings);
  if (!next.hooks || typeof next.hooks !== "object") return next;
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((g) => (Array.isArray(g?.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (kept.length) next.hooks[event] = kept;
    else delete next.hooks[event];
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return next;
}

/** Adds (or replaces) our async command hook for each event. Pure and idempotent. */
export function addOurHooks(settings, command = hookCommand()) {
  const next = removeOurHooks(settings);
  next.hooks ??= {};
  for (const event of HOOK_EVENTS) {
    next.hooks[event] ??= [];
    next.hooks[event].push({
      matcher: "*",
      hooks: [{ type: "command", command, timeout: 5, async: true }],
    });
  }
  return next;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Shared CLI flow for install/uninstall. */
export function run(transform, label) {
  const { dryRun, settingsPath } = parseArgs(process.argv.slice(2));
  let current;
  try {
    current = readSettings(settingsPath);
  } catch (err) {
    console.error(`✗ ${settingsPath} 를 읽을 수 없어 중단합니다: ${err.message}`);
    process.exit(1);
  }
  const next = transform(current);
  const before = JSON.stringify(current, null, 2);
  const after = JSON.stringify(next, null, 2);

  console.log(`대상: ${settingsPath}`);
  if (before === after) {
    console.log("변경 사항 없음.");
    return;
  }
  if (dryRun) {
    console.log(`--- [dry-run] ${label} 후 settings.json ---`);
    console.log(after);
    console.log("--- 실제로 쓰지 않았습니다. --dry-run 없이 실행하면 적용됩니다. ---");
    return;
  }
  mkdirSync(dirname(settingsPath), { recursive: true });
  if (existsSync(settingsPath)) {
    const backup = `${settingsPath}.bak-${timestamp()}`;
    copyFileSync(settingsPath, backup);
    console.log(`백업: ${backup}`);
  }
  writeFileSync(settingsPath, after + "\n");
  console.log(`✓ ${label} 완료.`);
}
