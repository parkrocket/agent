import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, rmSync, readdirSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_VERSION } from "../hooks/sanitize.mjs";

export const HOOK_MARKER = "ai-office-hook.mjs";
/** The hook and everything it imports (plain node, no dependencies). Dependencies first, so a copy never runs half-updated. */
export const HOOK_FILES = ["sanitize.mjs", HOOK_MARKER];

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

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoHookDir = join(repoRoot, "hooks");

/** App data folder (also the DB's default home): $XDG_DATA_HOME/ai-office or ~/.local/share/ai-office. */
export function dataDir(env = process.env) {
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "ai-office");
}

/**
 * Where the installed hook lives. Claude Code runs this copy, not the working
 * tree, so switching branches or editing hooks/ never changes what every
 * running session executes; `pnpm hooks:install` updates it deliberately.
 */
export function installedHookDir(env = process.env) {
  return join(dataDir(env), "hook");
}

export function hookCommand(nodePath = process.execPath, dir = installedHookDir()) {
  return `"${nodePath}" "${join(dir, HOOK_MARKER)}"`;
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Content hashes of the hook files in a folder (missing files are absent). */
export function hookHashes(dir) {
  const out = {};
  for (const f of HOOK_FILES) if (existsSync(join(dir, f))) out[f] = sha256(join(dir, f));
  return out;
}

function gitCommit(root) {
  try {
    const commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--", "hooks"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return dirty ? `${commit}+dirty` : commit;
  } catch {
    return undefined;
  }
}

/**
 * Copies the hook into `dest`. Each file is written beside its target and
 * renamed over it, so a session firing mid-install runs either the old or the
 * new file, never a partial one. Records what was installed in version.json.
 */
export function installHookFiles(dest = installedHookDir(), src = repoHookDir, root = repoRoot) {
  mkdirSync(dest, { recursive: true });
  for (const f of HOOK_FILES) {
    const tmp = join(dest, `.${f}.${process.pid}.tmp`);
    copyFileSync(join(src, f), tmp);
    renameSync(tmp, join(dest, f));
  }
  const version = {
    eventVersion: EVENT_VERSION,
    commit: gitCommit(root),
    installedAt: new Date().toISOString(),
    from: src,
    files: hookHashes(dest),
  };
  writeFileSync(join(dest, "version.json"), JSON.stringify(version, null, 2) + "\n");
  return version;
}

/** Deletes the installed copy (only our files; the folder goes too if that leaves it empty). */
export function removeHookFiles(dest = installedHookDir()) {
  if (!existsSync(dest)) return false;
  for (const f of [...HOOK_FILES, "version.json"]) rmSync(join(dest, f), { force: true });
  if (readdirSync(dest).length === 0) rmdirSync(dest);
  return true;
}

/** Is the hook installed, and does the installed copy match the working tree? */
export function hookState(settings, dest = installedHookDir(), src = repoHookDir) {
  const commands = [];
  for (const groups of Object.values(settings?.hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) for (const h of g?.hooks ?? []) if (isOurs(h)) commands.push(h.command);
  }
  const registered = [...new Set(commands)];
  let version;
  try {
    version = JSON.parse(readFileSync(join(dest, "version.json"), "utf8"));
  } catch {}
  const installed = hookHashes(dest);
  const repo = hookHashes(src);
  return {
    registered,
    /** Registered events (out of HOOK_EVENTS). */
    events: commands.length,
    /** Every registered command runs the installed copy (not the working tree). */
    usesCopy: registered.length > 0 && registered.every((c) => c.includes(join(dest, HOOK_MARKER))),
    copyPresent: Object.keys(installed).length === HOOK_FILES.length,
    matchesRepo: HOOK_FILES.every((f) => installed[f] && installed[f] === repo[f]),
    version,
  };
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

/**
 * Shared CLI flow for install/uninstall. `before`/`after` do the file work
 * around writing settings.json: install copies the hook before registering it,
 * uninstall deletes it only once nothing points at it. They run even when
 * settings.json is already right, and never on --dry-run.
 */
export function run(transform, label, { beforeWrite, afterWrite } = {}) {
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
  if (dryRun) {
    if (before === after) console.log("settings.json 변경 사항 없음.");
    else {
      console.log(`--- [dry-run] ${label} 후 settings.json ---`);
      console.log(after);
    }
    console.log("--- 실제로 쓰지 않았습니다. --dry-run 없이 실행하면 적용됩니다. ---");
    return;
  }
  beforeWrite?.();
  if (before !== after) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    if (existsSync(settingsPath)) {
      const backup = `${settingsPath}.bak-${timestamp()}`;
      copyFileSync(settingsPath, backup);
      console.log(`백업: ${backup}`);
    }
    writeFileSync(settingsPath, after + "\n");
  } else {
    console.log("settings.json은 바꿀 것 없음.");
  }
  afterWrite?.();
  console.log(`✓ ${label} 완료.`);
}
