import type { DataMode } from "../config";

/** How close to the newest sample counts as “at the live edge”. */
export const LIVE_EDGE_SLOP_MS = 1500;

export function liveEdgeMs(end: number, now: number): number {
  return Math.min(end, now);
}

export function isAtLiveEdge(t: number, end: number, now: number, slop = LIVE_EDGE_SLOP_MS): boolean {
  return t >= liveEdgeMs(end, now) - slop;
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
};

export type PlaybackResult = {
  t: number;
  playing: boolean;
  followLive: boolean;
};

/**
 * Advance (or hold) the replay cursor.
 * Live-following only when `followLive` and playing — Play from mid-session
 * walks forward at `speed` instead of jumping to Date.now().
 */
export function stepPlayback(s: PlaybackStep): PlaybackResult {
  const edge = liveEdgeMs(s.end, s.now);

  if (s.mode === "live" && s.followLive && s.playing) {
    return { t: clampClock(edge, s.start, s.end), playing: true, followLive: true };
  }

  if (!s.playing) {
    return { t: clampClock(s.t, s.start, s.end), playing: false, followLive: false };
  }

  const next = s.t + s.dt * s.speed;
  if (s.mode === "live" && next >= edge) {
    return { t: clampClock(edge, s.start, s.end), playing: true, followLive: true };
  }
  if (next >= s.end) {
    return { t: s.end, playing: false, followLive: false };
  }
  return { t: next, playing: true, followLive: false };
}

/** Scrubbing onto the newest sample arms live-follow; scrubbing away disarms it. */
export function followLiveFromScrub(t: number, end: number, now: number, mode: DataMode): boolean {
  return mode === "live" && isAtLiveEdge(t, end, now);
}

/** Play at the live edge follows; Play from anywhere else starts a replay. */
export function followLiveOnPlay(t: number, end: number, now: number, mode: DataMode): boolean {
  return mode === "live" && isAtLiveEdge(t, end, now);
}
