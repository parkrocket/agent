// Defensive reader for Claude Code's JSONL transcripts (~/.claude/projects).
// The format is not a public spec, so this pulls out a small whitelist of
// metadata from assistant messages and ignores everything else. Prompts,
// responses, tool inputs/outputs and any other free text are never copied:
// the result is built field by field from numbers and short identifiers.
import type { TokenCounts } from "./models";

export interface UsageRecord {
  /** API message id; one message can span several lines, so this is the dedupe key. */
  messageId: string;
  sessionId: string;
  /** Sub-agent id (without an "agent-" prefix) when the line comes from a sub-agent transcript. */
  agentId?: string;
  model: string;
  ts: number;
  tokens: TokenCounts;
  /** Working directory (an absolute path, like the hooks' cwd), used to label the session. */
  cwd?: string;
}

const ID = /^[A-Za-z0-9_\-:.]{1,128}$/;
const MODEL = /^[A-Za-z0-9_\-.:\[\]]{1,64}$/;
const MAX_TOKENS = 100_000_000;

const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : undefined);
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_TOKENS ? v : 0);

/** Hook ids and transcript ids may or may not carry an "agent-" prefix; compare without it. */
export function normalizeAgentId(v: string): string {
  return v.startsWith("agent-") ? v.slice(6) : v;
}

/** Parses one JSONL line into usage metadata, or null for anything else (or anything malformed). */
/** POSIX (`/home/u/x`), Windows drive (`C:\Users\x`, `C:/x`) or UNC (`\\server\x`) absolute paths. */
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

export function parseUsageLine(line: string): UsageRecord | null {
  if (!line.includes('"usage"')) return null; // cheap skip for the many non-usage lines
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const row = o as Record<string, unknown>;
  if (row.type !== "assistant") return null;
  const message = row.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object" || message.role !== "assistant") return null;
  const usage = message.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;

  const messageId = id(message.id);
  const sessionId = id(row.sessionId);
  const model = typeof message.model === "string" && MODEL.test(message.model) ? message.model : undefined;
  const ts = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
  if (!messageId || !sessionId || !model || !Number.isFinite(ts)) return null;

  // Split cache writes by TTL when the breakdown exists; otherwise count them all as 5-minute writes.
  const creation = usage.cache_creation as Record<string, unknown> | undefined;
  const w5 = creation && typeof creation === "object" ? count(creation.ephemeral_5m_input_tokens) : undefined;
  const w1 = creation && typeof creation === "object" ? count(creation.ephemeral_1h_input_tokens) : undefined;
  const totalWrite = count(usage.cache_creation_input_tokens);
  const split = w5 !== undefined && w1 !== undefined && w5 + w1 === totalWrite;

  const agentId = id(row.agentId);
  const cwd = typeof row.cwd === "string" && ABSOLUTE_PATH.test(row.cwd) && row.cwd.length <= 4096 ? row.cwd : undefined;
  return {
    messageId,
    sessionId,
    ...(agentId ? { agentId: normalizeAgentId(agentId) } : {}),
    model,
    ts,
    tokens: {
      input: count(usage.input_tokens),
      output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      cacheWrite5m: split ? w5 : totalWrite,
      cacheWrite1h: split ? w1 : 0,
    },
    ...(cwd ? { cwd } : {}),
  };
}
