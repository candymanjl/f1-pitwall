import { describe, expect, it } from "vitest";
import { downsampleLocations, indexLocations, isRecentLocation, locationOnTrack, nearestIndexed } from "./carLocation";
import type { LocationSample } from "./types";

function sample(driver: number, date: string, x: number, y: number): LocationSample {
  return { date, driver_number: driver, x, y };
}

describe("car locations", () => {
  it("downsamples and finds the nearest sample to the playhead", () => {
    const rows = [
      sample(1, "2026-01-16T20:00:00.000Z", 0, 0),
      sample(1, "2026-01-16T20:00:00.200Z", 1, 0),
      sample(1, "2026-01-16T20:00:00.600Z", 10, 0),
      sample(44, "2026-01-16T20:00:00.000Z", 5, 5),
    ];
    const kept = downsampleLocations(rows, 500);
    expect(kept.map((s) => s.x)).toEqual([0, 10, 5]);
    const idx = indexLocations(kept);
    const hit = nearestIndexed(idx.get(1), Date.parse("2026-01-16T20:00:00.550Z"));
    expect(hit?.x).toBe(10);
    expect(isRecentLocation(hit, Date.parse("2026-01-16T20:00:00.550Z"))).toBe(true);
    expect(isRecentLocation(hit, Date.parse("2026-01-16T20:00:30.000Z"))).toBe(false);
  });

  it("treats points far from the racing line as off-track", () => {
    const track: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [0, 0],
    ];
    expect(locationOnTrack(track, 100, 0)).toBe(true);
    expect(locationOnTrack(track, 40, 2)).toBe(true);
    expect(locationOnTrack(track, 40, 4000)).toBe(false);
  });
});
