import { afterEach, describe, expect, it } from "vitest";
import { resetCarMotion } from "./carMotion";
import {
  circleClock,
  circleFrac,
  displayedGap,
  resetCircleMotion,
  stepCircleMotion,
  syncCircleMotion,
} from "./circleMotion";
import { gapFrac, wrap01 } from "./pitcircle";
import type { Driver, SessionBundle, TimingSnapshot, TowerRow } from "../data/types";

afterEach(() => {
  resetCircleMotion();
  resetCarMotion();
});

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: "3671C6",
    first_name: code,
    last_name: code,
  };
}

function row(d: Driver, pos: number, progress: number, extra: Partial<TowerRow> = {}): TowerRow {
  return {
    pos,
    driver: d,
    compound: "MEDIUM",
    tyreAge: 4,
    lastLap: 80,
    lastLapDelta: null,
    bestLap: 79,
    interval: pos === 1 ? 0 : 10,
    gap: pos === 1 ? 0 : (pos - 1) * 10,
    status: "ON TRACK",
    currentLap: 20,
    lapActive: true,
    s1: 22,
    s2: 29,
    s3: 26,
    s1Kind: "none",
    s2Kind: "none",
    s3Kind: "none",
    segments: [],
    inPit: false,
    retired: false,
    pitOut: false,
    pits: 0,
    progress,
    gridPos: null,
    posChange: null,
    ...extra,
  };
}

function bundle(): SessionBundle {
  const lec = driver(16, "LEC");
  const ver = driver(1, "VER");
  return {
    meeting: {
      meeting_key: 1272,
      meeting_name: "Mexico City Grand Prix",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      date_start: "",
      year: 2025,
    },
    session: {
      session_key: 9877,
      meeting_key: 1272,
      session_name: "Race",
      session_type: "Race",
      date_start: "",
      date_end: "",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      year: 2025,
    },
    weekendSessions: [],
    drivers: [lec, ver],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track: [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [0, 0],
    ],
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3],
    locations: [
      { date: new Date(10_000).toISOString(), driver_number: 16, x: 10, y: 0 },
      { date: new Date(10_000).toISOString(), driver_number: 1, x: 90, y: 70 },
      { date: new Date(12_000).toISOString(), driver_number: 16, x: 90, y: 0 },
      { date: new Date(12_000).toISOString(), driver_number: 1, x: 10, y: 80 },
    ],
  };
}

function snap(t: number, leaderProg: number): TimingSnapshot {
  const lec = driver(16, "LEC");
  const ver = driver(1, "VER");
  return {
    now: t,
    rows: [row(lec, 1, leaderProg), row(ver, 2, wrap01(leaderProg - 0.4))],
    leaderLap: 20,
    medianGreenLap: 80,
    weather: null,
    bestSectors: { s1: null, s2: null, s3: null },
    flagMode: "green",
    scBands: [],
    raceLaps: 71,
  } as TimingSnapshot;
}

function spacing(): number {
  const a = circleFrac(16, 0);
  const b = circleFrac(1, 0);
  return wrap01(a - b);
}

describe("circle time-gap motion", () => {
  it("places cars from gap seconds, not GPS", () => {
    const t0 = 10_000;
    const b = bundle();
    syncCircleMotion(b, snap(t0, 0.4), t0, false);
    expect(circleFrac(16, -1)).toBeCloseTo(gapFrac(0.4, 0, 80), 4);
    expect(circleFrac(1, -1)).toBeCloseTo(gapFrac(0.4, 10, 80), 4);
    expect(displayedGap(1)).toBeCloseTo(10, 4);
  });

  it("keeps spacing constant while the ring turns and GPS jumps around corners", () => {
    const t0 = 10_000;
    const b = bundle();
    syncCircleMotion(b, snap(t0, 0.2), t0, true);
    stepCircleMotion(t0, true, false);
    const first = spacing();
    expect(first).toBeCloseTo(10 / 80, 3);
    const seen: number[] = [first];
    for (let i = 1; i <= 40; i++) {
      const t = t0 + i * 50;
      const prog = 0.2 + (i * 50) / 80_000;
      syncCircleMotion(b, snap(t, prog), t, true);
      stepCircleMotion(t, true, false);
      seen.push(spacing());
    }
    const min = Math.min(...seen);
    const max = Math.max(...seen);
    expect(max - min).toBeLessThan(0.004);
    expect(circleClock()).toBeGreaterThan(0.2);
    expect(circleFrac(16, 0)).not.toBeCloseTo(0.2, 2);
  });

  it("holds still while paused and snaps on seek", () => {
    const t0 = 20_000;
    const b = bundle();
    syncCircleMotion(b, snap(t0, 0.5), t0, false);
    const frozen = circleFrac(16, 0);
    const d = spacing();
    stepCircleMotion(t0 + 400, false, false);
    expect(circleFrac(16, 0)).toBeCloseTo(frozen, 5);
    syncCircleMotion(b, snap(t0 + 400, 0.55), t0 + 400, false);
    expect(circleFrac(16, 0)).toBeCloseTo(gapFrac(0.55, 0, 80), 4);
    stepCircleMotion(t0 + 800, false, false);
    expect(circleFrac(16, 0)).toBeCloseTo(gapFrac(0.55, 0, 80), 4);
    expect(spacing()).toBeCloseTo(d, 4);
  });

  it("blends a gap jump instead of snapping the following car", () => {
    const t0 = 30_000;
    const b = bundle();
    const lec = driver(16, "LEC");
    const ver = driver(1, "VER");
    const at = (t: number, gap: number, prog: number): TimingSnapshot =>
      ({
        now: t,
        rows: [row(lec, 1, prog), row(ver, 2, prog, { gap, interval: gap })],
        leaderLap: 20,
        medianGreenLap: 80,
        weather: null,
        bestSectors: { s1: null, s2: null, s3: null },
        flagMode: "green",
        scBands: [],
        raceLaps: 71,
      }) as TimingSnapshot;
    syncCircleMotion(b, at(t0, 4, 0.3), t0, true);
    stepCircleMotion(t0, true, false);
    syncCircleMotion(b, at(t0 + 250, 7, 0.303), t0 + 250, true);
    stepCircleMotion(t0 + 250, true, false);
    const mid = displayedGap(1) ?? 0;
    expect(mid).toBeGreaterThan(4);
    expect(mid).toBeLessThan(7);
    for (let i = 1; i <= 20; i++) stepCircleMotion(t0 + 250 + i * 16, true, false);
    expect(displayedGap(1)).toBeGreaterThan(mid);
  });
});
