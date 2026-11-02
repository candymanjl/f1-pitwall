import { describe, expect, it } from "vitest";
import { outlineFromLocations, windArrowScreen } from "./track";
import type { Driver, Lap, LocationSample } from "./types";

const SQUARE: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 0],
];

describe("windArrowScreen", () => {
  it("returns null without a track or a finite direction", () => {
    expect(windArrowScreen([], 180, 80, 60)).toBeNull();
    expect(windArrowScreen(SQUARE, Number.NaN, 80, 60)).toBeNull();
  });

  it("orients the arrow in the projected track frame (different bearings differ)", () => {
    const north = windArrowScreen(SQUARE, 0, 80, 60);
    const east = windArrowScreen(SQUARE, 90, 80, 60);
    expect(north).toBeTruthy();
    expect(east).toBeTruthy();
    const n = Math.atan2(north!.to[1] - north!.from[1], north!.to[0] - north!.from[0]);
    const e = Math.atan2(east!.to[1] - east!.from[1], east!.to[0] - east!.from[0]);
    let delta = Math.abs(n - e);
    if (delta > Math.PI) delta = 2 * Math.PI - delta;
    expect(delta).toBeGreaterThan(Math.PI / 6);
    // Square starts east; north wind blows south → larger screen Y after project() flip.
    expect(north!.to[1]).toBeGreaterThan(north!.from[1]);
    // East wind blows west → smaller screen X.
    expect(east!.to[0]).toBeLessThan(east!.from[0]);
  });
});

describe("outlineFromLocations", () => {
  it("builds a circuit path from GPS already on the session, using one clean lap", () => {
    const start = Date.parse("2025-10-26T20:20:00.000Z");
    const driver: Driver = {
      driver_number: 1,
      broadcast_name: "VER",
      full_name: "VER",
      name_acronym: "VER",
      team_name: "RB",
      team_colour: "3671C6",
      first_name: "Max",
      last_name: "Verstappen",
    };
    const laps: Lap[] = [
      {
        driver_number: 1,
        lap_number: 12,
        date_start: new Date(start).toISOString(),
        lap_duration: 80,
        duration_sector_1: 22,
        duration_sector_2: 29,
        duration_sector_3: 29,
        is_pit_out_lap: false,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
        i1_speed: null,
        i2_speed: null,
        st_speed: null,
      },
    ];
    const samples: LocationSample[] = Array.from({ length: 20 }, (_, i) => ({
      date: new Date(start + i * 1000).toISOString(),
      driver_number: 1,
      x: i * 40,
      y: (i % 5) * 40,
    }));
    const pts = outlineFromLocations(samples, laps, [driver]);
    expect(pts.length).toBeGreaterThan(2);
  });
});
