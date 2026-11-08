import { describe, expect, it } from "vitest";
import { interpolateMonotone } from "./interpolate";

describe("monotone cubic interpolation", () => {
  it("is linear between two points", () => {
    expect(interpolateMonotone([0, 10], [0, 20], 5)).toBeCloseTo(10, 8);
    expect(interpolateMonotone([0, 10], [0, 20], -4)).toBe(0);
    expect(interpolateMonotone([0, 10], [0, 20], 40)).toBe(20);
  });

  it("does not overshoot a plateau", () => {
    const xs = [0, 15, 30, 45];
    const ys = [0, 50, 50, 0];
    expect(interpolateMonotone(xs, ys, 22)).toBeLessThanOrEqual(50);
    expect(interpolateMonotone(xs, ys, 22)).toBeGreaterThanOrEqual(49);
  });
});
