import type { DataMode } from "../config";
import { followLiveFromSlider } from "./sessionClock";

/** How close to the playable end (newest sample) counts as “at the live edge”. */
export const LIVE_EDGE_SLOP_MS = 1500;

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
};

export type PlaybackResult = {
  t: number;
  playing: boolean;
  followLive: boolean;
};

/**
 * Advance (or hold) the replay cursor.
 * Live-following only when `followLive` and playing and the user is not dragging.
 * Play from mid-session walks forward at `speed` — it never jumps to Date.now().
 */
export function stepPlayback(s: PlaybackStep): PlaybackResult {
  if (s.scrubbing) {
    return { t: clampClock(s.t, s.start, s.end), playing: s.playing, followLive: false };
  }

  if (s.mode === "live" && s.followLive && s.playing) {
    return { t: clampClock(s.end, s.start, s.end), playing: true, followLive: true };
  }

  if (!s.playing) {
    return { t: clampClock(s.t, s.start, s.end), playing: false, followLive: false };
  }

  const next = s.t + s.dt * s.speed;
  if (s.mode === "live" && next >= s.end) {
    return { t: s.end, playing: true, followLive: true };
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

export function followLiveOnPlay(t: number, end: number, mode: DataMode): boolean {
  return mode === "live" && isAtLiveEdge(t, end);
}

export { followLiveFromSlider };
