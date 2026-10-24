import type { OfficeEvent } from "@ai-office/shared";

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour12: false });
}

export function formatAgent(e: OfficeEvent): string {
  return e.agent.kind === "main" ? "👔 main" : `🧑‍💻 ${e.agent.type ?? "sub"}:${e.agent.id.slice(0, 6)}`;
}

export function formatSummary(e: OfficeEvent): string {
  const d = e.detail ?? {};
  switch (e.event) {
    case "SessionStart":
      return [d.source, d.model].filter(Boolean).join(" · ");
    case "SessionEnd":
      return d.reason ?? "";
    case "UserPromptSubmit":
      return "요청 받음";
    case "Notification":
      return d.notificationType ?? "";
    case "PostToolUse":
    case "PostToolUseFailure": {
      const parts = [e.tool, e.file, d.durationMs != null ? `${d.durationMs}ms` : undefined];
      if (d.isInterrupt) parts.push("interrupted");
      return parts.filter(Boolean).join("  ");
    }
    default:
      return [e.tool, e.file].filter(Boolean).join("  ");
  }
}

/** Events that mean the user is needed (hand-raise in later stages). */
export function needsAttention(e: OfficeEvent): boolean {
  return (
    e.event === "PermissionRequest" ||
    (e.event === "Notification" &&
      ["permission_prompt", "idle_prompt", "elicitation_dialog", "agent_needs_input"].includes(
        e.detail?.notificationType ?? "",
      ))
  );
}
