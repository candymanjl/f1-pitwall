import { describe, expect, it } from "vitest";
import { windArrowScreen } from "./track";

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
