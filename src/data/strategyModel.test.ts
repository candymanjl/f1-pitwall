import { describe, expect, it } from "vitest";
import { strategyBrief } from "./strategy";
import { defaultTyreModel, writeTyreStore, type TyreModel } from "./tyres";
import type { Driver, SessionBundle, TimingSnapshot, TowerRow } from "./types";

function memoryStorage() {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
      clear: () => memory.clear(),
      key: (index: number) => [...memory.keys()][index] ?? null,
      get length() {
        return memory.size;
      },
    },
    configurable: true,
  });
}

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: "ffffff",
    first_name: code,
    last_name: code,
  };
}

function row(n: number, code: string, compound: string, age: number): TowerRow {
  return {
    pos: n,
    driver: driver(n, code),
    compound,
    tyreAge: age,
    lastLap: 80,
    bestLap: 79,
    interval: n === 1 ? 0 : 1.2,
    gap: n === 1 ? 0 : 2,
    status: "ON TRACK",
    currentLap: 20,
    s1: null,
    s2: null,
    s3: null,
    s1Kind: "none",
    s2Kind: "none",
    s3Kind: "none",
    segments: [],
    inPit: false,
    retired: false,
    pitOut: false,
    pits: 0,
    progress: 0.2,
    gridPos: n,
    posChange: 0,
  };
}

function fixture(rainfall = 0): { bundle: SessionBundle; snap: TimingSnapshot } {
  const session = {
    session_key: 9,
    meeting_key: 1,
    session_name: "Race",
    session_type: "Race",
    date_start: "2025-10-26T20:00:00.000Z",
    date_end: "2025-10-26T22:00:00.000Z",
    circuit_short_name: "Test",
    country_name: "Test",
    location: "Test",
    year: 2025,
  };
  const bundle = {
    meeting: {
      meeting_key: 1,
      meeting_name: "Test GP",
      circuit_short_name: "Test",
      country_name: "Test",
      location: "Test",
      date_start: session.date_start,
      year: 2025,
    },
    session,
    weekendSessions: [session],
    drivers: [driver(1, "VER")],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: rainfall
      ? [
          {
            date: "2025-10-26T20:30:00.000Z",
            category: "Flag",
            flag: null,
            scope: null,
            message: "CHANGE TO INTERMEDIATE TYRES",
            lap_number: 12,
            driver_number: null,
          },
        ]
      : [],
    track: [],
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3] as [number, number, number],
  } satisfies SessionBundle;
  const snap: TimingSnapshot = {
    now: Date.parse("2025-10-26T21:00:00.000Z"),
    rows: [row(1, "VER", "MEDIUM", 6), row(44, "HAM", "HARD", 10)],
    leaderLap: 20,
    medianGreenLap: 80,
    weather: {
      date: "2025-10-26T21:00:00.000Z",
      air_temperature: 22,
      track_temperature: 40,
      wind_speed: 2,
      wind_direction: 40,
      humidity: 40,
      rainfall,
    },
    bestSectors: { s1: null, s2: null, s3: null },
    flagMode: "green",
    scBands: [],
    raceLaps: 56,
  };
  return { bundle, snap };
}

describe("strategy uses the tyre model", () => {
  it("ranks 1/2/3-stop plans from saved compound curves and hides a one-compound dry plan", () => {
    memoryStorage();
    const model: TyreModel = defaultTyreModel();
    model.fuelPerLap = 0;
    model.compounds.MEDIUM = { offset: 0, degPerLap: 0.001, lifespan: 80, shape: "linear", cliffLap: 40, cliffDeg: 0 };
    model.compounds.HARD = { offset: 0.3, degPerLap: 0.001, lifespan: 80, shape: "linear", cliffLap: 40, cliffDeg: 0 };
    model.compounds.SOFT = { offset: 3, degPerLap: 0.2, lifespan: 10, shape: "linear", cliffLap: 8, cliffDeg: 0 };
    writeTyreStore({ model, fit: null });
    const { bundle, snap } = fixture(0);
    const brief = strategyBrief(bundle, snap, 1, 22);
    expect(brief.rule).toMatch(/two different dry compounds/i);
    expect(brief.plans.length).toBeGreaterThan(0);
    for (const plan of brief.plans) {
      expect(new Set(plan.stints.map((stint) => stint.compound)).size).toBeGreaterThanOrEqual(2);
    }
    expect(brief.windows.length).toBeGreaterThan(0);
    expect(brief.cuts.vsBehind?.verdict).toMatch(/DEFEND|LOW RISK/);
  });

  it("lifts the two-compound rule when the race is declared wet", () => {
    memoryStorage();
    writeTyreStore({ model: defaultTyreModel(), fit: null });
    const { bundle, snap } = fixture(1);
    const brief = strategyBrief(bundle, snap, 1, 22);
    expect(brief.rule).toMatch(/lifted/i);
  });

  it("still offers a pit-now plan and an alternative when every dry set is used", () => {
    memoryStorage();
    writeTyreStore({ model: defaultTyreModel(), fit: null });
    const { bundle, snap } = fixture(0);
    const stints = [];
    let n = 1;
    for (const [compound, count] of [
      ["SOFT", 8],
      ["MEDIUM", 3],
      ["HARD", 2],
    ] as const) {
      for (let i = 0; i < count; i++) {
        stints.push({
          driver_number: 1,
          stint_number: n++,
          lap_start: 1,
          lap_end: 2,
          compound,
          tyre_age_at_start: 0,
        });
      }
    }
    bundle.weekendStints = stints;
    const brief = strategyBrief(bundle, snap, 1, 22);
    expect(brief.plans.length).toBeGreaterThanOrEqual(2);
    expect(brief.plans.some((plan) => /pit now/i.test(plan.note))).toBe(true);
    expect(brief.plans.some((plan) => /alternative/i.test(plan.note))).toBe(true);
    expect(brief.plans.some((plan) => /assumed set/i.test(plan.note))).toBe(true);
    for (const plan of brief.plans) {
      expect(new Set(plan.stints.map((stint) => stint.compound)).size).toBeGreaterThanOrEqual(2);
    }
    expect(brief.windows).not.toMatch(/No pit window/i);
    expect(brief.windows.length).toBeGreaterThan(0);
  });
});
