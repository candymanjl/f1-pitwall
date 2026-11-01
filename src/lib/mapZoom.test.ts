import { describe, expect, it } from "vitest";
import { followViewBox, MAP_FOLLOW_ZOOM } from "./mapZoom";

describe("followViewBox", () => {
  it("opens a smaller window around the follow car and stays inside the map", () => {
    const box = followViewBox(400, 300, 800, 600, MAP_FOLLOW_ZOOM);
    expect(box.w).toBeCloseTo(800 / MAP_FOLLOW_ZOOM, 5);
    expect(box.h).toBeCloseTo(600 / MAP_FOLLOW_ZOOM, 5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(800 + 1e-6);
    expect(box.y + box.h).toBeLessThanOrEqual(600 + 1e-6);
    expect(box.x).toBeLessThan(400);
    expect(box.x + box.w).toBeGreaterThan(400);
  });

  it("clamps a car near the corner so the window stays on the map", () => {
    const box = followViewBox(10, 10, 800, 600, 3);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
  });
});
