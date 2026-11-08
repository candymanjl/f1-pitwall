/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { pointAt } from "../data/track";
import { resetOutlinePromoteForTests } from "../data/outlineFallback";
import type { Driver, Lap, SessionBundle } from "../data/types";
import { displayedFrac, motionFade, resetCarMotion, setMotionLiveDelay, signedTrackDelta } from "./carMotion";
import { circleFrac, resetCircleMotion } from "./circleMotion";
import { wrap01 } from "./pitcircle";
import { advancePlayback, ingestLive, setClock, state } from "../state";
import type { LiveDelayMs } from "../config";

const LAP_MS = 80_000;
const SAMPLE_MS = 1000 / 3.7;
const GAP_SEC = 2.4;
const FRAME_MS = 16;
const TOTAL_MS = 28_000;
const PRELOAD_MS = 4_000;
const MEASURE_AFTER_MS = 9_000;

/** Long enough that the live outline promoter leaves this racing line alone. */
const TRACK: [number, number][] = [
  [0, 0],
  [160, 0],
  [320, 0],
  [480, 0],
  [480, 120],
  [480, 240],
  [480, 360],
  [320, 360],
  [160, 360],
  [0, 360],
  [0, 240],
  [0, 120],
  [0, 0],
];

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: n === 1 ? "Red Bull" : "Ferrari",
    team_colour: n === 1 ? "3671C6" : "E8002D",
    first_name: code,
    last_name: code,
  };
}

function lap(n: number, lapNumber: number, start: number, duration: number | null): Lap {
  return {
    driver_number: n,
    lap_number: lapNumber,
    date_start: new Date(start).toISOString(),
    lap_duration: duration,
    duration_sector_1: 22,
    duration_sector_2: duration == null ? null : 29,
    duration_sector_3: duration == null ? null : 29,
    is_pit_out_lap: false,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
  };
}

function bundle(epoch: number): SessionBundle {
  const start = new Date(epoch - 120_000).toISOString();
  return {
    meeting: {
      meeting_key: 1272,
      meeting_name: "Mexico City Grand Prix",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      date_start: start,
      year: 2025,
    },
    session: {
      session_key: 9877,
      meeting_key: 1272,
      session_name: "Race",
      session_type: "Race",
      date_start: start,
      date_end: new Date(epoch + 2 * 60 * 60 * 1000).toISOString(),
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      year: 2025,
    },
    weekendSessions: [],
    drivers: [driver(1, "VER"), driver(44, "HAM")],
    laps: [
      lap(1, 10, epoch - LAP_MS, 80),
      lap(44, 10, epoch - LAP_MS, 80),
      lap(1, 11, epoch, null),
      lap(44, 11, epoch, null),
    ],
    intervals: [
      { date: new Date(epoch).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 },
      { date: new Date(epoch).toISOString(), driver_number: 44, gap_to_leader: GAP_SEC, interval: GAP_SEC },
    ],
    positions: [
      { date: new Date(epoch).toISOString(), driver_number: 1, position: 1 },
      { date: new Date(epoch).toISOString(), driver_number: 44, position: 2 },
    ],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track: TRACK,
    corners: [],
    sectorFracs: [0.33, 0.33, 0.34],
    locations: [],
  };
}

type Fix = { t: number; driver: number; x: number; y: number };

function buildFixes(epoch: number, nextRand: () => number): Fix[] {
  const fixes: Fix[] = [];
  for (let t = epoch; t <= epoch + TOTAL_MS + 1_000; t += SAMPLE_MS) {
    const ts = t + (nextRand() - 0.5) * 36;
    for (const [n, lead] of [
      [1, 0],
      [44, GAP_SEC],
    ] as const) {
      const frac = wrap01((ts - epoch) / LAP_MS - lead / (LAP_MS / 1000));
      const [x, y] = pointAt(TRACK, frac);
      fixes.push({ t: ts, driver: n, x, y });
    }
  }
  fixes.sort((a, b) => a.t - b.t || a.driver - b.driver);
  return fixes;
}

type RunStats = {
  frames: number;
  mean: number;
  max: number;
  stalls: number;
  stallPct: number;
  clockMean: number;
  clockMax: number;
  spacingSpread: number;
  fadeMin: number;
};

function runFeed(delay: LiveDelayMs): RunStats {
  resetCarMotion();
  resetCircleMotion();
  resetOutlinePromoteForTests();
  const epoch = Date.now() - 20_000;
  const nextRand = rand(20251026);
  const fixes = buildFixes(epoch, nextRand);
  let cursor = 0;
  state.mode = "live";
  state.liveDelayMs = delay;
  state.bundle = bundle(epoch);
  state.snap = null;
  state.sessionKey = 9877;
  state.start = epoch - 120_000;
  state.end = epoch;
  state.t = epoch;
  state.latestMs = epoch;
  state.latestLocationMs = Number.NaN;
  state.lastIngestAt = 0;
  state.followLive = false;
  state.playing = false;
  state.scrubbing = false;
  state.speed = 1;
  setMotionLiveDelay(delay);

  const deliver = (until: number) => {
    const batch = [];
    while (cursor < fixes.length && fixes[cursor].t <= until) {
      const fix = fixes[cursor];
      cursor += 1;
      batch.push({
        date: new Date(fix.t).toISOString(),
        driver_number: fix.driver,
        x: fix.x,
        y: fix.y,
        session_key: 9877,
        t: fix.t,
      });
    }
    if (batch.length) ingestLive("v1/location", batch);
  };

  deliver(epoch + PRELOAD_MS);
  state.playing = true;
  state.followLive = true;
  const anchor = Number.isFinite(state.latestLocationMs) ? state.latestLocationMs : state.end;
  state.t = delay > 0 ? Math.max(state.start, anchor - delay) : state.end;

  for (let i = 0; i < 4; i++) advancePlayback(FRAME_MS);

  let wall = epoch + PRELOAD_MS;
  let nextBurst = wall + 1_000 + Math.floor(nextRand() * 2_000);
  let prevFrac = displayedFrac(1);
  let prevT = state.t;
  const jumps: number[] = [];
  const clockSteps: number[] = [];
  const spacings: number[] = [];
  let fadeMin = 1;

  while (wall < epoch + TOTAL_MS) {
    wall += FRAME_MS;
    if (wall >= nextBurst) {
      deliver(wall);
      // Bursts are 1–3s apart, so the app's 125ms live snap has always fired.
      // The sim itself finishes in a few milliseconds, so flush that snap here.
      if (delay === 0) setClock(state.t, "code");
      nextBurst = wall + 1_000 + Math.floor(nextRand() * 2_000);
    }
    advancePlayback(FRAME_MS);
    const measure = wall >= epoch + MEASURE_AFTER_MS;
    const frac = displayedFrac(1);
    if (measure && prevFrac != null && frac != null) jumps.push(Math.abs(signedTrackDelta(prevFrac, frac)));
    if (measure) clockSteps.push(Math.abs(state.t - prevT));
    prevFrac = frac;
    prevT = state.t;
    if (measure) {
      fadeMin = Math.min(fadeMin, motionFade(1, state.t), motionFade(44, state.t));
      const gap = wrap01(circleFrac(1, 0) - circleFrac(44, 0));
      if (gap > 0 && gap < 0.5) spacings.push(gap);
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const stalls = jumps.filter((j) => j < 1e-6).length;
  return {
    frames: jumps.length,
    mean: mean(jumps),
    max: jumps.reduce((a, b) => Math.max(a, b), 0),
    stalls,
    stallPct: jumps.length ? (100 * stalls) / jumps.length : 0,
    clockMean: mean(clockSteps),
    clockMax: clockSteps.reduce((a, b) => Math.max(a, b), 0),
    spacingSpread: spacings.length ? Math.max(...spacings) - Math.min(...spacings) : 1,
    fadeMin,
  };
}

afterEach(() => {
  resetCarMotion();
  resetCircleMotion();
  setMotionLiveDelay(0);
  state.bundle = null;
  state.snap = null;
  state.playing = false;
  state.followLive = false;
  state.scrubbing = false;
  state.mode = "historical";
  state.liveDelayMs = 3000;
  state.latestMs = Number.NaN;
  state.latestLocationMs = Number.NaN;
  state.lastIngestAt = 0;
});

describe("live delay buffer on a Mexico-style GPS feed", () => {
  it("glides at 3 s and keeps pit-circle spacing while Off stalls and jumps", () => {
    const delayed = runFeed(3000);
    const off = runFeed(0);
    const report = { delay3s: delayed, off };
    console.info("LIVE_DELAY_METRICS", JSON.stringify(report));
    expect(delayed.frames).toBeGreaterThan(500);
    expect(delayed.stalls).toBe(0);
    expect(delayed.max).toBeLessThan(0.002);
    expect(delayed.mean).toBeGreaterThan(0.00005);
    expect(delayed.mean).toBeLessThan(0.0006);
    expect(delayed.clockMax).toBeLessThan(40);
    expect(delayed.fadeMin).toBe(1);
    expect(delayed.spacingSpread).toBeLessThan(0.004);
    expect(off.max).toBeGreaterThan(delayed.max * 5);
    expect(off.stallPct).toBeGreaterThan(20);
    expect(off.clockMax).toBeGreaterThan(800);
  }, 20_000);
});
