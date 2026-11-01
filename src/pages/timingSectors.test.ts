import { describe, expect, it } from "vitest";
import { visibleLapTiming } from "../data/derive";
import type { Lap } from "../data/types";
import { parseTs } from "../lib/time";
import {
  SEG_OVERALL,
  SEG_PERSONAL,
  SEG_PIT,
  SEG_YELLOW,
  driverTimingAt,
  segmentClass,
  sessionMiniSlots,
} from "./timingSectors";

function lap(partial: Partial<Lap> & Pick<Lap, "driver_number" | "lap_number" | "date_start">): Lap {
  return {
    lap_duration: 80,
    duration_sector_1: 29.153,
    duration_sector_2: 31.804,
    duration_sector_3: 19.22,
    is_pit_out_lap: false,
    segments_sector_1: [null, SEG_YELLOW, SEG_PERSONAL],
    segments_sector_2: [SEG_YELLOW, SEG_OVERALL],
    segments_sector_3: [SEG_PIT, SEG_YELLOW],
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
    ...partial,
  };
}

const laps = [
  lap({ driver_number: 1, lap_number: 1, date_start: "2025-10-26T20:00:00.000Z" }),
  lap({
    driver_number: 1,
    lap_number: 2,
    date_start: "2025-10-26T20:01:20.000Z",
    duration_sector_1: 28.5,
    duration_sector_2: 32.1,
    duration_sector_3: 19.0,
    segments_sector_1: [SEG_OVERALL, SEG_YELLOW, SEG_YELLOW],
    segments_sector_2: [SEG_PERSONAL, SEG_YELLOW],
    segments_sector_3: [SEG_YELLOW, SEG_YELLOW],
  }),
  lap({
    driver_number: 44,
    lap_number: 1,
    date_start: "2025-10-26T20:00:01.000Z",
    duration_sector_1: 30,
    duration_sector_2: 33,
    duration_sector_3: 20,
  }),
];

describe("driverTimingAt", () => {
  const slots = sessionMiniSlots(laps);
  const lap2 = parseTs("2025-10-26T20:01:20.000Z");

  it("sizes mini-sector groups from the widest list in the session", () => {
    expect(slots).toEqual({ s1: 3, s2: 2, s3: 2 });
  });

  it("keeps the finished mini-sector row until the next S1 block completes", () => {
    const view = driverTimingAt(laps, 1, lap2 + 1000, slots);
    expect(view.s1).toMatchObject({ time: 29.153, held: true });
    expect(view.s2).toMatchObject({ time: 31.804, held: true });
    expect(view.s3).toMatchObject({ time: 19.22, held: true, kind: "overall" });
    expect(view.minis.s1).toEqual([null, SEG_YELLOW, SEG_PERSONAL]);
    expect(view.minis.s2).toEqual([SEG_YELLOW, SEG_OVERALL]);
    expect(view.minis.s3).toEqual([SEG_PIT, SEG_YELLOW]);
    expect(visibleLapTiming(laps[1], lap2 + 1000).s1).toBeNull();

    const opened = driverTimingAt(laps, 1, lap2 + 9_500, slots);
    expect(opened.minis.s1).toEqual([SEG_OVERALL, null, null]);
    expect(opened.minis.s2.every((code) => code == null)).toBe(true);
    expect(opened.minis.s3.every((code) => code == null)).toBe(true);
  });

  it("fills S1, then S3, from the current lap and colours the new best purple", () => {
    const s1 = driverTimingAt(laps, 1, lap2 + 28_500, slots);
    expect(s1.s1).toMatchObject({ time: 28.5, kind: "overall", held: false });
    expect(s1.s2).toMatchObject({ time: 31.804, held: true });
    expect(s1.s3.held).toBe(true);
    expect(s1.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, SEG_YELLOW]);
    expect(s1.minis.s2.every((code) => code == null)).toBe(true);
    expect(s1.minis.s3.every((code) => code == null)).toBe(true);

    const done = driverTimingAt(laps, 1, lap2 + 80_000, slots);
    expect(done.s3).toMatchObject({ time: 19.0, kind: "overall", held: false, delta: 19 - 19.22 });
    expect(done.minis.s3).toEqual([SEG_YELLOW, SEG_YELLOW]);
    expect(done.s1.delta).toBeCloseTo(28.5 - 29.153, 3);
    expect(done.s1.time).toBe(visibleLapTiming(laps[1], lap2 + 80_000).s1);
  });

  it("keeps an empty mini-sector in place instead of closing the gap", () => {
    const start = parseTs("2025-10-26T20:00:00.000Z");
    const view = driverTimingAt(laps, 1, start + 29_153, slots);
    expect(view.minis.s1).toEqual([null, SEG_YELLOW, SEG_PERSONAL]);
    expect(view.s1).toMatchObject({ time: 29.153, held: false });
    expect(view.s2.held).toBe(false);
    expect(view.s2.time).toBeNull();
  });

  it("lights mini-sectors one by one, including a partial S3", () => {
    const early = driverTimingAt(laps, 1, lap2 + 9_500, slots);
    expect(early.minis.s1).toEqual([SEG_OVERALL, null, null]);
    expect(early.minis.s3.every((code) => code == null)).toBe(true);

    const midS1 = driverTimingAt(laps, 1, lap2 + 19_000, slots);
    expect(midS1.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, null]);

    const s3Start = 28.5 + 32.1;
    const midS3 = driverTimingAt(laps, 1, lap2 + (s3Start + 9.5) * 1000, slots);
    expect(midS3.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, SEG_YELLOW]);
    expect(midS3.minis.s2).toEqual([SEG_PERSONAL, SEG_YELLOW]);
    expect(midS3.minis.s3).toEqual([SEG_YELLOW, null]);
    expect(midS3.s3.held).toBe(true);
    expect(midS3.s1.delta).toBeCloseTo(28.5 - 29.153, 3);
  });

  it("holds every block, including the last S3 segment, across the lap boundary", () => {
    const lap3Start = lap2 + 80_000;
    const withNext = [
      ...laps,
      lap({
        driver_number: 1,
        lap_number: 3,
        date_start: new Date(lap3Start).toISOString(),
        duration_sector_1: 30,
        duration_sector_2: 32,
        duration_sector_3: 18,
        lap_duration: 80,
        segments_sector_1: [SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW],
        segments_sector_2: [SEG_YELLOW, SEG_YELLOW],
        segments_sector_3: [SEG_OVERALL, SEG_YELLOW],
      }),
    ];
    const wide = sessionMiniSlots(withNext);
    const held = driverTimingAt(withNext, 1, lap3Start + 500, wide);
    expect(held.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, SEG_YELLOW]);
    expect(held.minis.s2).toEqual([SEG_PERSONAL, SEG_YELLOW]);
    expect(held.minis.s3).toEqual([SEG_YELLOW, SEG_YELLOW]);

    const fresh = driverTimingAt(withNext, 1, lap3Start + 10_000, wide);
    expect(fresh.minis.s1).toEqual([SEG_PERSONAL, null, null]);
    expect(fresh.minis.s2.every((code) => code == null)).toBe(true);
    expect(fresh.minis.s3.every((code) => code == null)).toBe(true);
  });

  it("maps OpenF1 segment codes to overall, personal, yellow, pit, and empty", () => {
    expect(segmentClass(SEG_OVERALL)).toBe("seg-overall");
    expect(segmentClass(SEG_PERSONAL)).toBe("seg-personal");
    expect(segmentClass(SEG_YELLOW)).toBe("seg-yellow");
    expect(segmentClass(SEG_PIT)).toBe("seg-pit");
    expect(segmentClass(0)).toBe("seg-none");
    expect(segmentClass(null)).toBe("seg-none");
  });
});
