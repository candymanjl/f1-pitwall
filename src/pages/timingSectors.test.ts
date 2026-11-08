import { afterEach, describe, expect, it } from "vitest";
import { visibleLapTiming } from "../data/derive";
import type { Lap, SessionBundle, TimingSnapshot } from "../data/types";
import { pointAt } from "../data/track";
import { resetCarMotion, syncCarMotion } from "../lib/carMotion";
import { parseTs } from "../lib/time";
import {
  SEG_OVERALL,
  SEG_PERSONAL,
  SEG_PIT,
  SEG_PROVISIONAL,
  SEG_YELLOW,
  driverTimingAt,
  gpsProgressForMinis,
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
    expect(view.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, SEG_PERSONAL]);
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
    const holed = laps.map((row, index) => (index === 0 ? { ...row, segments_sector_1: [SEG_YELLOW, null, SEG_PERSONAL] } : row));
    const view = driverTimingAt(holed, 1, start + 29_153, slots);
    expect(view.minis.s1).toEqual([SEG_YELLOW, null, SEG_PERSONAL]);
    expect(view.s1).toMatchObject({ time: 29.153, held: false });
    expect(view.s2.held).toBe(false);
    expect(view.s2.time).toBeNull();
  });

  it("fills a blank S1 block 1 once the car is past it", () => {
    const start = parseTs("2025-10-26T20:00:00.000Z");
    const early = driverTimingAt(laps, 1, start + 5_000, slots);
    expect(early.minis.s1).toEqual([null, null, null]);

    const mid = driverTimingAt(laps, 1, start + 20_000, slots);
    expect(mid.s1.time).toBeNull();
    expect(mid.minis.s1).toEqual([SEG_YELLOW, SEG_YELLOW, null]);

    const done = driverTimingAt(laps, 1, start + 29_153, slots);
    expect(done.s1.kind).toBe("overall");
    expect(done.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, SEG_PERSONAL]);

    const pitOnly = [
      lap({
        driver_number: 1,
        lap_number: 1,
        date_start: "2025-10-26T20:00:00.000Z",
        segments_sector_1: [SEG_PIT, null, SEG_YELLOW],
      }),
    ];
    const pit = driverTimingAt(pitOnly, 1, start + 29_153, sessionMiniSlots(pitOnly));
    expect(pit.minis.s1).toEqual([SEG_PIT, null, SEG_YELLOW]);
  });

  it("colours a blank S1 block 1 from the sector time, and yellow before that time exists", () => {
    const t0 = parseTs("2025-10-26T20:00:00.000Z");
    const lap2 = parseTs("2025-10-26T20:01:20.000Z");
    const rows = [
      lap({
        driver_number: 1,
        lap_number: 1,
        date_start: "2025-10-26T20:00:00.000Z",
        duration_sector_1: 29,
        segments_sector_1: [null, SEG_YELLOW, SEG_YELLOW],
      }),
      lap({
        driver_number: 1,
        lap_number: 2,
        date_start: "2025-10-26T20:01:20.000Z",
        duration_sector_1: 31,
        segments_sector_1: [0, SEG_YELLOW, SEG_YELLOW],
      }),
      lap({
        driver_number: 44,
        lap_number: 1,
        date_start: "2025-10-26T20:00:00.000Z",
        duration_sector_1: 28,
        segments_sector_1: [SEG_YELLOW, SEG_YELLOW, SEG_YELLOW],
      }),
    ];
    const wide = sessionMiniSlots(rows);
    const personal = driverTimingAt(rows, 1, t0 + 29_000, wide);
    expect(personal.s1.kind).toBe("personal");
    expect(personal.minis.s1[0]).toBe(SEG_PERSONAL);

    const opened = driverTimingAt(rows, 1, lap2 + 11_000, wide);
    expect(opened.s1.held).toBe(true);
    expect(opened.minis.s1).toEqual([SEG_YELLOW, null, null]);

    const slower = driverTimingAt(rows, 1, lap2 + 31_000, wide);
    expect(slower.s1).toMatchObject({ time: 31, kind: "yellow", held: false });
    expect(slower.minis.s1[0]).toBe(SEG_YELLOW);
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
    expect(segmentClass(SEG_PROVISIONAL)).toBe("seg-provisional");
    expect(segmentClass(0)).toBe("seg-none");
    expect(segmentClass(null)).toBe("seg-none");
  });
});

/**
 * Mexico-style live lap: sector times and colours stay empty until each sector
 * finishes. GPS progress (the smoothed on-track fraction) lights the blocks.
 * Outline split matches a typical Mexico sector balance.
 */
const LIVE_SPLIT: [number, number, number] = [0.3, 0.42, 0.28];

describe("live mini-sectors from GPS, with a lap-time backup", () => {
  afterEach(() => {
    resetCarMotion();
  });

  const t0 = parseTs("2025-10-26T20:00:00.000Z");
  const lap2 = t0 + 90_000;
  const slots = { s1: 3, s2: 2, s3: 2 };

  function liveRows(extra: Partial<Lap> = {}): Lap[] {
    return [
      lap({
        driver_number: 1,
        lap_number: 1,
        date_start: new Date(t0).toISOString(),
        duration_sector_1: 30,
        duration_sector_2: 40,
        duration_sector_3: 20,
        lap_duration: 90,
        segments_sector_1: [SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW],
        segments_sector_2: [SEG_YELLOW, SEG_OVERALL],
        segments_sector_3: [SEG_YELLOW, SEG_YELLOW],
      }),
      lap({
        driver_number: 1,
        lap_number: 2,
        date_start: new Date(lap2).toISOString(),
        duration_sector_1: null,
        duration_sector_2: null,
        duration_sector_3: null,
        lap_duration: null,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
        ...extra,
      }),
    ];
  }

  function at(progress: number | null, now: number, rows = liveRows()) {
    return driverTimingAt(rows, 1, now, slots, { progress, sectorFracs: LIVE_SPLIT });
  }

  it("lights S1, S2, and S3 one block at a time from track progress", () => {
    const seen = (progress: number) => at(progress, lap2 + progress * 90_000);
    expect(seen(0.05).minis.s1).toEqual([SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW]);
    expect(seen(0.12).minis.s1).toEqual([SEG_PROVISIONAL, null, null]);
    expect(seen(0.22).minis.s1).toEqual([SEG_PROVISIONAL, SEG_PROVISIONAL, null]);
    expect(seen(0.31).minis.s1).toEqual([SEG_PROVISIONAL, SEG_PROVISIONAL, SEG_PROVISIONAL]);
    expect(seen(0.31).minis.s2).toEqual([SEG_YELLOW, SEG_OVERALL]);
    expect(seen(0.31).minis.s3).toEqual([SEG_YELLOW, SEG_YELLOW]);

    const intoS2 = seen(0.55);
    expect(intoS2.minis.s1.every((code) => code === SEG_PROVISIONAL)).toBe(true);
    expect(intoS2.minis.s2).toEqual([SEG_PROVISIONAL, null]);
    expect(intoS2.minis.s3).toEqual([SEG_YELLOW, SEG_YELLOW]);

    const intoS3 = seen(0.9);
    expect(intoS3.minis.s2).toEqual([SEG_PROVISIONAL, SEG_PROVISIONAL]);
    expect(intoS3.minis.s3).toEqual([SEG_PROVISIONAL, null]);
  });

  it("recolours a sector when OpenF1 sends the real segment codes", () => {
    const now = lap2 + 20_000;
    const plain = at(0.55, now);
    expect(plain.minis.s1.every((code) => code === SEG_PROVISIONAL)).toBe(true);
    expect(plain.minis.s2).toEqual([SEG_PROVISIONAL, null]);

    const coloured = liveRows({
      duration_sector_1: 29.4,
      segments_sector_1: [SEG_OVERALL, SEG_YELLOW, SEG_PERSONAL],
    });
    const next = at(0.55, lap2 + 30_000, coloured);
    expect(next.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, SEG_PERSONAL]);
    expect(next.minis.s2).toEqual([SEG_PROVISIONAL, null]);
    expect(next.s1).toMatchObject({ time: 29.4, held: false });
  });

  it("holds every S3 block through the line, then opens the next lap at the first S1 mini", () => {
    const lap3 = lap2 + 90_000;
    const finished = liveRows({
      duration_sector_1: 29.2,
      duration_sector_2: 39.5,
      duration_sector_3: 19.4,
      lap_duration: 90,
      segments_sector_1: [SEG_YELLOW, SEG_YELLOW, SEG_OVERALL],
      segments_sector_2: [SEG_PERSONAL, SEG_YELLOW],
      segments_sector_3: [SEG_OVERALL, SEG_YELLOW],
    });
    finished.push(
      lap({
        driver_number: 1,
        lap_number: 3,
        date_start: new Date(lap3).toISOString(),
        duration_sector_1: null,
        duration_sector_2: null,
        duration_sector_3: null,
        lap_duration: null,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
      }),
    );
    const wide = sessionMiniSlots(finished);
    const onTheLine = driverTimingAt(finished, 1, lap3 + 400, wide, { progress: 0.99, sectorFracs: LIVE_SPLIT });
    expect(onTheLine.minis.s3).toEqual([SEG_OVERALL, SEG_YELLOW]);
    expect(onTheLine.minis.s1).toEqual([SEG_YELLOW, SEG_YELLOW, SEG_OVERALL]);
    expect(onTheLine.s3.held).toBe(true);

    const justAfter = driverTimingAt(finished, 1, lap3 + 800, wide, { progress: 0.03, sectorFracs: LIVE_SPLIT });
    expect(justAfter.minis.s3).toEqual([SEG_OVERALL, SEG_YELLOW]);

    const opened = driverTimingAt(finished, 1, lap3 + 2_000, wide, { progress: 0.12, sectorFracs: LIVE_SPLIT });
    expect(opened.minis.s1).toEqual([SEG_PROVISIONAL, null, null]);
    expect(opened.minis.s2).toEqual([SEG_PERSONAL, SEG_YELLOW]);
    expect(opened.minis.s3).toEqual([SEG_OVERALL, SEG_YELLOW]);
  });

  it("falls back to the driver's last sector time when GPS is missing", () => {
    const early = at(null, lap2 + 12_000);
    expect(early.minis.s1).toEqual([SEG_PROVISIONAL, null, null]);
    expect(early.minis.s2.every((code) => code == null)).toBe(true);

    const later = at(null, lap2 + 25_000);
    expect(later.minis.s1).toEqual([SEG_PROVISIONAL, SEG_PROVISIONAL, null]);

    const s2 = at(null, lap2 + 55_000);
    expect(s2.minis.s1.every((code) => code === SEG_PROVISIONAL)).toBe(true);
    expect(s2.minis.s2[0]).toBe(SEG_PROVISIONAL);

    const lap3 = lap2 + 90_000;
    const rows = liveRows({
      duration_sector_1: 29.2,
      duration_sector_2: 39.5,
      duration_sector_3: 19.4,
      lap_duration: 90,
      segments_sector_1: [SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW],
      segments_sector_2: [SEG_YELLOW, SEG_OVERALL],
      segments_sector_3: [SEG_YELLOW, SEG_YELLOW],
    });
    rows.push(
      lap({
        driver_number: 1,
        lap_number: 3,
        date_start: new Date(lap3).toISOString(),
        duration_sector_1: null,
        duration_sector_2: null,
        duration_sector_3: null,
        lap_duration: null,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
      }),
    );
    const held = driverTimingAt(rows, 1, lap3 + 2_000, slots, { progress: null, sectorFracs: LIVE_SPLIT });
    expect(held.minis.s1).toEqual([SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW]);
    expect(held.minis.s3).toEqual([SEG_YELLOW, SEG_YELLOW]);
    const released = driverTimingAt(rows, 1, lap3 + 12_000, slots, { progress: null, sectorFracs: null });
    expect(released.minis.s1[0]).toBe(SEG_PROVISIONAL);
    expect(released.minis.s1.slice(1).every((code) => code == null)).toBe(true);
  });

  it("walks a 3.7 Hz trace through every sector without lighting a block early", () => {
    const step = 1000 / 3.7;
    const previous = {
      s2: [SEG_YELLOW, SEG_OVERALL],
      s3: [SEG_YELLOW, SEG_YELLOW],
    };
    let sawS1 = false;
    let sawS2 = false;
    let sawS3 = false;
    for (let elapsed = 0; elapsed < 88_000; elapsed += step) {
      const progress = elapsed / 90_000;
      const view = at(progress, lap2 + elapsed);
      const s2First = 0.3 + 0.42 / slots.s2;
      const s3First = 0.72 + 0.28 / slots.s3;
      if (progress + 1e-9 < s2First) expect(view.minis.s2).toEqual(previous.s2);
      if (progress + 1e-9 < s3First) expect(view.minis.s3).toEqual(previous.s3);
      if (progress < 0.1) {
        expect(view.minis.s1.every((code) => code !== SEG_PROVISIONAL)).toBe(true);
        continue;
      }
      if (view.minis.s1.some((code) => code === SEG_PROVISIONAL)) sawS1 = true;
      if (view.minis.s2.some((code) => code === SEG_PROVISIONAL)) sawS2 = true;
      if (view.minis.s3.some((code) => code === SEG_PROVISIONAL)) sawS3 = true;
    }
    expect(sawS1 && sawS2 && sawS3).toBe(true);
  });

  it("keeps replay colours when GPS is present and the segment codes already exist", () => {
    const start = parseTs("2025-10-26T20:00:00.000Z");
    const view = driverTimingAt(laps, 1, start + 20_000, sessionMiniSlots(laps), {
      progress: 0.22,
      sectorFracs: LIVE_SPLIT,
    });
    expect(view.minis.s1).toEqual([SEG_YELLOW, SEG_YELLOW, null]);
    expect(view.minis.s1).not.toContain(SEG_PROVISIONAL);
  });

  it("reads the smoothed on-track fraction and ignores a stale fix", () => {
    const track: [number, number][] = [
      [0, 0],
      [300, 0],
      [300, 200],
      [0, 200],
      [0, 0],
    ];
    const frac = 0.22;
    const [x, y] = pointAt(track, frac);
    const now = lap2 + 5_000;
    const rows = liveRows();
    const bundle = {
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
      drivers: [],
      laps: rows,
      intervals: [],
      positions: [],
      stints: [],
      weekendStints: [],
      pits: [],
      weather: [],
      raceControl: [],
      track,
      corners: [],
      sectorFracs: LIVE_SPLIT,
      locations: [{ date: new Date(now).toISOString(), driver_number: 1, x, y, t: now }],
    } as SessionBundle;
    const snap = { now, rows: [{ driver: { driver_number: 1 }, progress: frac, inPit: false }] } as TimingSnapshot;
    syncCarMotion(bundle, snap, now, true);
    const progress = gpsProgressForMinis(1, now);
    expect(progress).toBeCloseTo(frac, 2);
    const view = driverTimingAt(rows, 1, now, slots, { progress, sectorFracs: LIVE_SPLIT });
    expect(view.minis.s1.filter((code) => code === SEG_PROVISIONAL).length).toBeGreaterThan(0);
    expect(gpsProgressForMinis(1, now + 6_000)).toBeNull();
  });
});

/**
 * Sao Paulo lap 44: cars on different laps. Blocks for a sector stay with the
 * lap whose time is in that column. Grey only covers the ground the car is on.
 */
describe("lapped cars keep sector colours with the sector time", () => {
  const split: [number, number, number] = [0.3, 0.42, 0.28];
  const now = Date.parse("2026-11-08T18:00:00.000Z");
  const prevColours = {
    s1: [SEG_OVERALL, SEG_YELLOW, SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW],
    s2: [SEG_YELLOW, SEG_OVERALL, SEG_YELLOW, SEG_YELLOW, SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW],
    s3: [SEG_YELLOW, SEG_PERSONAL, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW],
  };

  function done(driver: number, lapNo: number, startMs: number): Lap {
    return lap({
      driver_number: driver,
      lap_number: lapNo,
      date_start: new Date(startMs).toISOString(),
      lap_duration: 71.5,
      duration_sector_1: 25,
      duration_sector_2: 32,
      duration_sector_3: 14.5,
      segments_sector_1: prevColours.s1,
      segments_sector_2: prevColours.s2,
      segments_sector_3: prevColours.s3,
    });
  }

  function open(driver: number, lapNo: number, startMs: number, sectors: { s1?: number; s2?: number } = {}): Lap {
    return lap({
      driver_number: driver,
      lap_number: lapNo,
      date_start: new Date(startMs).toISOString(),
      lap_duration: null,
      duration_sector_1: sectors.s1 ?? null,
      duration_sector_2: sectors.s2 ?? null,
      duration_sector_3: null,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
    });
  }

  function at(driver: number, rows: Lap[], progress: number) {
    return driverTimingAt(rows, driver, now, sessionMiniSlots(rows), { progress, sectorFracs: split });
  }

  it("keeps the full previous lap at 3% and opens only the first S1 block at 6%", () => {
    const atThree = at(1, [done(1, 43, now - 2_100 - 71_500), open(1, 44, now - 2_100)], 0.03);
    expect(atThree.minis.s1).toEqual(prevColours.s1);
    expect(atThree.minis.s2).toEqual(prevColours.s2);
    expect(atThree.minis.s3).toEqual(prevColours.s3);
    expect(atThree.s1.held && atThree.s2.held && atThree.s3.held).toBe(true);

    const atSix = at(27, [done(27, 43, now - 4_300 - 71_500), open(27, 44, now - 4_300)], 0.06);
    expect(atSix.minis.s1).toEqual([SEG_PROVISIONAL, null, null, null, null, null, null, null]);
    expect(atSix.minis.s2).toEqual(prevColours.s2);
    expect(atSix.minis.s3).toEqual(prevColours.s3);
    expect(atSix.s1.held && atSix.s2.held && atSix.s3.held).toBe(true);
  });

  it("colours a finished S1 from its time while S2 is grey only as far as the car", () => {
    const view = at(43, [done(43, 42, now - 40_000 - 71_500), open(43, 43, now - 40_000, { s1: 26.4 })], 0.52);
    expect(view.minis.s1.every((code) => code === SEG_YELLOW)).toBe(true);
    expect(view.minis.s2).toEqual([SEG_PROVISIONAL, SEG_PROVISIONAL, SEG_PROVISIONAL, SEG_PROVISIONAL, null, null, null, null]);
    expect(view.minis.s3).toEqual(prevColours.s3);
    expect(view.s1).toMatchObject({ time: 26.4, held: false });
    expect(view.s2.held).toBe(true);
    expect(view.s3.held).toBe(true);
  });

  it("colours a lap 43 car's finished S1 and S2 while S3 stays grey up to the car", () => {
    const view = at(16, [done(16, 42, now - 62_000 - 71_500), open(16, 43, now - 62_000, { s1: 24.2, s2: 33.1 })], 0.85);
    expect(view.minis.s1.every((code) => code === SEG_OVERALL)).toBe(true);
    expect(view.minis.s2.every((code) => code === SEG_YELLOW)).toBe(true);
    expect(view.minis.s3).toEqual([SEG_PROVISIONAL, SEG_PROVISIONAL, null, null, null, null]);
    expect(view.s1.held).toBe(false);
    expect(view.s2.held).toBe(false);
    expect(view.s3.held).toBe(true);
  });

  it("colours ALB's finished S1 and S2 when the colour list has not arrived", () => {
    const view = at(23, [done(23, 41, now - 60_000 - 71_500), open(23, 42, now - 60_000, { s1: 24.6, s2: 33.4 })], 0.78);
    expect(view.minis.s1.every((code) => code === SEG_OVERALL)).toBe(true);
    expect(view.minis.s2.every((code) => code === SEG_YELLOW)).toBe(true);
    expect(view.minis.s3[0]).toBe(SEG_PROVISIONAL);
    expect(view.minis.s3.slice(1).every((code) => code == null)).toBe(true);
    expect(view.minis.s1).not.toContain(SEG_PROVISIONAL);
    expect(view.minis.s2).not.toContain(SEG_PROVISIONAL);
  });

  it("keeps the previous coloured row when GPS is still in S3 30 seconds after the new lap", () => {
    const view = at(23, [done(23, 41, now - 30_000 - 71_500), open(23, 42, now - 30_000)], 0.9);
    expect(view.minis.s1).toEqual(prevColours.s1);
    expect(view.minis.s2).toEqual(prevColours.s2);
    expect(view.minis.s3).toEqual(prevColours.s3);
    expect(view.minis.s1).not.toContain(SEG_PROVISIONAL);
  });

  it("grows grey S1 blocks for a leader with no sector times, and keeps a recorded lap's colours", () => {
    const early = at(1, [done(1, 43, now - 8_600 - 71_500), open(1, 44, now - 8_600)], 0.12);
    const later = at(1, [done(1, 43, now - 15_700 - 71_500), open(1, 44, now - 15_700)], 0.22);
    const earlyGrey = early.minis.s1.filter((code) => code === SEG_PROVISIONAL).length;
    const laterGrey = later.minis.s1.filter((code) => code === SEG_PROVISIONAL).length;
    expect(earlyGrey).toBeGreaterThan(0);
    expect(laterGrey).toBeGreaterThan(earlyGrey);
    expect(early.minis.s2).toEqual(prevColours.s2);
    expect(later.minis.s3).toEqual(prevColours.s3);

    const lap2 = parseTs("2025-10-26T20:01:20.000Z");
    const recorded = driverTimingAt(laps, 1, lap2 + (28.5 + 32.1 + 9.5) * 1000, sessionMiniSlots(laps), {
      progress: 0.9,
      sectorFracs: split,
    });
    expect(recorded.minis.s1).toEqual([SEG_OVERALL, SEG_YELLOW, SEG_YELLOW]);
    expect(recorded.minis.s2).toEqual([SEG_PERSONAL, SEG_YELLOW]);
    expect(recorded.minis.s3).toEqual([SEG_YELLOW, null]);
    expect(recorded.minis.s1).not.toContain(SEG_PROVISIONAL);
  });

  it("leaves a finished sector grey only while the car is still inside it", () => {
    const view = at(43, [done(43, 42, now - 28_000 - 71_500), open(43, 43, now - 28_000, { s1: 25.5 })], 0.2);
    expect(view.minis.s1.filter((code) => code === SEG_PROVISIONAL).length).toBeGreaterThan(0);
    expect(view.minis.s1).not.toContain(SEG_YELLOW);
    expect(view.s1).toMatchObject({ time: 25.5, held: false });
  });
});
