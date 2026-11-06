import { parseTs } from "../lib/time";
import type { Lap } from "./types";

/** Reconstruct a missing / unparseable `date_start` from neighbouring laps. */
export function fillMissingLapStarts(laps: Lap[], sessionStartMs: number): Lap[] {
  if (!laps.length) return laps;
  const groups = new Map<number, Lap[]>();
  for (const lap of laps) {
    const list = groups.get(lap.driver_number) ?? [];
    list.push(lap);
    groups.set(lap.driver_number, list);
  }
  let changed = false;
  const out: Lap[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.lap_number - b.lap_number);
    const starts = group.map((lap) => parseTs(lap.date_start));
    for (let i = 0; i < group.length; i++) {
      if (Number.isFinite(starts[i])) continue;
      const prev = i > 0 ? starts[i - 1] : NaN;
      const prevDur = i > 0 ? group[i - 1].lap_duration : null;
      if (Number.isFinite(prev) && prevDur != null && prevDur > 0) {
        starts[i] = prev + prevDur * 1000;
        continue;
      }
      if (i === 0 && Number.isFinite(sessionStartMs)) starts[i] = sessionStartMs;
    }
    for (let i = group.length - 1; i >= 0; i--) {
      if (Number.isFinite(starts[i])) continue;
      const next = i + 1 < group.length ? starts[i + 1] : NaN;
      const dur = group[i].lap_duration;
      if (Number.isFinite(next) && dur != null && dur > 0) starts[i] = next - dur * 1000;
    }
    for (let i = 0; i < group.length; i++) {
      const lap = group[i];
      if (Number.isFinite(starts[i]) && !Number.isFinite(parseTs(lap.date_start))) {
        changed = true;
        out.push({ ...lap, date_start: new Date(starts[i]).toISOString() });
      } else {
        out.push(lap);
      }
    }
  }
  return changed ? out : laps;
}

export function timingLooksSparse(bundle: {
  laps: Array<{ lap_number: number }>;
  stints: Array<{ lap_end: number | null }>;
  weather: unknown[];
}): boolean {
  const stintMax = Math.max(0, ...bundle.stints.map((s) => s.lap_end ?? 0));
  if (bundle.laps.length === 0 && bundle.stints.length > 0) return true;
  if (stintMax > 2 && bundle.laps.length < stintMax) return true;
  if (bundle.weather.length === 0 && bundle.stints.length > 0) return true;
  return false;
}
