import { latestBefore, parseTs } from "../lib/time";
import type { Weather } from "./types";

export type PressureTrend = "up" | "down" | "steady";

export const PRESSURE_DEADBAND_MBAR = 0.5;
export const PRESSURE_LOOKBACK_MIN_MS = 10 * 60_000;
export const PRESSURE_LOOKBACK_MAX_MS = 15 * 60_000;
export const PRESSURE_LOOKBACK_TARGET_MS = (PRESSURE_LOOKBACK_MIN_MS + PRESSURE_LOOKBACK_MAX_MS) / 2;
export const PRESSURE_LOOKBACK_FALLBACK_MS = 20 * 60_000;

function pressureOf(row: Weather | null | undefined): number | null {
  const p = row?.pressure;
  return typeof p === "number" && Number.isFinite(p) ? p : null;
}

function withPressure(samples: Weather[] | null | undefined): Weather[] {
  return (samples ?? [])
    .filter((row) => pressureOf(row) != null && Number.isFinite(parseTs(row.date)))
    .sort((a, b) => parseTs(a.date) - parseTs(b.date));
}

/** Latest pressure sample at or before the playhead. */
export function pressureAt(samples: Weather[] | null | undefined, now: number): Weather | null {
  return latestBefore(withPressure(samples), now, (row) => parseTs(row.date));
}

/**
 * Sample roughly 10–15 minutes before `now`, closest to the 12.5-minute mark.
 * Falls back to the latest sample at least 10 minutes earlier if the window is empty.
 */
export function earlierPressureSample(samples: Weather[] | null | undefined, now: number): Weather | null {
  const rows = withPressure(samples);
  if (!rows.length || !Number.isFinite(now)) return null;
  const windowLo = now - PRESSURE_LOOKBACK_MAX_MS;
  const windowHi = now - PRESSURE_LOOKBACK_MIN_MS;
  const target = now - PRESSURE_LOOKBACK_TARGET_MS;
  let best: Weather | null = null;
  let bestDist = Infinity;
  for (const row of rows) {
    const t = parseTs(row.date);
    if (t < windowLo || t > windowHi) continue;
    const dist = Math.abs(t - target);
    if (dist < bestDist) {
      best = row;
      bestDist = dist;
    }
  }
  if (best) return best;
  const fallback = latestBefore(rows, windowHi, (row) => parseTs(row.date));
  if (!fallback) return null;
  const t = parseTs(fallback.date);
  if (now - t > PRESSURE_LOOKBACK_FALLBACK_MS) return null;
  return fallback;
}

export function weatherPressureAt(
  samples: Weather[] | null | undefined,
  now: number,
): { value: number | null; trend: PressureTrend | null } {
  const current = pressureAt(samples, now);
  const value = pressureOf(current);
  if (value == null) return { value: null, trend: null };
  const earlier = earlierPressureSample(samples, now);
  const prev = pressureOf(earlier);
  if (prev == null || earlier === current) return { value, trend: null };
  const delta = value - prev;
  if (Math.abs(delta) <= PRESSURE_DEADBAND_MBAR) return { value, trend: "steady" };
  return { value, trend: delta > 0 ? "up" : "down" };
}

export function formatPressure(mbar: number | null | undefined): string {
  if (mbar == null || !Number.isFinite(mbar)) return "— mbar";
  const rounded = Math.round(mbar * 10) / 10;
  const text = Math.abs(rounded - Math.round(rounded)) < 0.05 ? String(Math.round(rounded)) : rounded.toFixed(1);
  return `${text} mbar`;
}

export function pressureTrendMark(trend: PressureTrend | null): string {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  return "–";
}

export function pressureTrendLabel(trend: PressureTrend | null): string {
  if (trend === "up") return "rising";
  if (trend === "down") return "falling";
  if (trend === "steady") return "steady";
  return "no trend";
}
