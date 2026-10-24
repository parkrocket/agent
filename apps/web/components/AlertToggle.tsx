"use client";

import type { AlertState } from "@/lib/useWaitingAlerts";
import styles from "./AlertToggle.module.css";

const LABEL: Record<AlertState, string> = {
  on: "🔔 알림 켜짐",
  off: "🔕 알림 꺼짐",
  denied: "🔕 알림 차단됨",
  unsupported: "알림 미지원",
};

const HINT: Record<AlertState, string> = {
  on: "손 든 에이전트가 생기면 브라우저 알림을 보냅니다. 클릭하면 끕니다.",
  off: "클릭하면 브라우저 알림 권한을 요청하고 켭니다.",
  denied: "브라우저 설정에서 이 사이트의 알림을 허용해야 합니다.",
  unsupported: "이 브라우저는 알림을 지원하지 않습니다.",
};

export function AlertToggle({ state, onToggle }: { state: AlertState; onToggle: () => void }) {
  return (
    <button
      className={`${styles.toggle} ${styles[state]}`}
      onClick={onToggle}
      disabled={state === "unsupported" || state === "denied"}
      title={HINT[state]}
      aria-pressed={state === "on"}
    >
      {LABEL[state]}
    </button>
  );
}
