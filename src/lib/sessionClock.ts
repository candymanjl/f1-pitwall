import { parseTs } from "./time";
import type { SessionBundle } from "../data/types";

function consider(max: number, raw: string | null | undefined): number {
  const t = parseTs(raw);
  return Number.isFinite(t) && t > max ? t : max;
}

/** Newest timestamp that actually exists in the bundle — not wall clock, not scheduled date_end. */
export function latestSampleMs(bundle: SessionBundle | null | undefined): number {
  if (!bundle) return NaN;
  let max = -Infinity;
  for (const lap of bundle.laps) {
    max = consider(max, lap.date_start);
    const start = parseTs(lap.date_start);
    if (Number.isFinite(start) && lap.lap_duration && lap.lap_duration > 0) {
      const fin = start + lap.lap_duration * 1000;
      if (fin > max) max = fin;
    }
  }
  for (const row of bundle.intervals) max = consider(max, row.date);
  for (const row of bundle.positions) max = consider(max, row.date);
  for (const row of bundle.pits) max = consider(max, row.date);
  for (const row of bundle.weather) max = consider(max, row.date);
  for (const row of bundle.raceControl) max = consider(max, row.date);
  return Number.isFinite(max) && max > 0 ? max : NaN;
}

/**
 * Slider / playback end is the newest sample.
 * Using session.date_end or Date.now() walks past the data and stacks every car at 0.999.
 */
export function playableEndMs(start: number, bundle: SessionBundle | null | undefined): number {
  const latest = latestSampleMs(bundle);
  if (Number.isFinite(latest) && latest > start) return latest;
  const scheduled = bundle ? parseTs(bundle.session.date_end) : NaN;
  if (Number.isFinite(scheduled) && scheduled > start) return scheduled;
  return start + 1;
}

function clampMs(t: number, start: number, end: number): number {
  return Math.min(end, Math.max(start, t));
}

/**
 * Historical sessions open halfway through the race (mid lap), not at the end.
 * If that lap is missing, interpolate between the nearest recorded laps.
 */
export function historicalStartMs(
  start: number,
  end: number,
  bundle: SessionBundle | null | undefined,
): number {
  const spanMid = start + (end - start) * 0.5;
  const samples = (bundle?.laps ?? [])
    .map((lap) => ({ n: lap.lap_number, t: parseTs(lap.date_start) }))
    .filter((lap) => Number.isFinite(lap.t) && lap.n > 0)
    .sort((a, b) => a.n - b.n || a.t - b.t);
  if (!samples.length) return clampMs(spanMid, start, end);

  const minLap = samples[0].n;
  const maxLap = samples[samples.length - 1].n;
  const target = (minLap + maxLap) / 2;
  const targetLap = Math.round(target);
  const exact = samples.filter((s) => s.n === targetLap);
  if (exact.length) return clampMs(Math.min(...exact.map((s) => s.t)), start, end);

  let lo = samples[0];
  let hi = samples[samples.length - 1];
  for (const s of samples) {
    if (s.n <= target) lo = s;
    if (s.n >= target) {
      hi = s;
      break;
    }
  }
  if (hi.n === lo.n) return clampMs(lo.t, start, end);
  const frac = (target - lo.n) / (hi.n - lo.n);
  return clampMs(lo.t + (hi.t - lo.t) * frac, start, end);
}

export const SCRUB_LIVE_EDGE = 0.995;

/** Re-arm live-follow only when the user parks the slider on the last sliver. */
export function followLiveFromSlider(slider01: number, mode: "historical" | "live"): boolean {
  return mode === "live" && slider01 >= SCRUB_LIVE_EDGE;
}
