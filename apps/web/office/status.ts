// Pixi-free status helpers, safe to import from server-rendered components.
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

