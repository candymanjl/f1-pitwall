import type { DataMode } from "../config";
import { followLiveFromSlider } from "./sessionClock";

/** How close to the playable end (newest sample) counts as “at the live edge”. */
export const LIVE_EDGE_SLOP_MS = 1500;

/** Snap the delayed clock only when it is this far from the GPS delay (reconnect, long pause). */
export const LIVE_DELAY_HARD_MS = 8_000;
/** Drift is eased over about this many milliseconds, not in one frame. */
export const LIVE_DELAY_TAU_MS = 4_000;
export const LIVE_DELAY_MIN_RATE = 0.88;
export const LIVE_DELAY_MAX_RATE = 1.12;

/** Where live-follow should sit: `delayMs` behind the newest GPS fix, clamped to the slider. */
export function liveDelayTarget(start: number, end: number, locationMs: number, delayMs: number): number {
  return clampClock(locationMs - delayMs, start, end);
}

/**
 * Move the live clock by about one wall-clock millisecond per millisecond.
 * A small lead or lag changes the rate a little. A multi-second hole snaps once.
 */
export function stepLiveDelayClock(t: number, target: number, dtMs: number, start: number, end: number): number {
  if (!Number.isFinite(t)) return clampClock(target, start, end);
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const err = target - t;
  if (Math.abs(err) >= LIVE_DELAY_HARD_MS || dt >= LIVE_DELAY_HARD_MS) {
    return clampClock(target, start, end);
  }
  const rate = Math.min(LIVE_DELAY_MAX_RATE, Math.max(LIVE_DELAY_MIN_RATE, 1 + err / LIVE_DELAY_TAU_MS));
  return clampClock(t + dt * rate, start, end);
}

export function liveEdgeMs(end: number, _now?: number): number {
  return end;
}

export function isAtLiveEdge(t: number, end: number, _now?: number, slop = LIVE_EDGE_SLOP_MS): boolean {
  return t >= end - slop;
}

export function clampClock(t: number, start: number, end: number): number {
  return Math.min(end, Math.max(start, t));
}

export type PlaybackStep = {
  t: number;
  start: number;
  end: number;
  playing: boolean;
  speed: number;
  dt: number;
  mode: DataMode;
  followLive: boolean;
  now: number;
  scrubbing?: boolean;
  /** 0 or omitted pins follow-live to `end` (today's edge). */
  liveDelayMs?: number;
  /** Newest location sample, epoch ms. Required for the delay buffer. */
  locationMs?: number;
};

export type PlaybackResult = {
  t: number;
  playing: boolean;
  followLive: boolean;
};

function engagedDelayTarget(s: PlaybackStep): number | null {
  const delay = s.liveDelayMs ?? 0;
  if (s.mode !== "live" || delay <= 0 || !Number.isFinite(s.locationMs)) return null;
  return liveDelayTarget(s.start, s.end, s.locationMs as number, delay);
}

/**
 * Advance (or hold) the replay cursor.
 * Live-following only when `followLive` and playing and the user is not dragging.
 * With a live delay, follow-live walks in wall time behind the newest GPS fix.
 * It does not jump to `end`. Play from mid-session walks forward at `speed`.
 */
export function stepPlayback(s: PlaybackStep): PlaybackResult {
  if (s.scrubbing) {
    return { t: clampClock(s.t, s.start, s.end), playing: s.playing, followLive: false };
  }

  const delayed = engagedDelayTarget(s);

  if (s.mode === "live" && s.followLive && s.playing) {
    if (delayed == null) {
      return { t: clampClock(s.end, s.start, s.end), playing: true, followLive: true };
    }
    return {
      t: stepLiveDelayClock(s.t, delayed, s.dt, s.start, s.end),
      playing: true,
      followLive: true,
    };
  }

  if (!s.playing) {
    return { t: clampClock(s.t, s.start, s.end), playing: false, followLive: false };
  }

  const next = s.t + s.dt * s.speed;
  if (s.mode === "live" && delayed != null && s.t < delayed && next >= delayed) {
    return { t: delayed, playing: true, followLive: true };
  }
  if (s.mode === "live" && next >= s.end) {
    return { t: delayed ?? s.end, playing: true, followLive: true };
  }
  if (next >= s.end) {
    return { t: s.end, playing: false, followLive: false };
  }
  return { t: next, playing: true, followLive: false };
}

/** Any scrub exits live-follow unless the thumb is parked on the last sliver. */
export function followLiveFromScrub(t: number, start: number, end: number, mode: DataMode): boolean {
  const span = Math.max(1, end - start);
  return followLiveFromSlider((t - start) / span, mode);
}

export function followLiveOnPlay(
  t: number,
  end: number,
  mode: DataMode,
  opts?: { delayMs?: number; locationMs?: number; start?: number },
): boolean {
  if (mode !== "live") return false;
  const delay = opts?.delayMs ?? 0;
  const loc = opts?.locationMs;
  if (delay > 0 && loc != null && Number.isFinite(loc)) {
    const target = liveDelayTarget(opts?.start ?? t, end, loc, delay);
    return t >= target - LIVE_EDGE_SLOP_MS;
  }
  return isAtLiveEdge(t, end);
}

export { followLiveFromSlider };
