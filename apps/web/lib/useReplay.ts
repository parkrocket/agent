"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_OFFICE,
  Replayer,
  advance,
  buildTimeline,
  toReal,
  usageAt,
  type HistoryEvents,
  type HistorySession,
  type ModelConfig,
  type OfficeState,
  type Timeline,
  type UsageRecord,
  type UsageSnapshot,
} from "@ai-office/shared";
import { SERVER_URL } from "./useOfficeSocket";

const EMPTY_USAGE: UsageSnapshot = { sessions: {}, hours: {} };
/** How often the controls (clock, slider) re-render while playing; the scene reads the clock every frame. */
const UI_TICK_MS = 100;

interface Loaded {
  session: HistorySession;
  timeline: Timeline;
  usage: UsageRecord[];
  replayer: Replayer;
}

export type ReplaySpeed = 1 | 4 | 16;

/**
 * A past session played back in the browser with the shared reducer; the live
 * office state is never touched. Seeking recomputes from the start; playing
 * forward applies only the events passed since the last step.
 */
export function useReplay(offDutyMs: number, models: ModelConfig | undefined) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(4);
  const [playMs, setPlayMs] = useState(0);
  /** Bumped on start and on every seek: the scene starts over as a first paint (nobody walks in). */
  const [seeks, setSeeks] = useState(0);
  const playRef = useRef(0);
  const loadedRef = useRef<Loaded | undefined>(undefined);
  loadedRef.current = loaded;

  const start = useCallback(
    async (session: HistorySession) => {
      setLoading(session.sessionId);
      setError(undefined);
      try {
        const res = await fetch(`${SERVER_URL}/history/${encodeURIComponent(session.sessionId)}/events`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as HistoryEvents;
        const timeline = buildTimeline(body.events);
        playRef.current = 0;
        setPlayMs(0);
        setLoaded({ session, timeline, usage: body.usage, replayer: new Replayer(timeline.events, offDutyMs) });
        setSeeks((n) => n + 1);
        setPlaying(true);
      } catch (err) {
        setError(`다시보기를 불러오지 못했습니다 (${(err as Error).message})`);
      } finally {
        setLoading(undefined);
      }
    },
    [offDutyMs],
  );

  const exit = useCallback(() => {
    setLoaded(undefined);
    setPlaying(false);
    setError(undefined);
  }, []);

  const seek = useCallback((ms: number) => {
    const tl = loadedRef.current?.timeline;
    if (!tl) return;
    playRef.current = Math.min(tl.playDuration, Math.max(0, ms));
    setPlayMs(playRef.current);
    setSeeks((n) => n + 1);
  }, []);

  const toggle = useCallback(() => {
    const tl = loadedRef.current?.timeline;
    if (!tl) return;
    // play at the end starts over
    if (!playing && playRef.current >= tl.playDuration) seek(0);
    setPlaying(!playing);
  }, [playing, seek]);

  // The playhead moves every animation frame; React hears about it a few times a second.
  useEffect(() => {
    if (!playing || !loaded) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = last;
    const step = (now: number) => {
      const r = advance(playRef.current, Math.min(250, now - last), speed, loaded.timeline.playDuration);
      last = now;
      playRef.current = r.playMs;
      if (r.ended || now - lastUi >= UI_TICK_MS) {
        lastUi = now;
        setPlayMs(r.playMs);
      }
      if (r.ended) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, loaded, speed]);

  const realTs = loaded ? toReal(loaded.timeline, playMs) : 0;
  const office: OfficeState = loaded ? loaded.replayer.at(realTs) : EMPTY_OFFICE;
  const playedCount = loaded ? loaded.replayer.played().length : 0;
  const played = useMemo(() => loaded?.timeline.events.slice(0, playedCount) ?? [], [loaded, playedCount]);

  // Gauges as they stood then: recomputed only when another message comes into range.
  const usageCount = loaded ? countUpTo(loaded.usage, realTs) : 0;
  const usage = useMemo(
    () => (loaded && models ? usageAt(loaded.usage.slice(0, usageCount), models, Infinity) : EMPTY_USAGE),
    [loaded, models, usageCount],
  );

  const clock = useCallback(() => {
    const tl = loadedRef.current?.timeline;
    return tl ? toReal(tl, playRef.current) : Date.now();
  }, []);

  return {
    active: !!loaded,
    session: loaded?.session,
    timeline: loaded?.timeline,
    loading,
    error,
    playing,
    speed,
    setSpeed,
    playMs,
    realTs,
    office,
    usage,
    played,
    epoch: loaded ? `replay:${loaded.session.sessionId}:${seeks}` : "live",
    clock,
    start,
    exit,
    seek,
    toggle,
  };
}

/** Records are in time order: how many fall at or before `ts`. */
function countUpTo(records: UsageRecord[], ts: number): number {
  let lo = 0;
  let hi = records.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (records[mid]!.ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
