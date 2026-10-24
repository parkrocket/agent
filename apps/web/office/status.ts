// Renderer-free status helpers, safe to import from server-rendered components.
import type { AgentState, AgentStatus } from "@ai-office/shared";

/** A finished agent stretches, then looks idle after this long. */
export const DONE_TO_IDLE_MS = 30_000;
export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "휴식",
  thinking: "생각 중",
  reading: "읽는 중",
  writing: "작성 중",
  running: "실행 중",
  waiting: "손 듦",
  done: "완료",
};

/** Status as drawn: "done" fades into "idle" after a while. */
export function visualStatus(agent: Pick<AgentState, "status" | "since">, now: number): AgentStatus {
  return agent.status === "done" && now - agent.since > DONE_TO_IDLE_MS ? "idle" : agent.status;
}


export const STRETCH_MS = 2_500;
const DONE_BUBBLE_MS = 5_000;

/** Speech bubble text for an agent, or undefined for no bubble. `anim` paces the thinking dots (wall time). */
export function bubbleText(agent: AgentState, status: AgentStatus, now: number, anim = now): string | undefined {
  const target = [agent.tool, agent.file].filter(Boolean).join(" ");
  switch (status) {
    case "waiting":
      return agent.tool ? `승인 대기: ${target}` : "입력 기다리는 중";
    case "reading":
    case "writing":
    case "running":
      return target || agent.tool;
    case "thinking":
      return target || ".".repeat(1 + (Math.floor(anim / 400) % 3));
    case "done":
      return now - agent.since < DONE_BUBBLE_MS ? "완료!" : undefined;
    default:
      return undefined;
  }
}
