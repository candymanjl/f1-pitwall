import { parseTs } from "../lib/time";
import { wrap01 } from "../lib/pitcircle";
import type { LocationSample, Pit } from "./types";
import { polylineLength } from "./track";

export const DEFAULT_PIT_ENTRY = 0.97;
export const DEFAULT_PIT_EXIT = 0.05;

/** Closest point on the racing-line polyline, as a 0–1 fraction from S/F. */
export function nearestFrac(pts: [number, number][], x: number, y: number): number {
  if (pts.length < 2) return 0;
  const total = polylineLength(pts);
  if (total <= 0) return 0;
  let bestD = Infinity;
  let bestAt = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const ay = pts[i - 1][1];
    const bx = pts[i][0];
    const by = pts[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const seg = Math.hypot(dx, dy);
    if (seg <= 0) continue;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (seg * seg)));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < bestD) {
      bestD = d;
      bestAt = acc + seg * t;
    }
    acc += seg;
  }
  return wrap01(bestAt / total);
}

function distToTrack(pts: [number, number][], x: number, y: number): number {
  if (pts.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const ay = pts[i - 1][1];
    const bx = pts[i][0];
    const by = pts[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const seg2 = dx * dx + dy * dy;
    const t = seg2 <= 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / seg2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return best;
}

/**
 * Infer pit-lane entry/exit as racing-line fractions from a location trace that
 * leaves the circuit, travels the pits, then rejoins.
 */
export function detectPitLane(
  track: [number, number][],
  samples: LocationSample[],
): { entry: number; exit: number } | null {
  if (track.length < 2 || samples.length < 6) return null;
  const ordered = [...samples]
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y))
    .sort((a, b) => parseTs(a.date) - parseTs(b.date));
  if (ordered.length < 6) return null;

  const dists = ordered.map((s) => distToTrack(track, s.x, s.y));
  const ranked = [...dists].sort((a, b) => a - b);
  const baseline = ranked[Math.floor(ranked.length * 0.2)] ?? ranked[0];
  const span = polylineLength(track);
  const threshold = Math.max(baseline * 6, span * 0.012, 30);

  let bestStart = -1;
  let bestEnd = -1;
  let bestLen = 0;
  let run = -1;
  for (let i = 0; i < dists.length; i++) {
    if (dists[i] > threshold) {
      if (run < 0) run = i;
    } else if (run >= 0) {
      const len = i - run;
      if (len > bestLen) {
        bestLen = len;
        bestStart = run;
        bestEnd = i - 1;
      }
      run = -1;
    }
  }
  if (run >= 0 && dists.length - run > bestLen) {
    bestStart = run;
    bestEnd = dists.length - 1;
    bestLen = dists.length - run;
  }
  if (bestLen < 2 || bestStart <= 0 || bestEnd >= ordered.length - 1) return null;

  const entrySample = ordered[bestStart - 1];
  const exitSample = ordered[bestEnd + 1];
  const entry = nearestFrac(track, entrySample.x, entrySample.y);
  const exit = nearestFrac(track, exitSample.x, exitSample.y);
  if (Math.abs(wrap01(entry - exit)) < 0.01) return null;
  return { entry, exit };
}

export function pickPitForTrace(pits: Pit[]): Pit | null {
  const usable = pits.filter((p) => p.date && Number.isFinite(parseTs(p.date)));
  if (!usable.length) return null;
  return [...usable].sort((a, b) => (b.lane_duration ?? 0) - (a.lane_duration ?? 0))[0] ?? null;
}
