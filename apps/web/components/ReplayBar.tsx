"use client";

import { REPLAY_SPEEDS, type ReplaySegment, type Timeline } from "@ai-office/shared";
import { formatDateTime, formatDuration, formatTime } from "@/lib/format";
import type { ReplaySpeed } from "@/lib/useReplay";
import styles from "./Replay.module.css";

/** Only the longest few squeezed stretches get a text label (more would pile up); every band shows its length on hover. */
const MAX_GAP_LABELS = 4;
/** Labels closer than this fraction of the track would overlap. */
const MIN_LABEL_GAP = 0.15;

/** Playback controls over the office: play/pause, speed, timeline with squeezed gaps, and the real clock. */
export function ReplayBar({
  timeline,
  playing,
  speed,
  playMs,
  realTs,
  onToggle,
  onSpeed,
  onSeek,
  onExit,
}: {
  timeline: Timeline;
  playing: boolean;
  speed: ReplaySpeed;
  playMs: number;
  realTs: number;
  onToggle: () => void;
  onSpeed: (s: ReplaySpeed) => void;
  onSeek: (playMs: number) => void;
  onExit: () => void;
}) {
  const total = Math.max(1, timeline.playDuration);
  const gaps = timeline.segments.filter((s) => s.skippedMs !== undefined);
  // longest first, skipping any too close to one already labelled
  const labelled = new Set<ReplaySegment>();
  for (const g of [...gaps].sort((a, b) => b.skippedMs! - a.skippedMs!)) {
    if (labelled.size >= MAX_GAP_LABELS) break;
    if ([...labelled].every((l) => Math.abs(l.playStart - g.playStart) / total > MIN_LABEL_GAP)) labelled.add(g);
  }
  const skipped = gaps.reduce((sum, g) => sum + g.skippedMs!, 0);
  const pct = (ms: number) => `${(ms / total) * 100}%`;

  return (
    <div className={styles.bar} data-testid="replay-bar">
      <button className={styles.play} onClick={onToggle} aria-label={playing ? "일시정지" : "재생"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className={styles.speeds} role="group" aria-label="재생 속도">
        {REPLAY_SPEEDS.map((s) => (
          <button key={s} aria-pressed={speed === s} onClick={() => onSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>
      <div className={styles.track}>
        <div className={styles.gapLayer} aria-hidden>
          {gaps.map((g) => (
            <div
              key={g.playStart}
              className={styles.gap}
              style={{ left: pct(g.playStart), width: pct(g.playEnd - g.playStart) }}
              title={`… ${formatDuration(g.skippedMs!)} 건너뜀`}
            >
              {labelled.has(g) && <span>… {formatDuration(g.skippedMs!)} 건너뜀</span>}
            </div>
          ))}
        </div>
        <input
          type="range"
          className={styles.range}
          min={0}
          max={total}
          step={50}
          value={Math.min(playMs, total)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="타임라인"
          data-testid="replay-range"
        />
        <div className={styles.ends}>
          <span>{formatDateTime(timeline.start)}</span>
          {gaps.length > 0 && (
            <span>
              빈 구간 {gaps.length}곳 · 총 {formatDuration(skipped)} 건너뜀
            </span>
          )}
          <span>{formatTime(timeline.end)}</span>
        </div>
      </div>
      <time className={styles.clock} dateTime={new Date(realTs).toISOString()} data-testid="replay-clock">
        {formatTime(realTs)}
      </time>
      <button className={styles.exit} onClick={onExit} aria-label="다시보기 끝내기">
        ✕ 실시간으로
      </button>
    </div>
  );
}
