import { describe, expect, it } from "vitest";
import { applyLiveMessage, applyLiveUpdate, liveRowKey, mergeLiveRows, type LiveRow } from "./liveMerge";
import { buildLapTimingModel } from "./lapTiming";
import type { Driver, Lap, SessionBundle } from "./types";

function bundle(partial: Partial<SessionBundle> = {}): SessionBundle {
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
      session_name: "Race",
      session_type: "Race",
      date_start: "",
      date_end: "",
      circuit_short_name: "TST",
      country_name: "X",
      location: "X",
      year: 2026,
    },
    weekendSessions: [],
    drivers: [],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track: [],
    corners: [],
    sectorFracs: [0.3, 0.3, 0.4],
    ...partial,
  };
}

describe("mergeLiveRows", () => {
  it("replaces the same _key when _id is newer (lap sector updates)", () => {
    const first = {
      _key: "lap-44-12",
      _id: 10,
      driver_number: 44,
      lap_number: 12,
      duration_sector_1: 28.1,
      duration_sector_2: null,
    };
    const update = {
      _key: "lap-44-12",
      _id: 11,
      driver_number: 44,
      lap_number: 12,
      duration_sector_1: 28.1,
      duration_sector_2: 31.4,
    };
    const merged = mergeLiveRows([first], update);
    expect(merged).toHaveLength(1);
    expect(merged[0].duration_sector_2).toBe(31.4);
    expect(merged[0]._id).toBe(11);
  });

  it("ignores an older _id for the same _key", () => {
    const current = { _key: "k", _id: 50, value: "new" };
    const stale = { _key: "k", _id: 40, value: "old" };
    expect(mergeLiveRows([current], stale)[0].value).toBe("new");
  });

  it("appends rows that have no _key (time series)", () => {
    const a = { driver_number: 1, position: 1, date: "t1" };
    const b = { driver_number: 1, position: 2, date: "t2" };
    expect(mergeLiveRows([a], b)).toEqual([a, b]);
    expect(mergeLiveRows([a], b, true)).toEqual([a, b]);
  });

  it("merges 200k stored locations plus 800 new rows in under 50ms", () => {
    const t0 = Date.parse("2025-10-26T20:00:00.000Z");
    const existing = Array.from({ length: 200_000 }, (_, i) => ({
      date: new Date(t0 + i * 50).toISOString(),
      driver_number: (i % 20) + 1,
      x: i,
      y: i,
      t: t0 + i * 50,
    }));
    const incoming = Array.from({ length: 800 }, (_, i) => ({
      date: new Date(t0 + 200_000 * 50 + i * 50).toISOString(),
      driver_number: (i % 20) + 1,
      x: 200_000 + i,
      y: i,
    }));
    const start = bundle({ locations: existing });
    const t1 = performance.now();
    const result = applyLiveUpdate(start, "v1/location", incoming, 99);
    const dt = performance.now() - t1;
    expect(dt).toBeLessThan(50);
    expect(result.added).toBe(800);
    const locs = result.bundle.locations ?? [];
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.length).toBeLessThan(existing.length);
    expect(locs.at(-1)?.x).toBeGreaterThan(200_000);
    expect(result.latestMs).toBe(t0 + 200_000 * 50 + 799 * 50);
  });
});

describe("applyLiveMessage", () => {
  it("merges v1/laps onto the bundle and ignores other sessions", () => {
    const start = bundle({
      laps: [{ driver_number: 1, lap_number: 1, _key: "a", _id: 1 } as never],
    });
    const next = applyLiveMessage(
      start,
      "v1/laps",
      { _key: "a", _id: 2, driver_number: 1, lap_number: 1, lap_duration: 91.2, session_key: 99 },
      99,
    );
    expect(next.laps).toHaveLength(1);
    expect((next.laps[0] as { lap_duration?: number }).lap_duration).toBe(91.2);

    const skipped = applyLiveMessage(
      next,
      "v1/laps",
      { _key: "other", _id: 3, session_key: 100, lap_duration: 1 },
      99,
    );
    expect(skipped.laps).toHaveLength(1);
  });
});

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "McLaren",
    team_colour: "FF8000",
    first_name: code,
    last_name: code,
  };
}

function restLap(partial: Partial<Lap> & Pick<Lap, "driver_number" | "lap_number" | "date_start">): Lap {
  return {
    lap_duration: null,
    duration_sector_1: 19.2,
    duration_sector_2: 38.8,
    duration_sector_3: null,
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

describe("live lap identity merge", () => {
  const t0 = Date.parse("2026-11-08T17:00:00.000Z");
  const start56 = new Date(t0 + 55 * 80_000).toISOString();

  it("keys every lap as lap-{driver}-{lap_number} even when MQTT sends another _key", () => {
    expect(liveRowKey({ _key: "oid-aaa", driver_number: 4, lap_number: 56 })).toBe("lap-4-56");
    expect(liveRowKey({ driver_number: 4, lap_number: 56, date_start: start56 })).toBe("lap-4-56");
  });

  it("fills S3 and lap_duration from MQTT onto a REST row that has no _id", () => {
    const rest = restLap({ driver_number: 4, lap_number: 56, date_start: start56 });
    const mqtt = {
      _key: "lap-4-56",
      _id: 40,
      driver_number: 4,
      lap_number: 56,
      date_start: start56,
      duration_sector_3: 16.4,
      lap_duration: 74.4,
    };
    const merged = mergeLiveRows<LiveRow>([rest], mqtt);
    expect(merged).toHaveLength(1);
    expect(merged[0].duration_sector_1).toBe(19.2);
    expect(merged[0].duration_sector_2).toBe(38.8);
    expect(merged[0].duration_sector_3).toBe(16.4);
    expect(merged[0].lap_duration).toBe(74.4);
  });

  it("does not revert a filled lap when a stale REST snapshot repeats S3/time as null", () => {
    const filled = {
      _key: "lap-4-56",
      _id: 40,
      driver_number: 4,
      lap_number: 56,
      date_start: start56,
      duration_sector_1: 19.2,
      duration_sector_2: 38.8,
      duration_sector_3: 16.4,
      lap_duration: 74.4,
    };
    const stale = restLap({ driver_number: 4, lap_number: 56, date_start: start56 });
    const merged = mergeLiveRows<LiveRow>([filled], stale);
    expect(merged).toHaveLength(1);
    expect(merged[0].duration_sector_3).toBe(16.4);
    expect(merged[0].lap_duration).toBe(74.4);
  });

  it("does not let a newer _id wipe S3 or lap_duration with null", () => {
    const filled = {
      _key: "lap-4-56",
      _id: 5,
      driver_number: 4,
      lap_number: 56,
      duration_sector_1: 19,
      duration_sector_2: 39,
      duration_sector_3: 16.4,
      lap_duration: 74.4,
    };
    const wipe = {
      _key: "lap-4-56",
      _id: 6,
      driver_number: 4,
      lap_number: 56,
      duration_sector_1: 19,
      duration_sector_2: 39,
      duration_sector_3: null,
      lap_duration: null,
    };
    const merged = mergeLiveRows([filled], wipe);
    expect(merged[0].duration_sector_3).toBe(16.4);
    expect(merged[0].lap_duration).toBe(74.4);
  });

  it("collapses MQTT oid _key and REST lap-4-56 into one row", () => {
    const rest = restLap({ driver_number: 4, lap_number: 56, date_start: start56 });
    const mqtt = {
      _key: "oid-aaa",
      _id: 40,
      driver_number: 4,
      lap_number: 56,
      date_start: start56,
      duration_sector_3: 16.4,
      lap_duration: 74.4,
    };
    const merged = mergeLiveRows<LiveRow>([rest], mqtt);
    expect(merged).toHaveLength(1);
    expect(liveRowKey(merged[0])).toBe("lap-4-56");
    expect(merged[0].duration_sector_3).toBe(16.4);
  });

  it("does not pair a pit-out lap time with flying sectors", () => {
    const flying = {
      _key: "lap-1-46",
      _id: 10,
      driver_number: 1,
      lap_number: 46,
      date_start: start56,
      duration_sector_1: 19.422,
      duration_sector_2: 39.422,
      duration_sector_3: 16.445,
      lap_duration: null,
      is_pit_out_lap: true,
    };
    const durationOnly = {
      _key: "lap-1-46",
      _id: 11,
      driver_number: 1,
      lap_number: 46,
      date_start: start56,
      lap_duration: 94.588,
      is_pit_out_lap: true,
    };
    const mixed = mergeLiveRows<LiveRow>([flying], durationOnly)[0];
    expect(mixed.duration_sector_1).toBe(19.422);
    expect(mixed.lap_duration).toBeNull();
    expect(
      mergeLiveRows<LiveRow>([], {
        driver_number: 1,
        lap_number: 46,
        duration_sector_1: 19.422,
        duration_sector_2: 39.422,
        duration_sector_3: 16.445,
        lap_duration: 94.588,
        is_pit_out_lap: true,
      })[0].lap_duration,
    ).toBeNull();

    const pitOut = {
      _key: "lap-4-50",
      _id: 20,
      driver_number: 4,
      lap_number: 50,
      date_start: start56,
      duration_sector_1: 39.813,
      duration_sector_2: 38.85,
      duration_sector_3: 16.324,
      lap_duration: 94.987,
      is_pit_out_lap: true,
    };
    expect(mergeLiveRows<LiveRow>([], pitOut)[0].lap_duration).toBe(94.987);
    expect(mergeLiveRows<LiveRow>([], pitOut)[0].duration_sector_1).toBe(39.813);

    const restMixed = {
      driver_number: 1,
      lap_number: 46,
      date_start: start56,
      duration_sector_1: 19.422,
      duration_sector_2: 39.422,
      duration_sector_3: 16.445,
      lap_duration: 94.588,
      is_pit_out_lap: true,
    };
    const mqttFix = {
      _key: "lap-1-46",
      _id: 20,
      driver_number: 1,
      lap_number: 46,
      date_start: start56,
      duration_sector_1: 39.813,
      duration_sector_2: 38.85,
      duration_sector_3: 16.324,
      lap_duration: 94.588,
      is_pit_out_lap: true,
    };
    const fixed = mergeLiveRows<LiveRow>([restMixed], mqttFix)[0];
    expect(fixed.duration_sector_1).toBe(39.813);
    expect(fixed.lap_duration).toBe(94.588);
  });

  it("marks only the latest started lap in progress after S3 backfill", () => {
    const nor = driver(4, "NOR");
    const laps: Lap[] = [
      restLap({
        driver_number: 4,
        lap_number: 56,
        date_start: new Date(t0 + 55 * 80_000).toISOString(),
        duration_sector_3: 16.4,
        lap_duration: 74.4,
      }),
      restLap({
        driver_number: 4,
        lap_number: 57,
        date_start: new Date(t0 + 56 * 80_000).toISOString(),
        duration_sector_3: 16.5,
        lap_duration: 74.5,
      }),
      restLap({
        driver_number: 4,
        lap_number: 58,
        date_start: new Date(t0 + 57 * 80_000).toISOString(),
        duration_sector_2: null,
        duration_sector_3: null,
        lap_duration: null,
      }),
    ];
    const model = buildLapTimingModel({
      bundle: bundle({ drivers: [nor], laps }),
      snap: null,
      selected: [4],
      now: t0 + 57 * 80_000 + 20_000,
      live: true,
    });
    expect(model.cells.get(4)?.get(56)?.inProgress).toBe(false);
    expect(model.cells.get(4)?.get(57)?.inProgress).toBe(false);
    expect(model.cells.get(4)?.get(58)?.inProgress).toBe(true);
    expect(model.cells.get(4)?.get(56)?.time).toBe(74.4);
    expect(model.cells.get(4)?.get(56)?.s3).toBe(16.4);
    expect(model.inProgressLap).toBe(58);
  });
});
