import { latestBefore, parseTs } from "../lib/time";
import type { Weather } from "./types";

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

export function windFromLabel(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[i];
}

export function weatherAt(samples: Weather[] | null | undefined, now: number): Weather | null {
  const rows = [...(samples ?? [])].sort((a, b) => parseTs(a.date) - parseTs(b.date));
  return latestBefore(rows, now, (row) => parseTs(row.date));
}

/** OpenF1 samples at or before the playhead — never future leakage. */
export function weatherHistoryUpTo(samples: Weather[] | null | undefined, now: number): Weather[] {
  return [...(samples ?? [])]
    .filter((row) => Number.isFinite(parseTs(row.date)) && parseTs(row.date) <= now)
    .sort((a, b) => parseTs(a.date) - parseTs(b.date));
}

export function rainObservedBuckets(
  samples: Weather[] | null | undefined,
  start: number,
  end: number,
  now: number,
  count = 48,
): boolean[] {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const span = Math.max(1, hi - lo);
  const out = Array.from({ length: count }, () => false);
  const cap = Math.min(now, hi);
  for (const row of samples ?? []) {
    const t = parseTs(row.date);
    if (!Number.isFinite(t) || t < lo || t > cap) continue;
    if (!(row.rainfall && row.rainfall > 0)) continue;
    const i = Math.min(count - 1, Math.max(0, Math.floor(((t - lo) / span) * count)));
    out[i] = true;
  }
  return out;
}
