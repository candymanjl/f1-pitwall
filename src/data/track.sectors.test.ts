import { describe, expect, it } from "vitest";
import { sectorDistanceFractions, slicePolyline } from "./track";
import type { Lap, LocationSample } from "./types";

const START = Date.parse("2025-10-26T20:20:00.000Z");

function lap(partial: Partial<Lap> = {}): Lap {
  return {
    driver_number: 1,
    lap_number: 12,
    date_start: new Date(START).toISOString(),
    lap_duration: 80,
    duration_sector_1: 20,
    duration_sector_2: 30,
    duration_sector_3: 30,
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

describe("sectorDistanceFractions", () => {
  it("splits a reference lap by sector timestamps along GPS distance", () => {
    const samples: LocationSample[] = Array.from({ length: 81 }, (_, i) => ({
      date: new Date(START + i * 1000).toISOString(),
      driver_number: 1,
      x: i * 10,
      y: 0,
    }));
    const fracs = sectorDistanceFractions(samples, lap());
    expect(fracs).toBeTruthy();
    expect(fracs![0]).toBeCloseTo(0.25, 1);
    expect(fracs![1]).toBeCloseTo(0.375, 1);
    expect(fracs![2]).toBeCloseTo(0.375, 1);
    expect(fracs![0] + fracs![1] + fracs![2]).toBeCloseTo(1, 5);
  });

  it("returns null when the GPS window is too short to cover the sectors", () => {
    const samples: LocationSample[] = Array.from({ length: 10 }, (_, i) => ({
      date: new Date(START + i * 1000).toISOString(),
      driver_number: 1,
      x: i * 10,
      y: 0,
    }));
    expect(sectorDistanceFractions(samples, lap())).toBeNull();
  });
});

describe("slicePolyline", () => {
  it("returns interpolated endpoints for a distance window", () => {
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    const mid = slicePolyline(pts, 0.25, 0.75);
    expect(mid[0][0]).toBeCloseTo(50, 5);
    expect(mid[mid.length - 1][1]).toBeCloseTo(50, 5);
  });
});
