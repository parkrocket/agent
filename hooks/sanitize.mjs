import { basename } from "node:path";
import { randomUUID } from "node:crypto";

const FORWARDED_EVENTS = new Set([
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
]);

const MAX = 256;
const str = (v) => (typeof v === "string" && v.length > 0 ? v.slice(0, MAX) : undefined);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const bool = (v) => (typeof v === "boolean" ? v : undefined);

// Handles both POSIX and Windows-style separators.
const fileName = (p) => (typeof p === "string" && p ? str(basename(p.replace(/\\/g, "/"))) : undefined);

/** Picks a file basename out of tool_input; never returns any other tool input. */
function toolFile(input) {
  if (!input || typeof input !== "object") return undefined;
  return fileName(input.file_path ?? input.notebook_path ?? input.path);
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Builds an OfficeEvent from raw hook stdin by copying only whitelisted
 * fields. Prompts, file contents, commands, tool output, errors and
 * assistant messages are never copied. Returns null for unknown input.
 */
export function sanitize(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const event = raw.hook_event_name;
  if (!FORWARDED_EVENTS.has(event)) return null;
  const sessionId = str(raw.session_id);
  const cwd = typeof raw.cwd === "string" && raw.cwd ? raw.cwd.slice(0, 4096) : undefined;
  if (!sessionId || !cwd) return null;

  const agentId = str(raw.agent_id);
  const agent = agentId ? { kind: "sub", id: agentId, ...compact({ type: str(raw.agent_type) }) } : { kind: "main" };

  const isTool = "tool_name" in raw;
  const result = {
    v: 1,
    id: randomUUID(),
    ts: now,
    event,
    sessionId,
    cwd,
    project: fileName(cwd) ?? cwd,
    agent,
    ...compact({
      tool: isTool ? str(raw.tool_name) : undefined,
      file: isTool ? toolFile(raw.tool_input) : undefined,
      toolUseId: str(raw.tool_use_id),
    }),
  };

  const detail = compact({
    source: str(raw.source),
    model: typeof raw.model === "string" ? str(raw.model) : undefined,
    reason: str(raw.reason),
    notificationType: str(raw.notification_type),
    durationMs: num(raw.duration_ms),
    isInterrupt: bool(raw.is_interrupt),
    permissionMode: str(raw.permission_mode),
  });
  if (detail) result.detail = detail;
  return result;
}
