import { describe, expect, it } from "vitest";
import { parseTs } from "../lib/time";
import { fillMissingLapStarts, timingLooksSparse } from "./lapStarts";
import type { Lap } from "./types";

function lap(partial: Partial<Lap> & { driver_number: number; lap_number: number }): Lap {
  return {
    date_start: null,
    lap_duration: null,
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
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

describe("fillMissingLapStarts", () => {
  it("fills a null opening lap from session start and a later null from the previous finish", () => {
    const start = parseTs("2026-11-06T15:30:00+00:00");
    const filled = fillMissingLapStarts(
      [
        lap({ driver_number: 62, lap_number: 1, date_start: null, lap_duration: 80 }),
        lap({
          driver_number: 62,
          lap_number: 2,
          date_start: "2026-11-06T15:32:52.806000+00:00",
          lap_duration: 73.661,
        }),
        lap({ driver_number: 1, lap_number: 7, date_start: null, lap_duration: null }),
        lap({
          driver_number: 1,
          lap_number: 6,
          date_start: "2026-11-06T15:39:08.260000+00:00",
          lap_duration: 127.958,
        }),
      ],
      start,
    );
    expect(parseTs(filled.find((l) => l.driver_number === 62 && l.lap_number === 1)?.date_start)).toBe(start);
    expect(parseTs(filled.find((l) => l.driver_number === 1 && l.lap_number === 7)?.date_start)).toBe(
      parseTs("2026-11-06T15:39:08.260000+00:00") + 127.958 * 1000,
    );
  });
});

describe("timingLooksSparse", () => {
  it("detects empty laps next to full stints, and a live window that missed the first stints", () => {
    expect(
      timingLooksSparse({
        laps: [],
        stints: [{ lap_end: 33 }],
        weather: [],
      }),
    ).toBe(true);
    expect(
      timingLooksSparse({
        laps: [{ lap_number: 32 }, { lap_number: 33 }],
        stints: [{ lap_end: 33 }],
        weather: [{ date: "x" }],
      }),
    ).toBe(true);
    expect(
      timingLooksSparse({
        laps: Array.from({ length: 40 }, (_, i) => ({ lap_number: i + 1 })),
        stints: [{ lap_end: 33 }],
        weather: [{ date: "x" }],
      }),
    ).toBe(false);
  });
});
