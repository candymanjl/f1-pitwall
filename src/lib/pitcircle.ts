import { indexLocations, isRecentLocation, locationOnTrack, nearestIndexed, type LocHit } from "../data/carLocation";
import { nearestFrac } from "../data/pitlane";
import type { LocationSample } from "../data/types";
import { teamColor, teamFill } from "./colors";
import { asNumber } from "./time";

/** One revolution, clockwise from S/F at 12 o'clock (SVG y-down). */

export function wrap01(frac: number): number {
  if (!Number.isFinite(frac)) return 0;
  return ((frac % 1) + 1) % 1;
}

/** Angle in radians: 0 frac = 12 o'clock, increasing frac travels clockwise. */
export function fracToAngle(frac: number): number {
  return -Math.PI / 2 + wrap01(frac) * Math.PI * 2;
}

export function pointOnCircle(
  cx: number,
  cy: number,
  r: number,
  frac: number,
): { x: number; y: number; a: number } {
  const a = fracToAngle(frac);
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a };
}

/** Midpoint travelling clockwise from `from` to `to`. */
export function midFracClockwise(from: number, to: number): number {
  const d = wrap01(to - from);
  return wrap01(from + d / 2);
}

export function clockwiseDelta(from: number, to: number): number {
  const d = wrap01(to - from);
  return d === 0 ? 0 : d;
}

export type CircleCar = {
  driver: number;
  code: string;
  frac: number;
  inPit: boolean;
  retired: boolean;
  pace: number | null;
  /** Team hex — used so the gap slice behind this car keeps a stable color. */
  color?: string;
  place?: "location" | "progress" | "gap" | "pit";
};

/** Place a car from leader progress + gap (seconds), matching the track map. */
export function gapFrac(leaderProgress: number, gapSec: number, lapSec: number): number {
  return wrap01(leaderProgress - gapSec / Math.max(1, lapSec));
}

/** Map elapsed-lap progress onto the racing line. Pit-out laps start at pit exit. */
export function racingFrac(progress: number, pitOut: boolean, pitExit: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (!pitOut) return Math.min(0.999, p);
  const exit = wrap01(pitExit);
  return wrap01(exit + p * (1 - exit));
}

export type TrackCarRow = {
  pos: number;
  gap: number | string | null;
  interval?: number | string | null;
  progress: number;
  pitOut: boolean;
  inPit?: boolean;
  retired?: boolean;
  inGarage?: boolean;
  status?: string;
  currentLap?: number | null;
  lapActive?: boolean;
  driver?: { driver_number: number };
};

export type PlaceCarOpts = {
  leaderProgress: number;
  lapSec: number;
  pitEntry: number;
  pitExit: number;
  now?: number;
  track?: [number, number][];
  locations?: LocationSample[] | null;
  locIndex?: Map<number, LocHit[]>;
  /** Race / sprint only. Practice and quali never use tower Gap/Int. */
  useRaceGaps?: boolean;
  /** Track map / strip only. Pit circle never uses GPS in a race. */
  preferLocation?: boolean;
};

export type PlacedCar = { frac: number; source: "location" | "progress" | "gap" | "pit" };

const RACE_GAP_MAX_SEC = 180;

function canUseProgress(row: TrackCarRow): boolean {
  if (row.lapActive === false) return false;
  if (row.lapActive === true) return true;
  return row.currentLap != null;
}

function lapsBehind(value: number | string | null | undefined): number | null {
  if (typeof value !== "string" || !/lap/i.test(value)) return null;
  const n = Number((value.match(/(\d+)/) ?? [])[1]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function numericRaceGap(value: number | string | null | undefined): number | null {
  const gap = asNumber(value);
  if (gap == null || Math.abs(gap) > RACE_GAP_MAX_SEC) return null;
  return gap;
}

/**
 * Time (seconds) behind the leader for the pit-circle clock.
 * Numeric Gap/Int win. "+1 LAP" adds a full lap to the previous car's time
 * once; later +1 LAP cars without an interval fall through to the caller.
 */
export function raceGapSec(row: TrackCarRow, prevGap: number | null, lapSec: number): number | null {
  if (row.pos === 1) return 0;
  const gap = numericRaceGap(row.gap);
  if (gap != null) return gap;
  const iv = numericRaceGap(row.interval);
  if (prevGap != null && iv != null) return prevGap + iv;
  const behind = lapsBehind(row.gap) ?? lapsBehind(row.interval);
  if (prevGap != null && behind != null) {
    const already = Math.floor((prevGap + 1e-9) / Math.max(1, lapSec));
    if (already < behind) return prevGap + (behind - already) * Math.max(1, lapSec);
  }
  return null;
}

/**
 * Map / strip placement.
 * Prefer a live /location sample when the car is on the racing line.
 * Races then keep interval-gap placement (#28); practice/quali never use
 * tower Gap/Int (those are best-lap deltas, not on-track gaps).
 */
export function placeTrackCar(row: TrackCarRow, opts: PlaceCarOpts): PlacedCar | null {
  if (row.retired || row.inGarage || row.status === "GARAGE") return null;
  if (row.inPit) return { frac: wrap01(opts.pitEntry), source: "pit" };

  if (opts.preferLocation !== false) {
    const now = opts.now ?? 0;
    const track = opts.track ?? [];
    const n = row.driver?.driver_number;
    const index = opts.locIndex ?? indexLocations(opts.locations);
    const hit = n != null ? nearestIndexed(index.get(n), now) : null;
    if (isRecentLocation(hit, now) && hit) {
      if (locationOnTrack(track, hit.x, hit.y)) {
        return { frac: nearestFrac(track, hit.x, hit.y), source: "location" };
      }
      return null;
    }
  }

  if (opts.useRaceGaps) {
    const gapSec = row.pos === 1 ? 0 : numericRaceGap(row.gap);
    if (gapSec != null) {
      return { frac: gapFrac(opts.leaderProgress, gapSec, opts.lapSec), source: "gap" };
    }
  }

  if (canUseProgress(row)) {
    return { frac: racingFrac(row.progress, row.pitOut, opts.pitExit), source: "progress" };
  }

  return null;
}

/**
 * Pit-circle placement. Races are a time clock (gap/interval seconds).
 * GPS and lap-progress must not drive the circle during a race — that is
 * what made Mexico 2025 replay jitter after #30.
 */
export function placeCircleCars(rows: TrackCarRow[], opts: PlaceCarOpts): Array<PlacedCar | null> {
  if (!opts.useRaceGaps) {
    return rows.map((row) => placeTrackCar(row, { ...opts, preferLocation: true, useRaceGaps: false }));
  }
  let prevGap: number | null = null;
  return rows.map((row) => {
    if (row.retired || row.inGarage || row.status === "GARAGE") return null;
    if (row.inPit) return { frac: wrap01(opts.pitEntry), source: "pit" };
    const gapSec = raceGapSec(row, prevGap, opts.lapSec);
    if (gapSec != null) {
      prevGap = gapSec;
      return { frac: gapFrac(opts.leaderProgress, gapSec, opts.lapSec), source: "gap" };
    }
    if (canUseProgress(row)) {
      return { frac: racingFrac(row.progress, row.pitOut, opts.pitExit), source: "progress" };
    }
    return null;
  });
}

/**
 * On-track fraction for map, footer strip, and pit circle.
 * Lead-lap cars with a numeric race gap sit relative to the leader.
 * Lapped / "+1 LAP" / missing-gap cars use their own lap progress so they stay visible.
 */
export function trackCarFrac(row: TrackCarRow, opts: PlaceCarOpts): number {
  return placeTrackCar(row, { ...opts, useRaceGaps: opts.useRaceGaps ?? true })?.frac ?? racingFrac(row.progress, row.pitOut, opts.pitExit);
}

export type TrackGap = {
  behind: number;
  ahead: number;
  behindCode: string;
  aheadCode: string;
  from: number;
  to: number;
  mid: number;
  gap: number;
  /** Translucent fill of the car this slice sits behind (the leading/`ahead` driver). */
  fill: string;
  /** Opaque team color of that same leading driver. */
  color: string;
};

/** Filled clockwise pie slice from `from` to `to` (S/F = 0 at 12 o'clock). */
export function wedgePath(cx: number, cy: number, r: number, from: number, to: number): string {
  const delta = clockwiseDelta(from, to);
  if (delta < 1e-6 || r <= 0) return "";
  const a = pointOnCircle(cx, cy, r, from);
  const b = pointOnCircle(cx, cy, r, to);
  const large = delta > 0.5 ? 1 : 0;
  return `M${cx.toFixed(1)},${cy.toFixed(1)} L${a.x.toFixed(1)},${a.y.toFixed(1)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(1)},${b.y.toFixed(1)} Z`;
}

/**
 * Gaps between consecutive cars on the racing line (physical order, including
 * lapped cars). Time = clockwise frac delta × the trailing car's pace.
 */
export function onTrackGaps(cars: CircleCar[], fallbackPace: number): TrackGap[] {
  const on = cars
    .filter((c) => !c.retired && !c.inPit && Number.isFinite(c.frac))
    .sort((a, b) => wrap01(a.frac) - wrap01(b.frac));
  if (on.length < 2) return [];
  const out: TrackGap[] = [];
  for (let i = 0; i < on.length; i++) {
    const behind = on[i];
    const ahead = on[(i + 1) % on.length];
    const dfrac = clockwiseDelta(behind.frac, ahead.frac);
    const pace = behind.pace && behind.pace > 0 ? behind.pace : fallbackPace;
    out.push({
      behind: behind.driver,
      ahead: ahead.driver,
      behindCode: behind.code,
      aheadCode: ahead.code,
      from: wrap01(behind.frac),
      to: wrap01(ahead.frac),
      mid: midFracClockwise(behind.frac, ahead.frac),
      gap: dfrac * pace,
      fill: teamFill(ahead.color),
      color: teamColor(ahead.color),
    });
  }
  return out;
}

export function ghostFrac(current: number, pitLoss: number, lapTime: number): number {
  const lap = lapTime > 0 ? lapTime : 90;
  return wrap01(current - pitLoss / lap);
}

/** How many S/F crossings a backward pit-loss jump makes (0 = same lap). */
export function ghostLapsDown(current: number, pitLoss: number, lapTime: number): number {
  const lap = lapTime > 0 ? lapTime : 90;
  const raw = (Number.isFinite(current) ? current : 0) - Math.max(0, pitLoss) / lap;
  if (raw >= 0) return 0;
  return Math.ceil(-raw);
}

export function neighborsAt(
  cars: CircleCar[],
  frac: number,
): { ahead: CircleCar | null; behind: CircleCar | null } {
  const on = cars
    .filter((c) => !c.retired && !c.inPit)
    .sort((a, b) => wrap01(a.frac) - wrap01(b.frac));
  if (!on.length) return { ahead: null, behind: null };
  let ahead = on[0];
  let behind = on[on.length - 1];
  for (const c of on) {
    if (wrap01(c.frac) > wrap01(frac) + 1e-9) {
      ahead = c;
      break;
    }
    behind = c;
  }
  const idx = on.indexOf(ahead);
  behind = on[(idx - 1 + on.length) % on.length];
  if (ahead.driver === behind.driver && on.length === 1) return { ahead: on[0], behind: on[0] };
  return { ahead, behind };
}

export type RejoinPreview = {
  ahead: CircleCar | null;
  behind: CircleCar | null;
  gapAhead: number | null;
  gapBehind: number | null;
  lapsDown: number;
  frac: number;
};

/** Ahead is negative (time to the car in front); behind is positive. */
export function rejoinGapText(
  code: string,
  seconds: number | null | undefined,
  side: "ahead" | "behind",
): string {
  if (seconds == null || !Number.isFinite(seconds)) return `${code} —`;
  const mag = Math.abs(seconds).toFixed(3);
  return side === "ahead" ? `${code} −${mag}` : `${code} +${mag}`;
}

/** Who a pit rejoin sits between, and the on-track gaps in seconds. */
export function rejoinPreview(
  cars: CircleCar[],
  current: number,
  pitLoss: number,
  lapTime: number,
): RejoinPreview {
  const frac = ghostFrac(current, pitLoss, lapTime);
  const lapsDown = ghostLapsDown(current, pitLoss, lapTime);
  const others = cars.filter((c) => !c.retired && !c.inPit);
  const { ahead, behind } = neighborsAt(others, frac);
  const paceOf = (c: CircleCar | null) => (c?.pace && c.pace > 0 ? c.pace : lapTime > 0 ? lapTime : 90);
  return {
    ahead,
    behind,
    gapAhead: ahead ? clockwiseDelta(frac, ahead.frac) * paceOf(ahead) : null,
    gapBehind: behind ? clockwiseDelta(behind.frac, frac) * paceOf(behind) : null,
    lapsDown,
    frac,
  };
}
