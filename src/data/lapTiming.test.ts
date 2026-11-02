import { describe, expect, it } from "vitest";
import {
  barHeightFrac,
  buildLapTimingModel,
  clampLapTimingDrivers,
  LAP_CLIP_S,
  LAP_TIMING_MAX,
  stripedTeammates,
  toggleLapTimingId,
} from "./lapTiming";
import type { Driver, Lap, SessionBundle, TimingSnapshot } from "./types";

function driver(n: number, code: string, team: string, colour: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: team,
    team_colour: colour,
    first_name: code,
    last_name: code,
  };
}

function lap(partial: Partial<Lap> & { driver_number: number; lap_number: number }): Lap {
  return {
    date_start: "2026-11-01T20:00:00.000Z",
    lap_duration: 80,
    duration_sector_1: 22,
    duration_sector_2: 30,
    duration_sector_3: 28,
    is_pit_out_lap: false,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: 280,
    i2_speed: 300,
    st_speed: 330,
    ...partial,
  };
}

function bundle(partial: Partial<SessionBundle> = {}): SessionBundle {
  const nor = driver(4, "NOR", "McLaren", "FF8000");
  const pia = driver(81, "PIA", "McLaren", "FF8000");
  const lec = driver(16, "LEC", "Ferrari", "E8002D");
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: "Mexico City Grand Prix",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      date_start: "2026-11-01T20:00:00.000Z",
      year: 2026,
    },
    session: {
      session_key: 99,
      meeting_key: 1,
      session_name: "Race",
      session_type: "Race",
      date_start: "2026-11-01T20:00:00.000Z",
      date_end: "2026-11-01T22:00:00.000Z",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      year: 2026,
    },
    weekendSessions: [],
    drivers: [nor, pia, lec],
    laps: [],
    intervals: [],
    positions: [],
    stints: [
      { driver_number: 4, stint_number: 1, lap_start: 1, lap_end: 25, compound: "MEDIUM", tyre_age_at_start: 0 },
      { driver_number: 81, stint_number: 1, lap_start: 1, lap_end: 22, compound: "MEDIUM", tyre_age_at_start: 0 },
      { driver_number: 16, stint_number: 1, lap_start: 1, lap_end: 29, compound: "HARD", tyre_age_at_start: 0 },
    ],
    weekendStints: [],
    pits: [{ date: "2026-11-01T20:30:00.000Z", driver_number: 4, lap_number: 25, lane_duration: 22, pit_duration: 22, stop_duration: 2.4 }],
    weather: [],
    raceControl: [
      {
        date: "2026-11-01T20:40:00.000Z",
        category: "SafetyCar",
        flag: null,
        scope: null,
        message: "SAFETY CAR DEPLOYED",
        lap_number: 33,
        driver_number: null,
      },
      {
        date: "2026-11-01T20:48:00.000Z",
        category: "Flag",
        flag: "GREEN",
        scope: "Track",
        message: "GREEN FLAG",
        lap_number: 36,
        driver_number: null,
      },
    ],
    track: [],
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3],
    ...partial,
  };
}

describe("lap timing selection", () => {
  it("caps at 4 drivers and stripes the second teammate", () => {
    expect(clampLapTimingDrivers([4, 81, 16, 1, 44])).toEqual([4, 81, 16, 1]);
    expect(toggleLapTimingId([4, 81, 16, 1], 44)).toEqual([4, 81, 16, 1]);
    expect(toggleLapTimingId([4, 81], 81)).toEqual([4]);
    const striped = stripedTeammates([
      driver(4, "NOR", "McLaren", "FF8000"),
      driver(16, "LEC", "Ferrari", "E8002D"),
      driver(81, "PIA", "McLaren", "FF8000"),
    ]);
    expect([...striped]).toEqual([81]);
    expect(LAP_TIMING_MAX).toBe(4);
  });
});

describe("buildLapTimingModel", () => {
  it("colors best among selected purple and personal best green", () => {
    const start = Date.parse("2026-11-01T20:00:00.000Z");
    const t = (lapNo: number) => new Date(start + lapNo * 80_000).toISOString();
    const b = bundle({
      laps: [
        lap({ driver_number: 4, lap_number: 1, date_start: t(1), lap_duration: 80.1, duration_sector_1: 22.1, duration_sector_2: 30.0, duration_sector_3: 28.0 }),
        lap({ driver_number: 4, lap_number: 2, date_start: t(2), lap_duration: 79.2, duration_sector_1: 21.8, duration_sector_2: 29.5, duration_sector_3: 27.9 }),
        lap({ driver_number: 16, lap_number: 1, date_start: t(1), lap_duration: 80.4, duration_sector_1: 22.4, duration_sector_2: 30.1, duration_sector_3: 27.9 }),
        lap({ driver_number: 16, lap_number: 2, date_start: t(2), lap_duration: 79.5, duration_sector_1: 22.0, duration_sector_2: 29.6, duration_sector_3: 27.9 }),
      ],
    });
    const model = buildLapTimingModel({
      bundle: b,
      snap: { rows: b.drivers.map((d, i) => ({ pos: i + 1, driver: d, gap: i ? i : 0 })) } as unknown as TimingSnapshot,
      selected: [4, 16],
      now: start + 400_000,
      live: false,
    });
    const nor2 = model.cells.get(4)?.get(2);
    const lec2 = model.cells.get(16)?.get(2);
    expect(nor2?.timeKind).toBe("overall");
    expect(lec2?.timeKind).toBe("personal");
    expect(model.selected[0].bestIsOverall).toBe(true);
    expect(model.selected[1].striped).toBe(false);
  });

  it("excludes SC and pit laps from the clean average and clips bars at +4s", () => {
    const start = Date.parse("2026-11-01T20:00:00.000Z");
    const t = (ms: number) => new Date(start + ms).toISOString();
    const b = bundle({
      laps: [
        lap({ driver_number: 4, lap_number: 1, date_start: t(0), lap_duration: 80, is_pit_out_lap: true }),
        lap({ driver_number: 4, lap_number: 2, date_start: t(80_000), lap_duration: 79.5 }),
        lap({ driver_number: 4, lap_number: 3, date_start: t(160_000), lap_duration: 79.7 }),
        lap({
          driver_number: 4,
          lap_number: 33,
          date_start: "2026-11-01T20:41:00.000Z",
          lap_duration: 110,
        }),
      ],
    });
    const model = buildLapTimingModel({
      bundle: b,
      snap: null,
      selected: [4],
      now: Date.parse("2026-11-01T21:00:00.000Z"),
      live: false,
    });
    expect(model.selected[0].cleanCount).toBe(2);
    expect(model.selected[0].avgClean).toBeCloseTo(79.6, 5);
    expect(model.scLaps.has(33)).toBe(true);
    expect(barHeightFrac(79.5, 79.5)).toBeCloseTo(0.04);
    expect(barHeightFrac(79.5 + LAP_CLIP_S, 79.5)).toBe(1);
    expect(barHeightFrac(200, 79.5)).toBe(1);
  });

  it("adds a live in-progress row from the existing lap document", () => {
    const start = Date.parse("2026-11-01T20:00:00.000Z");
    const b = bundle({
      laps: [
        lap({ driver_number: 4, lap_number: 1, date_start: new Date(start).toISOString(), lap_duration: 80 }),
        lap({
          driver_number: 4,
          lap_number: 2,
          date_start: new Date(start + 80_000).toISOString(),
          lap_duration: null,
          duration_sector_1: 21.9,
          duration_sector_2: 29.8,
          duration_sector_3: null,
        }),
      ],
    });
    const model = buildLapTimingModel({
      bundle: b,
      snap: null,
      selected: [4],
      now: start + 120_000,
      live: true,
    });
    expect(model.laps).toEqual([1, 2]);
    expect(model.cells.get(4)?.get(2)?.inProgress).toBe(true);
    expect(model.cells.get(4)?.get(2)?.s1).toBe(21.9);
    expect(model.inProgressLap).toBe(2);
  });

  it("stripes PIA when comparing NOR, LEC, and PIA and writes delta vs first", () => {
    const start = Date.parse("2026-11-01T20:00:00.000Z");
    const t = (n: number) => new Date(start + n * 80_000).toISOString();
    const b = bundle({
      laps: [4, 16, 81].flatMap((dn) => [
        lap({
          driver_number: dn,
          lap_number: 1,
          date_start: t(1),
          lap_duration: dn === 4 ? 79.1 : dn === 16 ? 79.2 : 79.4,
        }),
      ]),
    });
    const model = buildLapTimingModel({
      bundle: b,
      snap: null,
      selected: [4, 16, 81],
      now: start + 200_000,
      live: false,
    });
    expect(model.selected.map((s) => s.driver.driver_number)).toEqual([4, 16, 81]);
    expect(model.selected.find((s) => s.driver.driver_number === 81)?.striped).toBe(true);
    expect(model.cells.get(16)?.get(1)?.deltaFirst).toBeCloseTo(0.1, 5);
    expect(model.cells.get(81)?.get(1)?.deltaFirst).toBeCloseTo(0.3, 5);
  });
});
