import { indexLocations } from "../data/carLocation";
import { isRaceOrSprint } from "../data/grid";
import { pitLaneFracs } from "../data/pitlane";
import type { SessionBundle, TimingSnapshot } from "../data/types";
import { placeTrackCar, wrap01, type PlaceCarOpts, type PlacedCar } from "./pitcircle";

/** Exponential smoothing of frac/second. */
export const MOTION_EMA = 0.35;
/** ~25s lap — faster than any race, slow enough to kill GPS spikes. */
export const MOTION_MAX_RATE = 0.04;
/** Do not predict more than this far past the last sample. */
export const MOTION_MAX_LEAD = 0.045;
/** Session seconds without a new sample before prediction stops. */
export const MOTION_SILENCE_S = 2.5;
/** Only rewind when the sample is this far behind (scrub / teleport). */
export const MOTION_BACK_ERR = 0.08;
/** Extra catch-up toward a target that is still ahead (frac/s). */
export const MOTION_BLEND = 0.02;

export type MotionCar = {
  n: number;
  displayed: number;
  target: number;
  rate: number;
  source: PlacedCar["source"];
  lastSampleT: number;
};

const cars = new Map<number, MotionCar>();
let lastStepT = Number.NaN;
const rawJumps: number[] = [];
const shownJumps: number[] = [];
const painters = new Map<string, () => void>();

function pushJump(list: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  list.push(value);
  if (list.length > 500) list.shift();
}

/** Shortest signed on-track delta in (−0.5, 0.5]. Positive is forward. */
export function signedTrackDelta(from: number, to: number): number {
  const d = wrap01(to - from);
  return d > 0.5 ? d - 1 : d;
}

export function forwardDelta(from: number, to: number): number {
  return wrap01(to - from);
}

export function resetCarMotion(): void {
  cars.clear();
  lastStepT = Number.NaN;
  rawJumps.length = 0;
  shownJumps.length = 0;
}

export function displayedFrac(n: number): number | null {
  return cars.get(n)?.displayed ?? null;
}

export function displayedSource(n: number): PlacedCar["source"] | null {
  return cars.get(n)?.source ?? null;
}

export function motionCars(): ReadonlyMap<number, MotionCar> {
  return cars;
}

export function setMotionPainter(id: string, fn: (() => void) | null): void {
  if (fn) painters.set(id, fn);
  else painters.delete(id);
}

export function notifyMotion(): void {
  for (const fn of painters.values()) fn();
}

export function motionJumpSummary(): {
  rawMax: number;
  shownMax: number;
  rawMean: number;
  shownMean: number;
  nRaw: number;
  nShown: number;
} {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
  return {
    rawMax: max(rawJumps),
    shownMax: max(shownJumps),
    rawMean: avg(rawJumps),
    shownMean: avg(shownJumps),
    nRaw: rawJumps.length,
    nShown: shownJumps.length,
  };
}

export function placeOptsForSnap(bundle: SessionBundle, snap: TimingSnapshot): PlaceCarOpts {
  const pits = pitLaneFracs(bundle);
  return {
    leaderProgress: snap.rows[0]?.progress ?? 0,
    lapSec: snap.medianGreenLap,
    pitEntry: pits.entry,
    pitExit: pits.exit,
    now: snap.now,
    track: bundle.track,
    locations: bundle.locations,
    locIndex: indexLocations(bundle.locations),
    useRaceGaps: isRaceOrSprint(bundle.session),
  };
}

function observe(
  n: number,
  frac: number,
  source: PlacedCar["source"],
  t: number,
  playing: boolean,
): void {
  const target = wrap01(frac);
  const prev = cars.get(n);
  if (!prev) {
    cars.set(n, { n, displayed: target, target, rate: 0, source, lastSampleT: t });
    return;
  }
  const signed = signedTrackDelta(prev.target, target);
  if (Math.abs(signed) < 1e-5 && prev.source === source) return;
  const dt = (t - prev.lastSampleT) / 1000;
  const jump = forwardDelta(prev.target, target);
  pushJump(rawJumps, Math.abs(signed));
  if (source === "pit" || !playing) {
    prev.displayed = target;
    prev.target = target;
    prev.rate = 0;
    prev.source = source;
    prev.lastSampleT = t;
    return;
  }
  if (dt <= 0 || dt > 8) {
    prev.target = target;
    prev.source = source;
    prev.lastSampleT = t;
    if (dt > 8) {
      prev.displayed = target;
      prev.rate = 0;
    }
    return;
  }
  if (signed >= 0 && dt >= 0.04) {
    const inst = Math.min(MOTION_MAX_RATE, jump / dt);
    prev.rate = prev.rate <= 0 ? inst : prev.rate * (1 - MOTION_EMA) + inst * MOTION_EMA;
    prev.rate = Math.min(MOTION_MAX_RATE, Math.max(0, prev.rate));
  } else if (signed < -MOTION_BACK_ERR) {
    prev.displayed = target;
    prev.rate = 0;
  }
  prev.target = target;
  prev.source = source;
  prev.lastSampleT = t;
}

export function syncCarMotion(
  bundle: SessionBundle,
  snap: TimingSnapshot,
  t: number,
  playing: boolean,
): void {
  const opts = placeOptsForSnap(bundle, snap);
  const seen = new Set<number>();
  for (const row of snap.rows) {
    const placed = placeTrackCar(row, opts);
    const n = row.driver.driver_number;
    if (!placed) continue;
    seen.add(n);
    observe(n, placed.frac, placed.source, t, playing);
  }
  for (const n of [...cars.keys()]) {
    if (!seen.has(n)) cars.delete(n);
  }
}

function snapAllToTarget(): void {
  for (const car of cars.values()) car.displayed = car.target;
}

/**
 * Advance displayed fractions in session time.
 * Returns true when any icon moved enough to repaint.
 */
export function stepCarMotion(t: number, playing: boolean, scrubbing: boolean): boolean {
  if (scrubbing) {
    snapAllToTarget();
    lastStepT = t;
    return false;
  }
  if (!playing) {
    lastStepT = t;
    return false;
  }
  if (!Number.isFinite(lastStepT)) {
    lastStepT = t;
    return false;
  }
  const dt = (t - lastStepT) / 1000;
  lastStepT = t;
  if (dt <= 0) return false;
  if (dt > 1.2) {
    snapAllToTarget();
    return true;
  }
  let moved = false;
  for (const car of cars.values()) {
    const before = car.displayed;
    const silence = (t - car.lastSampleT) / 1000;
    if (car.source === "pit") {
      car.displayed = car.target;
      car.rate = 0;
    } else if (silence > MOTION_SILENCE_S) {
      car.rate = 0;
      if (silence < MOTION_SILENCE_S + 4) moved = true;
    } else {
      let delta = car.rate * dt;
      const predicted = wrap01(car.displayed + delta);
      const aheadOfSample = signedTrackDelta(car.target, predicted);
      if (aheadOfSample > MOTION_MAX_LEAD) {
        delta = signedTrackDelta(car.displayed, wrap01(car.target + MOTION_MAX_LEAD));
        car.rate *= 0.5;
      } else {
        const toTarget = signedTrackDelta(predicted, car.target);
        if (toTarget > 0) delta += Math.min(toTarget, MOTION_BLEND * dt);
        else if (toTarget < -MOTION_BACK_ERR) delta += Math.max(toTarget, -MOTION_BLEND * dt);
      }
      const cap = Math.max(0.0005, MOTION_MAX_RATE * dt * 0.45, car.rate * dt * 1.6);
      if (delta > cap) delta = cap;
      else if (delta < -cap) delta = -cap;
      car.displayed = wrap01(car.displayed + delta);
    }
    const jump = Math.abs(signedTrackDelta(before, car.displayed));
    if (jump > 1e-6) {
      pushJump(shownJumps, jump);
      moved = true;
    }
  }
  return moved;
}

export function motionFade(n: number, nowT: number): number {
  const car = cars.get(n);
  if (!car) return 1;
  const silence = (nowT - car.lastSampleT) / 1000;
  if (silence <= MOTION_SILENCE_S) return 1;
  return Math.max(0.22, 1 - (silence - MOTION_SILENCE_S) / 3);
}

export function smoothedFrac(n: number, fallback: number): number {
  return cars.get(n)?.displayed ?? fallback;
}
