import type { SessionBundle, TimingSnapshot } from "../data/types";
import {
  MOTION_BACK_ERR,
  MOTION_BLEND,
  MOTION_EMA,
  MOTION_SILENCE_S,
  placeOptsForSnap,
  signedTrackDelta,
} from "./carMotion";
import { placeCircleCars, wrap01, type PlacedCar } from "./pitcircle";

/** Max |d(gap seconds)/d(session seconds)|. */
export const GAP_MAX_RATE = 0.25;
/** Natural ring rate is 1/lapSec; never spin faster than a 25s lap. */
export const CLOCK_MAX_RATE = 0.04;

export type CircleMotionCar = {
  n: number;
  displayedGap: number;
  targetGap: number;
  rate: number;
  source: PlacedCar["source"];
  lastSampleT: number;
  pitFrac: number | null;
};

const cars = new Map<number, CircleMotionCar>();
let clock = { displayed: 0, target: 0, rate: 0, lastSampleT: Number.NaN };
let lapSec = 80;
let lastStepT = Number.NaN;

export function resetCircleMotion(): void {
  cars.clear();
  clock = { displayed: 0, target: 0, rate: 0, lastSampleT: Number.NaN };
  lastStepT = Number.NaN;
  lapSec = 80;
}

export function circleClock(): number {
  return clock.displayed;
}

export function displayedGap(n: number): number | null {
  return cars.get(n)?.displayedGap ?? null;
}

export function circleFrac(n: number, fallback: number): number {
  const car = cars.get(n);
  if (!car) return fallback;
  if (car.source === "pit" && car.pitFrac != null) return wrap01(car.pitFrac);
  return wrap01(clock.displayed - car.displayedGap / Math.max(1, lapSec));
}

export function circleFade(n: number, nowT: number): number {
  const car = cars.get(n);
  if (!car) return 1;
  const silence = (nowT - car.lastSampleT) / 1000;
  if (silence <= MOTION_SILENCE_S) return 1;
  return Math.max(0.22, 1 - (silence - MOTION_SILENCE_S) / 3);
}

function observeClock(progress: number, t: number, playing: boolean, lap: number): void {
  const target = wrap01(progress);
  lapSec = Math.max(1, lap);
  if (!Number.isFinite(clock.lastSampleT)) {
    clock = { displayed: target, target, rate: 1 / lapSec, lastSampleT: t };
    return;
  }
  const dt = (t - clock.lastSampleT) / 1000;
  const signed = signedTrackDelta(clock.target, target);
  if (!playing) {
    clock.displayed = target;
    clock.target = target;
    clock.rate = 0;
    clock.lastSampleT = t;
    return;
  }
  if (Math.abs(signed) < 1e-6) return;
  if (dt > 0 && dt < 8) {
    const inst = Math.min(CLOCK_MAX_RATE, Math.max(0, signed / dt));
    clock.rate = clock.rate <= 0 ? inst : clock.rate * (1 - MOTION_EMA) + inst * MOTION_EMA;
    clock.rate = Math.min(CLOCK_MAX_RATE, Math.max(0, clock.rate));
  } else if (dt > 8) {
    clock.displayed = target;
    clock.rate = 1 / lapSec;
  }
  clock.target = target;
  clock.lastSampleT = t;
}

function observeCar(n: number, hit: PlacedCar, t: number, playing: boolean): void {
  const gap = hit.source === "pit" ? 0 : (hit.gapSec ?? 0);
  const prev = cars.get(n);
  if (!prev) {
    cars.set(n, {
      n,
      displayedGap: gap,
      targetGap: gap,
      rate: 0,
      source: hit.source,
      lastSampleT: t,
      pitFrac: hit.source === "pit" ? wrap01(hit.frac) : null,
    });
    return;
  }
  prev.source = hit.source;
  prev.pitFrac = hit.source === "pit" ? wrap01(hit.frac) : null;
  if (hit.source === "pit" || !playing) {
    prev.displayedGap = gap;
    prev.targetGap = gap;
    prev.rate = 0;
    prev.lastSampleT = t;
    return;
  }
  const dg = gap - prev.targetGap;
  if (Math.abs(dg) < 1e-4) return;
  const dt = (t - prev.lastSampleT) / 1000;
  if (dt > 0 && dt < 8) {
    const inst = Math.min(GAP_MAX_RATE, Math.max(-GAP_MAX_RATE, dg / dt));
    prev.rate = prev.rate === 0 ? inst : prev.rate * (1 - MOTION_EMA) + inst * MOTION_EMA;
    prev.rate = Math.min(GAP_MAX_RATE, Math.max(-GAP_MAX_RATE, prev.rate));
  } else if (Math.abs(dg) > 8 || dt > 8) {
    prev.displayedGap = gap;
    prev.rate = 0;
  }
  prev.targetGap = gap;
  prev.lastSampleT = t;
}

export function syncCircleMotion(
  bundle: SessionBundle,
  snap: TimingSnapshot,
  t: number,
  playing: boolean,
): void {
  const opts = { ...placeOptsForSnap(bundle, snap), preferLocation: false };
  const placed = placeCircleCars(snap.rows, opts);
  observeClock(opts.leaderProgress, t, playing, opts.lapSec);
  const seen = new Set<number>();
  for (let i = 0; i < snap.rows.length; i++) {
    const hit = placed[i];
    if (!hit) continue;
    const n = snap.rows[i].driver.driver_number;
    seen.add(n);
    observeCar(n, hit, t, playing);
  }
  for (const n of [...cars.keys()]) {
    if (!seen.has(n)) cars.delete(n);
  }
}

function snapAll(): void {
  clock.displayed = clock.target;
  for (const car of cars.values()) car.displayedGap = car.targetGap;
}

export function stepCircleMotion(t: number, playing: boolean, scrubbing: boolean): boolean {
  if (scrubbing) {
    snapAll();
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
    snapAll();
    return true;
  }
  const natural = dt / Math.max(1, lapSec);
  let clockDelta = clock.rate > 0 ? clock.rate * dt : natural;
  const predicted = wrap01(clock.displayed + clockDelta);
  const toTarget = signedTrackDelta(predicted, clock.target);
  if (Math.abs(toTarget) > MOTION_BACK_ERR) clockDelta += toTarget;
  else clockDelta += Math.max(-MOTION_BLEND * dt, Math.min(MOTION_BLEND * dt, toTarget));
  const clockCap = Math.max(natural * 1.6, CLOCK_MAX_RATE * dt);
  if (clockDelta > clockCap) clockDelta = clockCap;
  else if (clockDelta < -clockCap) clockDelta = -clockCap;
  clock.displayed = wrap01(clock.displayed + clockDelta);

  let moved = Math.abs(clockDelta) > 1e-6;
  for (const car of cars.values()) {
    if (car.source === "pit") continue;
    const silence = (t - car.lastSampleT) / 1000;
    if (silence > MOTION_SILENCE_S) {
      car.rate = 0;
      if (silence < MOTION_SILENCE_S + 4) moved = true;
      continue;
    }
    let delta = car.rate * dt;
    const err = car.targetGap - (car.displayedGap + delta);
    if (Math.abs(err) > 8) delta = car.targetGap - car.displayedGap;
    else delta += Math.max(-MOTION_BLEND * dt * lapSec, Math.min(MOTION_BLEND * dt * lapSec, err));
    const cap = Math.max(0.004, GAP_MAX_RATE * dt, Math.abs(car.rate) * dt * 1.6);
    if (delta > cap) delta = cap;
    else if (delta < -cap) delta = -cap;
    if (Math.abs(delta) > 1e-6) {
      car.displayedGap += delta;
      if (car.displayedGap < 0) car.displayedGap = 0;
      moved = true;
    }
  }
  return moved;
}
