import { describe, expect, it } from "vitest";
import { nearestStripCar, stripFrac, stripX } from "./trackStrip";

describe("track strip mapping", () => {
  it("puts S/F at the center and travels left to right with a wrap", () => {
    expect(stripFrac(0)).toBeCloseTo(0.5, 6);
    expect(stripFrac(0.25)).toBeCloseTo(0.75, 6);
    expect(stripFrac(0.5)).toBeCloseTo(0, 6);
    expect(stripFrac(0.75)).toBeCloseTo(0.25, 6);
    expect(stripX(0, 200, 0)).toBeCloseTo(100, 5);
    expect(stripX(0.5, 200, 0)).toBeCloseTo(0, 5);
    expect(stripX(0.25, 200, 0)).toBeGreaterThan(stripX(0, 200, 0));
  });

  it("picks the nearest car on the strip", () => {
    const hit = nearestStripCar(
      [
        { n: 1, x: 40 },
        { n: 44, x: 120 },
      ],
      45,
      16,
    );
    expect(hit?.n).toBe(1);
    expect(nearestStripCar([{ n: 1, x: 40 }], 80, 16)).toBeNull();
  });
});
