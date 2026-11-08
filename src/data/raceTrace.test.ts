import { afterEach, describe, expect, it } from "vitest";
import type { Driver, Lap, Pit, Position } from "./types";
import {
  fieldSize,
  gapSeries,
  playheadLap,
  positionAtLapEnd,
  positionSeries,
  readRaceTraceYAxis,
  RACE_TRACE_Y_KEY,
  writeRaceTraceYAxis,
} from "./raceTrace";

const START = Date.parse("2025-10-26T20:00:00.000Z");

function driver(n: number, code: string, colour = "e10600"): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: colour,
    first_name: code,
    last_name: code,
  };
}

function lap(dn: number, n: number, startOff: number, dur = 80, pitOut = false): Lap {
  return {
    driver_number: dn,
    lap_number: n,
    date_start: new Date(START + startOff).toISOString(),
    lap_duration: dur,
    duration_sector_1: 22,
    duration_sector_2: 29,
    duration_sector_3: 29,
    is_pit_out_lap: pitOut,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
  };
}

describe("raceTrace Y-axis persistence", () => {
  afterEach(() => {
    try {
      localStorage.removeItem(RACE_TRACE_Y_KEY);
    } catch {
      /* ignore */
    }
  });

  it("defaults to gap and round-trips position", () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
        removeItem: (k: string) => void memory.delete(k),
      },
      configurable: true,
    });
    expect(readRaceTraceYAxis()).toBe("gap");
    writeRaceTraceYAxis("position");
    expect(readRaceTraceYAxis()).toBe("position");
    expect(memory.get(RACE_TRACE_Y_KEY)).toBe("position");
  });
});

describe("position series", () => {
  const drivers = [driver(1, "VER", "3671C6"), driver(44, "HAM", "E8002D"), driver(4, "NOR", "FF8000")];
  const laps = [
    lap(1, 1, 0, 80),
    lap(44, 1, 200, 80),
    lap(4, 1, 400, 80),
    lap(1, 2, 80_000, 81),
    lap(44, 2, 80_400, 79),
    lap(4, 2, 80_800, 80),
    lap(1, 3, 161_000, 80),
    lap(44, 3, 161_200, 80),
    lap(4, 3, 161_600, 80),
    lap(1, 4, 241_000, 80),
    lap(44, 4, 241_400, 80),
  ];
  const positions: Position[] = [
    { date: new Date(START + 80_000).toISOString(), driver_number: 1, position: 1 },
    { date: new Date(START + 80_200).toISOString(), driver_number: 44, position: 2 },
    { date: new Date(START + 80_400).toISOString(), driver_number: 4, position: 3 },
    { date: new Date(START + 159_400).toISOString(), driver_number: 44, position: 1 },
    { date: new Date(START + 161_000).toISOString(), driver_number: 1, position: 2 },
    { date: new Date(START + 161_600).toISOString(), driver_number: 4, position: 3 },
  ];
  const pits: Pit[] = [{ date: new Date(START + 160_000).toISOString(), driver_number: 1, lap_number: 2, lane_duration: 22, pit_duration: 22, stop_duration: 2.4 }];

  it("uses OpenF1 position at the end of each lap", () => {
    const now = START + 242_000;
    const series = positionSeries({ drivers, laps, pits, positions, hidden: [], now });
    const ver = series.find((s) => s.driver === 1)!;
    const ham = series.find((s) => s.driver === 44)!;
    expect(ver.pts.find((p) => p.lap === 1)?.y).toBe(1);
    expect(ham.pts.find((p) => p.lap === 2)?.y).toBe(1);
    expect(ver.pts.find((p) => p.lap === 2)?.y).toBe(2);
    expect(ver.pts.find((p) => p.lap === 2)?.pit).toBe(true);
  });

  it("ends a retirement instead of carrying the last place forward", () => {
    const now = START + 400_000;
    const series = positionSeries({ drivers, laps, pits, positions, hidden: [], now });
    const nor = series.find((s) => s.driver === 4)!;
    expect(nor.pts.map((p) => p.lap)).toEqual([1, 2, 3]);
    expect(nor.pts.at(-1)?.lap).toBe(3);
  });

  it("never plots laps that finish after the playhead", () => {
    const now = START + 80_000; // VER just completed lap 1
    expect(playheadLap(laps, now)).toBe(1);
    const series = positionSeries({ drivers, laps, pits, positions, hidden: [], now });
    expect(series.flatMap((s) => s.pts.map((p) => p.lap)).every((n) => n <= 1)).toBe(true);
    const gap = gapSeries({ drivers, laps, pits, hidden: [], mode: "leader", refDriver: 1, now });
    expect(gap.flatMap((s) => s.pts.map((p) => p.lap)).every((n) => n <= 1)).toBe(true);
  });

  it("falls back to lap-completion order when OpenF1 position is missing", () => {
    const finishers = [
      { driver: 1, endMs: START + 80_000 },
      { driver: 44, endMs: START + 80_400 },
    ];
    expect(positionAtLapEnd([], finishers, 1, START + 80_000)).toBe(1);
    expect(positionAtLapEnd([], finishers, 44, START + 80_400)).toBe(2);
    const series = positionSeries({
      drivers,
      laps: laps.filter((l) => l.lap_number === 1),
      pits: [],
      positions: [],
      hidden: [],
      now: START + 90_000,
    });
    expect(series.find((s) => s.driver === 1)?.pts[0].y).toBe(1);
    expect(series.find((s) => s.driver === 44)?.pts[0].y).toBe(2);
    expect(fieldSize(series, 3)).toBe(3);
  });
});
