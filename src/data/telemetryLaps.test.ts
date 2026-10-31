import { describe, expect, it } from "vitest";
import type { Lap, Pit } from "./types";
import {
  defaultLapForDriver,
  ensureMinDrivers,
  fastestCompleteLap,
  isCompleteLap,
  pitInLaps,
  slotsAtFastest,
  slotsAtLap,
} from "./telemetryLaps";

function lap(partial: Partial<Lap> & Pick<Lap, "driver_number" | "lap_number" | "lap_duration">): Lap {
  return {
    date_start: "2025-10-26T20:00:00.000Z",
    duration_sector_1: 28,
    duration_sector_2: 30,
    duration_sector_3: 22,
    is_pit_out_lap: false,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
    ...partial,
  };
}

describe("complete laps", () => {
  const pits: Pit[] = [
    { date: "2025-10-26T20:10:00.000Z", driver_number: 1, lap_number: 12, lane_duration: 10, pit_duration: 22, stop_duration: 2 },
  ];

  it("skips in-laps, out-laps, and laps missing a sector or a start time", () => {
    const inLaps = pitInLaps(pits, 1);
    expect(isCompleteLap(lap({ driver_number: 1, lap_number: 8, lap_duration: 80 }), inLaps)).toBe(true);
    expect(isCompleteLap(lap({ driver_number: 1, lap_number: 1, lap_duration: 95, is_pit_out_lap: true }), inLaps)).toBe(false);
    expect(isCompleteLap(lap({ driver_number: 1, lap_number: 12, lap_duration: 100 }), inLaps)).toBe(false);
    expect(isCompleteLap(lap({ driver_number: 1, lap_number: 9, lap_duration: 81, duration_sector_3: null }), inLaps)).toBe(false);
    expect(isCompleteLap(lap({ driver_number: 1, lap_number: 10, lap_duration: 81, date_start: null }), inLaps)).toBe(false);
    expect(isCompleteLap(lap({ driver_number: 1, lap_number: 11, lap_duration: null }), inLaps)).toBe(false);
  });

  it("picks the fastest complete lap and ignores a quicker out-lap", () => {
    const laps = [
      lap({ driver_number: 4, lap_number: 1, lap_duration: 70, is_pit_out_lap: true }),
      lap({ driver_number: 4, lap_number: 3, lap_duration: 82.4 }),
      lap({ driver_number: 4, lap_number: 6, lap_duration: 81.1 }),
      lap({ driver_number: 4, lap_number: 7, lap_duration: 79, duration_sector_2: null }),
      lap({ driver_number: 9, lap_number: 4, lap_duration: 80.2 }),
    ];
    expect(fastestCompleteLap(laps, 4, [])).toBe(6);
    expect(defaultLapForDriver(laps, 4, [])).toBe(6);
    expect(fastestCompleteLap(laps, 2, [])).toBeNull();
    expect(defaultLapForDriver([lap({ driver_number: 2, lap_number: 5, lap_duration: 90, duration_sector_1: null })], 2, [])).toBe(5);
  });

  it("fills new drivers with their fastest complete lap", () => {
    const laps = [
      lap({ driver_number: 1, lap_number: 2, lap_duration: 88 }),
      lap({ driver_number: 1, lap_number: 4, lap_duration: 81 }),
      lap({ driver_number: 16, lap_number: 3, lap_duration: 90, is_pit_out_lap: true }),
      lap({ driver_number: 16, lap_number: 8, lap_duration: 82 }),
    ];
    const filled = ensureMinDrivers([], [{ driver_number: 1 }, { driver_number: 16 }], laps, [], 2, 4);
    expect(filled).toEqual([
      { driver: 1, lap: 4 },
      { driver: 16, lap: 8 },
    ]);
    expect(ensureMinDrivers(filled, [{ driver_number: 1 }], laps, [])).toBe(filled);
  });

  it("sets every driver who ran that lap, and each driver's own fastest", () => {
    const laps = [
      lap({ driver_number: 1, lap_number: 10, lap_duration: 80 }),
      lap({ driver_number: 1, lap_number: 11, lap_duration: 81 }),
      lap({ driver_number: 44, lap_number: 10, lap_duration: 79.5 }),
      lap({ driver_number: 44, lap_number: 4, lap_duration: 78 }),
      lap({ driver_number: 63, lap_number: 2, lap_duration: 82 }),
    ];
    const slots = [
      { driver: 1, lap: 11 },
      { driver: 44, lap: 4 },
      { driver: 63, lap: 2 },
    ];
    expect(slotsAtLap(slots, laps, 10)).toEqual([
      { driver: 1, lap: 10 },
      { driver: 44, lap: 10 },
      { driver: 63, lap: 2 },
    ]);
    expect(slotsAtLap(slots, laps, 0)).toBe(slots);
    expect(slotsAtFastest(slots, laps, [])).toEqual([
      { driver: 1, lap: 10 },
      { driver: 44, lap: 4 },
      { driver: 63, lap: 2 },
    ]);
  });
});
