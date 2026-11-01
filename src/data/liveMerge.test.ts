import { describe, expect, it } from "vitest";
import { applyLiveMessage, applyLiveUpdate, mergeLiveRows } from "./liveMerge";
import type { SessionBundle } from "./types";

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
