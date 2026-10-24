"use client";

import { useEffect, useRef, useState } from "react";
import { formatTokens, normalizeHistoryList, type HistorySession } from "@ai-office/shared";
import { formatDateTime, formatDuration } from "@/lib/format";
import { totalTokens } from "@/lib/usage";
import { SERVER_URL } from "@/lib/useOfficeSocket";
import styles from "./Replay.module.css";

/** 🎞 button with the list of past sessions to replay. */
export function ReplayPicker({
  active,
  loading,
  error,
  onPick,
}: {
  active: boolean;
  loading?: string;
  error?: string;
  onPick: (s: HistorySession) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<HistorySession[]>();
  const [fetchError, setFetchError] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFetchError(undefined);
    fetch(`${SERVER_URL}/history`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => setList(normalizeHistoryList(body).sessions))
      .catch((err: Error) => setFetchError(`목록을 불러오지 못했습니다 (${err.message})`));
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className={styles.picker} ref={rootRef}>
      <button
        className={styles.pickerButton}
        onClick={() => setOpen((v) => !v)}
        aria-pressed={active}
        aria-expanded={open}
        data-testid="replay-button"
      >
        🎞 다시보기
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label="다시볼 세션">
          <p className={styles.note}>저장된 hook 이벤트(보관 기간 안)로 지난 세션을 재생합니다. 재생 중에도 실제 세션 알림은 그대로 울립니다.</p>
          {(fetchError ?? error) && <p className={styles.error}>{fetchError ?? error}</p>}
          {!list && !fetchError && <p className={styles.note}>불러오는 중…</p>}
          {list && list.length === 0 && <p className={styles.note}>아직 지난 세션이 없습니다.</p>}
          {list && list.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>시작</th>
                  <th>길이</th>
                  <th className={styles.num}>이벤트</th>
                  <th className={styles.num}>토큰</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr
                    key={s.sessionId}
                    className={s.replayable ? styles.row : styles.disabledRow}
                    title={s.replayable ? `${s.sessionId} · ${s.cwd ?? ""}` : "hook 이벤트가 없어 재생할 수 없습니다 (대화 기록의 토큰 수만 있음)"}
                    onClick={() => {
                      if (!s.replayable || loading) return;
                      onPick(s);
                      setOpen(false);
                    }}
                    aria-disabled={!s.replayable}
                    data-testid={`replay-session-${s.sessionId}`}
                  >
                    <td>
                      {s.project ?? "알 수 없음"} <span className={styles.dim}>{s.sessionId.slice(0, 6)}</span>
                      {s.live && <span className={styles.live}> · 근무 중</span>}
                      {!s.replayable && <span className={styles.dim}> · 기록만 · 재생 불가</span>}
                      {loading === s.sessionId && <span className={styles.dim}> · 불러오는 중…</span>}
                    </td>
                    <td>{formatDateTime(s.startedAt)}</td>
                    <td>{formatDuration(s.endedAt - s.startedAt)}</td>
                    <td className={styles.num}>{s.events || "-"}</td>
                    <td className={styles.num}>{formatTokens(totalTokens(s.tokens))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
