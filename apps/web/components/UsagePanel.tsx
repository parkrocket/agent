"use client";

import { useEffect, useState } from "react";
import {
  ZERO_TOKENS,
  addTokens,
  formatTokens,
  roomLabels,
  type AgentUsage,
  type ModelConfig,
  type PlanLimits,
  type RoomMap,
  type SessionMap,
  type TokenCounts,
  type UsageSnapshot,
} from "@ai-office/shared";
import { formatDateTime, formatDuration } from "@/lib/format";
import { limitRows, reportedText } from "@/lib/limits";
import { SERVER_URL } from "@/lib/useOfficeSocket";
import { todayTotals, totalTokens } from "@/lib/usage";
import { useNow } from "./LimitsBadge";
import styles from "./UsagePanel.module.css";

const COST_KEY = "ai-office.showCost";

const usd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
const sumAgents = (agents: Record<string, AgentUsage>) =>
  Object.values(agents).reduce(
    (acc, a) => ({ tokens: addTokens(acc.tokens, a.tokens), cost: acc.cost + a.cost }),
    { tokens: ZERO_TOKENS, cost: 0 },
  );

function Breakdown({ t }: { t: TokenCounts }) {
  return (
    <dl className={styles.breakdown}>
      <div><dt>입력</dt><dd>{formatTokens(t.input)}</dd></div>
      <div><dt>출력</dt><dd>{formatTokens(t.output)}</dd></div>
      <div><dt>캐시 읽기</dt><dd>{formatTokens(t.cacheRead)}</dd></div>
      <div><dt>캐시 쓰기</dt><dd>{formatTokens(t.cacheWrite5m + t.cacheWrite1h)}</dd></div>
    </dl>
  );
}

/** Token usage read from Claude Code transcripts: today, per room, per session, plus the model table. */
export function UsagePanel({
  usage,
  limits,
  sessions,
  rooms,
  models,
  onClose,
}: {
  usage: UsageSnapshot;
  limits: PlanLimits | null;
  sessions: SessionMap;
  rooms: RoomMap;
  models?: ModelConfig;
  onClose: () => void;
}) {
  const [showCost, setShowCost] = useState(false);
  const [importState, setImportState] = useState<string>();
  const now = useNow();

  useEffect(() => {
    try {
      setShowCost(localStorage.getItem(COST_KEY) === "on");
    } catch {}
  }, []);
  const toggleCost = () => {
    setShowCost((v) => {
      try {
        localStorage.setItem(COST_KEY, v ? "off" : "on");
      } catch {}
      return !v;
    });
  };

  const runImport = async () => {
    setImportState("가져오는 중…");
    try {
      const res = await fetch(`${SERVER_URL}/usage/import`, { method: "POST" });
      const body = (await res.json()) as { files: number; added: number };
      setImportState(`파일 ${body.files}개 확인 · 새 메시지 ${body.added.toLocaleString()}개 추가`);
    } catch {
      setImportState("가져오기 실패: 서버에 연결할 수 없습니다");
    }
  };

  const today = todayTotals(usage);
  const labels = roomLabels(Object.values(rooms));
  // Group by room: the live office knows each session's room; past sessions use the transcript's cwd.
  const byRoom = new Map<string, { label: string; tokens: TokenCounts; cost: number; sessions: number }>();
  const list = Object.values(usage.sessions).sort((a, b) => b.lastTs - a.lastTs);
  for (const s of list) {
    const key = sessions[s.sessionId]?.room ?? s.cwd ?? "?";
    const label = labels[key] ?? (key === "?" ? "알 수 없음" : key.split("/").filter(Boolean).at(-1) ?? key);
    const sum = sumAgents(s.agents);
    const r = byRoom.get(key) ?? { label, tokens: ZERO_TOKENS, cost: 0, sessions: 0 };
    byRoom.set(key, { label, tokens: addTokens(r.tokens, sum.tokens), cost: r.cost + sum.cost, sessions: r.sessions + 1 });
  }
  const roomRows = [...byRoom.values()].sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens));
  const modelRows = Object.entries(models?.models ?? {});

  return (
    <aside className={styles.panel} aria-label="사용량">
      <header className={styles.head}>
        <h2>📊 사용량</h2>
        <label className={styles.toggle}>
          <input type="checkbox" checked={showCost} onChange={toggleCost} />
          비용 환산
        </label>
        <button onClick={onClose} aria-label="닫기">✕</button>
      </header>
      <p className={styles.note}>
        Claude Code 대화 기록(JSONL)의 토큰 수만 읽습니다. 내용은 읽지 않습니다.
        {showCost && (
          <>
            {" "}비용은 <b>API 정가 기준 추정</b>이며 구독 요금제와 무관합니다 · 단가 기준일 {models?.pricesAsOf ?? "?"}
          </>
        )}
      </p>

      <section>
        <h3>요금제 한도</h3>
        {limits ? (
          <>
            <table className={styles.table}>
              <tbody>
                {limitRows(limits, now).map((r) => (
                  <tr key={r.key} className={styles[r.level]}>
                    <td>{r.label}</td>
                    <td className={styles.meter}>
                      <span style={{ width: `${Math.min(100, r.pct)}%` }} />
                    </td>
                    <td className={styles.num}>{r.reset ? "—" : `${Math.round(r.pct)}%`}</td>
                    <td className={styles.num}>{r.resetText}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.note}>{reportedText(limits, now)} · Claude Code 상태 줄이 보고한 계정 전체 값입니다.</p>
          </>
        ) : (
          <p className={styles.note}>
            아직 보고가 없습니다. <code>pnpm statusline:install</code>로 상태 줄을 설치하면, Pro/Max 요금제의 5시간·주간 한도가 여기에 나옵니다.
          </p>
        )}
      </section>

      <section>
        <h3>오늘</h3>
        <div className={styles.big}>
          {formatTokens(totalTokens(today.tokens))} 토큰
          {showCost && <span className={styles.cost}>≈ {usd(today.cost)}</span>}
        </div>
        <Breakdown t={today.tokens} />
      </section>

      <section>
        <h3>방별 누적</h3>
        {roomRows.length === 0 && <p className={styles.note}>아직 기록이 없습니다.</p>}
        <table className={styles.table}>
          <tbody>
            {roomRows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className={styles.num}>세션 {r.sessions}</td>
                <td className={styles.num}>{formatTokens(totalTokens(r.tokens))}</td>
                {showCost && <td className={styles.num}>{usd(r.cost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>세션별</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>프로젝트</th>
              <th>시작</th>
              <th>길이</th>
              <th className={styles.num}>토큰</th>
              {showCost && <th className={styles.num}>비용</th>}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 40).map((s) => {
              const sum = sumAgents(s.agents);
              const live = sessions[s.sessionId];
              const key = live?.room ?? s.cwd;
              const label = key ? (labels[key] ?? key.split("/").filter(Boolean).at(-1)) : "알 수 없음";
              return (
                <tr key={s.sessionId} className={live && !live.offDuty ? styles.live : ""} title={`${s.sessionId} · ${key ?? ""}`}>
                  <td>
                    {label} <span className={styles.dim}>{s.sessionId.slice(0, 6)}</span>
                    {!live && <span className={styles.dim}> · 기록만</span>}
                  </td>
                  <td>{formatDateTime(s.firstTs)}</td>
                  <td>{formatDuration(s.lastTs - s.firstTs)}</td>
                  <td className={styles.num}>{formatTokens(totalTokens(sum.tokens))}</td>
                  {showCost && <td className={styles.num}>{usd(sum.cost)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h3>과거 기록</h3>
        <p className={styles.note}>hook 설치 전 세션을 포함해 모든 대화 기록의 토큰 수를 통계에 넣습니다. 다시 눌러도 중복되지 않습니다.</p>
        <button className={styles.action} onClick={runImport}>과거 기록 가져오기</button>
        {importState && <p className={styles.note}>{importState}</p>}
      </section>

      <section>
        <h3>모델 한도·단가</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>모델</th>
              <th className={styles.num}>컨텍스트</th>
              {showCost && <th className={styles.num}>입력/출력 $/M</th>}
            </tr>
          </thead>
          <tbody>
            {modelRows.map(([id, m]) => (
              <tr key={id}>
                <td>{id}</td>
                <td className={styles.num}>
                  {formatTokens(m.contextLimit)}
                  {!m.contextVerified && <span className={styles.unverified} title="공식 문서로 확인하지 못한 값"> 미확인</span>}
                </td>
                {showCost && <td className={styles.num}>{m.price ? `${m.price.input} / ${m.price.output}` : "-"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.note}>
          한도 확인일 {models?.limitsCheckedAt ?? "?"} · 단가 기준일 {models?.pricesAsOf ?? "?"}. 바꾸려면{" "}
          <code>~/.config/ai-office/models.json</code>에 덮어쓸 값을 적고 서버를 다시 시작하세요.
        </p>
      </section>
    </aside>
  );
}
