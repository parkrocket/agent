import { z } from "zod";

/** Hook events forwarded to the office server. */
export const HOOK_EVENT_NAMES = [
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
] as const;

export const HookEventNameSchema = z.enum(HOOK_EVENT_NAMES);
export type HookEventName = z.infer<typeof HookEventNameSchema>;

const short = z.string().max(256);

export const AgentRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("main") }).strict(),
  z.object({ kind: z.literal("sub"), id: short, type: short.optional() }).strict(),
]);
export type AgentRef = z.infer<typeof AgentRefSchema>;

/**
 * A sanitized hook event. Never carries prompts, file contents, commands,
 * tool output or assistant messages — only tool names and file basenames.
 * Schemas are strict so unexpected fields are rejected by the server.
 */
export const OfficeEventSchema = z
  .object({
    v: z.literal(1),
    id: short,
    ts: z.number(),
    event: HookEventNameSchema,
    sessionId: short,
    cwd: z.string().max(4096),
    project: short,
    agent: AgentRefSchema,
    tool: short.optional(),
    file: short.optional(),
    toolUseId: short.optional(),
    /** Path of the session's (or, on SubagentStop, the sub-agent's) JSONL transcript; used to find usage. */
    transcript: z.string().max(4096).optional(),
    detail: z
      .object({
        source: short.optional(),
        model: short.optional(),
        reason: short.optional(),
        notificationType: short.optional(),
        durationMs: z.number().optional(),
        isInterrupt: z.boolean().optional(),
        permissionMode: short.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type OfficeEvent = z.infer<typeof OfficeEventSchema>;
