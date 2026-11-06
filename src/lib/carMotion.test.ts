import { afterEach, describe, expect, it } from "vitest";
import {
  MOTION_MAX_LEAD,
  displayedFrac,
  forwardDelta,
  motionJumpSummary,
  resetCarMotion,
  signedTrackDelta,
  stepCarMotion,
  syncCarMotion,
} from "./carMotion";
import type { Driver, SessionBundle, TimingSnapshot, TowerRow } from "../data/types";

afterEach(() => {
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

function row(d: Driver, progress: number, extra: Partial<TowerRow> = {}): TowerRow {
  return {
    pos: 1,
    driver: d,
    compound: "MEDIUM",
    tyreAge: 4,
    lastLap: 80,
    lastLapDelta: null,
    bestLap: 79,
    interval: null,
    gap: 0,
    status: "ON TRACK",
    currentLap: 4,
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

const track: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 80],
  [0, 80],
  [0, 0],
];

function bundle(): SessionBundle {
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: "Test",
      circuit_short_name: "TST",
      country_name: "X",
      location: "X",
      date_start: "",
      year: 2026,
    },
    session: {
      session_key: 99,
      meeting_key: 1,
      session_name: "Practice 1",
      session_type: "Practice",
      date_start: "",
      date_end: "",
      circuit_short_name: "TST",
      country_name: "X",
      location: "X",
      year: 2026,
    },
    weekendSessions: [],
    drivers: [driver(12, "ANT")],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track,
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3],
  };
}

function snap(t: number, progress: number): TimingSnapshot {
  const d = driver(12, "ANT");
  return {
    now: t,
    rows: [row(d, progress)],
    leaderLap: 4,
    medianGreenLap: 80,
    weather: null,
    bestSectors: { s1: null, s2: null, s3: null },
    flagMode: "green",
    scBands: [],
    raceLaps: 4,
  } as TimingSnapshot;
}

describe("track deltas", () => {
  it("treats S/F wrap as forward, not reverse", () => {
    expect(forwardDelta(0.98, 0.02)).toBeCloseTo(0.04, 5);
    expect(signedTrackDelta(0.98, 0.02)).toBeCloseTo(0.04, 5);
    expect(signedTrackDelta(0.02, 0.98)).toBeCloseTo(-0.04, 5);
  });
});

describe("car motion", () => {
  it("snaps while paused and holds still between steps", () => {
    const t0 = 1_000;
    syncCarMotion(bundle(), snap(t0, 0.2), t0, false);
    expect(displayedFrac(12)).toBeCloseTo(0.2, 5);
    stepCarMotion(t0 + 500, false, false);
    expect(displayedFrac(12)).toBeCloseTo(0.2, 5);
  });

  it("glides forward instead of snapping to each sample", () => {
    const t0 = 10_000;
    const b = bundle();
    syncCarMotion(b, snap(t0, 0.1), t0, true);
    stepCarMotion(t0, true, false);
    for (let i = 1; i <= 48; i++) {
      const t = t0 + i * 16;
      if (i % 16 === 0) {
        syncCarMotion(b, snap(t, 0.1 + (i / 16) * 0.02), t, true);
      }
      stepCarMotion(t, true, false);
    }
    const stats = motionJumpSummary();
    expect(stats.rawMax).toBeGreaterThan(0.015);
    expect(stats.shownMax).toBeLessThan(0.006);
    expect(stats.shownMax).toBeLessThan(stats.rawMax * 0.4);
    expect(displayedFrac(12)).toBeGreaterThan(0.12);
    expect(displayedFrac(12)).toBeLessThan(0.18);
  });

  it("glides at 4x session dt instead of eating a whole GPS jump", () => {
    const t0 = 70_000;
    const b = bundle();
    syncCarMotion(b, snap(t0, 0.1), t0, true);
    stepCarMotion(t0, true, false);
    for (let i = 1; i <= 24; i++) {
      const t = t0 + i * 64;
      if (i % 4 === 0) syncCarMotion(b, snap(t, 0.1 + (i / 4) * 0.0125), t, true);
      else syncCarMotion(b, snap(t, 0.1 + (Math.floor(i / 4) * 0.0125)), t, true);
      stepCarMotion(t, true, false);
    }
    const stats = motionJumpSummary();
    expect(stats.rawMax).toBeGreaterThan(0.01);
    expect(stats.shownMax).toBeLessThan(stats.rawMax * 0.55);
    expect(stats.shownMax).toBeLessThan(0.008);
  });

  it("keeps predicting when the same sample is re-observed every frame", () => {
    const t0 = 60_000;
    const b = bundle();
    syncCarMotion(b, snap(t0, 0.2), t0, true);
    stepCarMotion(t0, true, false);
    syncCarMotion(b, snap(t0 + 250, 0.23), t0 + 250, true);
    stepCarMotion(t0 + 250, true, false);
    for (let i = 1; i <= 20; i++) {
      const t = t0 + 250 + i * 16;
      syncCarMotion(b, snap(t, 0.23), t, true);
      stepCarMotion(t, true, false);
    }
    expect(displayedFrac(12)).toBeGreaterThan(0.232);
  });

  it("does not run backwards for a small late sample", () => {
    const t0 = 20_000;
    const b = bundle();
    syncCarMotion(b, snap(t0, 0.5), t0, true);
    stepCarMotion(t0, true, false);
    syncCarMotion(b, snap(t0 + 250, 0.53), t0 + 250, true);
    stepCarMotion(t0 + 250, true, false);
    const ahead = displayedFrac(12) ?? 0;
    syncCarMotion(b, snap(t0 + 400, 0.525), t0 + 400, true);
    stepCarMotion(t0 + 400, true, false);
    const later = displayedFrac(12) ?? 0;
    expect(signedTrackDelta(ahead, later)).toBeGreaterThanOrEqual(-1e-4);
  });

  it("wraps S/F forward", () => {
    const t0 = 30_000;
    const b = bundle();
    syncCarMotion(b, snap(t0, 0.97), t0, true);
    stepCarMotion(t0, true, false);
    syncCarMotion(b, snap(t0 + 400, 0.02), t0 + 400, true);
    for (let i = 1; i <= 10; i++) stepCarMotion(t0 + 400 + i * 16, true, false);
    const frac = displayedFrac(12) ?? 0;
    expect(signedTrackDelta(0.97, frac)).toBeGreaterThanOrEqual(-1e-4);
  });

  it("stops predicting after silence and snaps on scrub", () => {
    const t0 = 40_000;
    const b = bundle();
    syncCarMotion(b, snap(t0, 0.3), t0, true);
    stepCarMotion(t0, true, false);
    syncCarMotion(b, snap(t0 + 200, 0.33), t0 + 200, true);
    stepCarMotion(t0 + 200, true, false);
    const mid = displayedFrac(12) ?? 0;
    let t = t0 + 200;
    for (let i = 0; i < 20; i++) {
      t += 200;
      stepCarMotion(t, true, false);
    }
    const frozen = displayedFrac(12) ?? 0;
    expect(Math.abs(frozen - mid)).toBeLessThan(MOTION_MAX_LEAD + 0.02);
    stepCarMotion(t + 50, true, false);
    expect(displayedFrac(12)).toBeCloseTo(frozen, 5);
    stepCarMotion(t + 80_000, true, true);
    expect(displayedFrac(12)).toBeCloseTo(0.33, 5);
  });

  it("drops garage cars", () => {
    const t0 = 50_000;
    const d = driver(12, "ANT");
    const b = bundle();
    const parked = {
      ...snap(t0, 0.4),
      rows: [row(d, 0.4, { inGarage: true, status: "GARAGE", lapActive: false })],
    } as TimingSnapshot;
    syncCarMotion(b, snap(t0, 0.4), t0, true);
    expect(displayedFrac(12)).not.toBeNull();
    syncCarMotion(b, parked, t0 + 100, true);
    expect(displayedFrac(12)).toBeNull();
  });
});
