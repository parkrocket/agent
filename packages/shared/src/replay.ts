// Session replay: rebuilds the office at any moment of a past session from its
// stored events, with the same reducer the server runs. Pure, so the browser
// can scrub without touching the live server state.
import type { OfficeEvent } from "./events";
import { EMPTY_OFFICE, reduceOffice, sweepOffDuty, type OfficeState } from "./office";

/** Quiet stretches longer than this are squeezed on playback… */
export const REPLAY_GAP_MS = 30_000;
/** …into this much playback time (at 1x). */
export const REPLAY_GAP_PLAY_MS = 2_000;
/** Playback keeps running a little past the last event so its result (a "done" stretch, a walk out) shows. */
export const REPLAY_TAIL_MS = 3_000;
export const REPLAY_SPEEDS = [1, 4, 16] as const;

/** A stretch of the session mapped onto the playback axis. */
export interface ReplaySegment {
  playStart: number;
  playEnd: number;
  realStart: number;
  realEnd: number;
  /** Set on a squeezed quiet stretch: how much real time it covers. */
  skippedMs?: number;
}

export interface Timeline {
  /** Events in time order (async hooks can arrive out of order, so they are sorted by `ts`). */
  events: OfficeEvent[];
  start: number;
  end: number;
  playDuration: number;
  segments: ReplaySegment[];
}

export function buildTimeline(
  input: readonly OfficeEvent[],
  { gapMs = REPLAY_GAP_MS, gapPlayMs = REPLAY_GAP_PLAY_MS, tailMs = REPLAY_TAIL_MS } = {},
): Timeline {
  const events = [...input].sort((a, b) => a.ts - b.ts);
  const start = events[0]?.ts ?? 0;
  const lastTs = events.at(-1)?.ts ?? start;
  const segments: ReplaySegment[] = [];
  let play = 0;
  const push = (realStart: number, realEnd: number, squeeze: boolean) => {
    const len = squeeze ? gapPlayMs : realEnd - realStart;
    const prev = segments.at(-1);
    // consecutive normal stretches merge into one segment
    if (!squeeze && prev && prev.skippedMs === undefined && prev.realEnd === realStart) {
      prev.realEnd = realEnd;
      prev.playEnd += len;
    } else {
      segments.push({ playStart: play, playEnd: play + len, realStart, realEnd, ...(squeeze ? { skippedMs: realEnd - realStart } : {}) });
    }
    play += len;
  };
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1]!.ts;
    const b = events[i]!.ts;
    if (b > a) push(a, b, b - a > gapMs);
  }
  if (tailMs > 0) push(lastTs, lastTs + tailMs, false);
  return { events, start, end: lastTs + tailMs, playDuration: play, segments };
}

const lerp = (from0: number, from1: number, to0: number, to1: number, x: number) =>
  from1 === from0 ? to0 : to0 + ((x - from0) / (from1 - from0)) * (to1 - to0);

/** Playback position → real time. Inside a squeezed stretch real time runs fast, so the clock stays truthful. */
export function toReal(tl: Timeline, playMs: number): number {
  if (playMs <= 0 || !tl.segments.length) return tl.start;
  const seg = tl.segments.find((s) => playMs <= s.playEnd) ?? tl.segments.at(-1)!;
  return Math.min(tl.end, lerp(seg.playStart, seg.playEnd, seg.realStart, seg.realEnd, Math.min(playMs, seg.playEnd)));
}

/** Real time → playback position. */
export function toPlay(tl: Timeline, ts: number): number {
  if (ts <= tl.start || !tl.segments.length) return 0;
  const seg = tl.segments.find((s) => ts <= s.realEnd) ?? tl.segments.at(-1)!;
  return lerp(seg.realStart, seg.realEnd, seg.playStart, seg.playEnd, Math.min(ts, seg.realEnd));
}

/** Moves the playhead by `dtMs` of wall time at `speed`, stopping at the end. */
export function advance(playMs: number, dtMs: number, speed: number, playDuration: number): { playMs: number; ended: boolean } {
  const next = Math.min(playDuration, Math.max(0, playMs + dtMs * speed));
  return { playMs: next, ended: next >= playDuration };
}

function reduceUpTo(state: OfficeState, events: readonly OfficeEvent[], from: number, ts: number): { state: OfficeState; next: number } {
  let i = from;
  for (; i < events.length && events[i]!.ts <= ts; i++) state = reduceOffice(state, events[i]!).state;
  return { state, next: i };
}

/** The office at real time `ts`: every event up to then from an empty office, then the off-duty sweep. Pure. */
export function officeAt(events: readonly OfficeEvent[], ts: number, offDutyMs: number): OfficeState {
  return sweepOffDuty(reduceUpTo(EMPTY_OFFICE, events, 0, ts).state, ts, offDutyMs);
}

/**
 * Playback cache: moving forward only applies the events passed since the
 * last call; moving back recomputes from the start. Either way the result
 * equals `officeAt` (the sweep runs on the unswept state each time).
 */
export class Replayer {
  private base: OfficeState = EMPTY_OFFICE;
  private next = 0;
  private ts = -Infinity;
  private last: { key: string; state: OfficeState } | undefined;

  constructor(
    private readonly events: readonly OfficeEvent[],
    private readonly offDutyMs: number,
  ) {}

  /** The office at `ts`. Returns the previous object when nothing changed, so callers can skip redrawing. */
  at(ts: number): OfficeState {
    if (ts < this.ts) {
      this.base = EMPTY_OFFICE;
      this.next = 0;
    }
    ({ state: this.base, next: this.next } = reduceUpTo(this.base, this.events, this.next, ts));
    this.ts = ts;
    const state = sweepOffDuty(this.base, ts, this.offDutyMs);
    const off = Object.values(state.sessions).flatMap((s) => (s.offDuty ? [s.sessionId] : []));
    const key = `${this.next}|${off.join(",")}`;
    if (this.last?.key !== key) this.last = { key, state };
    return this.last.state;
  }

  /** Events already played at the last `at()` call. */
  played(): OfficeEvent[] {
    return this.events.slice(0, this.next);
  }
}
