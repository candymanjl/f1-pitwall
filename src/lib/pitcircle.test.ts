import { describe, expect, it } from "vitest";
import {
  clockwiseDelta,
  fracToAngle,
  ghostFrac,
  midFracClockwise,
  neighborsAt,
  onTrackGaps,
  pointOnCircle,
  racingFrac,
  wedgePath,
  wrap01,
} from "./pitcircle";

describe("pit circle geometry", () => {
  it("puts S/F at 12 o'clock and travels clockwise", () => {
    const sf = pointOnCircle(0, 0, 1, 0);
    expect(sf.x).toBeCloseTo(0, 6);
    expect(sf.y).toBeCloseTo(-1, 6);
    expect(fracToAngle(0)).toBeCloseTo(-Math.PI / 2, 6);

    const q1 = pointOnCircle(0, 0, 1, 0.25);
    expect(q1.x).toBeCloseTo(1, 6);
    expect(q1.y).toBeCloseTo(0, 6);
  });

  it("maps pit-out laps from pit exit toward S/F", () => {
    expect(racingFrac(0, true, 0.05)).toBeCloseTo(0.05, 5);
    expect(racingFrac(1, true, 0.05)).toBeCloseTo(0, 5);
    expect(racingFrac(0.4, false, 0.05)).toBeCloseTo(0.4, 5);
  });

  it("orders on-track gaps by physical position, including lapped cars", () => {
    const gaps = onTrackGaps(
      [
        { driver: 1, code: "VER", frac: 0.3, inPit: false, retired: false, pace: 80 },
        { driver: 44, code: "HAM", frac: 0.9, inPit: false, retired: false, pace: 80 },
        { driver: 16, code: "LEC", frac: 0.1, inPit: false, retired: false, pace: 80 },
        { driver: 55, code: "SAI", frac: 0.5, inPit: true, retired: false, pace: 80 },
        { driver: 14, code: "ALO", frac: 0.2, inPit: false, retired: true, pace: 80 },
      ],
      80,
    );
    expect(gaps.map((g) => [g.behindCode, g.aheadCode, Number(g.gap.toFixed(1))])).toEqual([
      ["LEC", "VER", 16],
      ["VER", "HAM", 48],
      ["HAM", "LEC", 16],
    ]);
    expect(gaps[0].from).toBeCloseTo(0.1, 5);
    expect(gaps[0].to).toBeCloseTo(0.3, 5);
    expect(gaps.every((g) => g.behind !== 55 && g.ahead !== 55)).toBe(true);
  });

  it("places the pit ghost behind the selected car by pit-loss time", () => {
    expect(ghostFrac(0.5, 20, 80)).toBeCloseTo(0.25, 5);
    expect(wrap01(0)).toBe(0);
    expect(clockwiseDelta(0.9, 0.1)).toBeCloseTo(0.2, 6);
    expect(midFracClockwise(0.9, 0.1)).toBeCloseTo(0, 6);
  });

  it("finds physical neighbors at a rejoin fraction", () => {
    const cars = [
      { driver: 1, code: "VER", frac: 0.2, inPit: false, retired: false, pace: 80 },
      { driver: 44, code: "HAM", frac: 0.6, inPit: false, retired: false, pace: 80 },
      { driver: 16, code: "LEC", frac: 0.8, inPit: false, retired: false, pace: 80 },
    ];
    const n = neighborsAt(cars, 0.5);
    expect(n.ahead?.code).toBe("HAM");
    expect(n.behind?.code).toBe("VER");
  });

  it("builds a clockwise pie wedge from 12 o'clock to 3 o'clock", () => {
    const d = wedgePath(0, 0, 10, 0, 0.25);
    expect(d).toContain("M0.0,0.0");
    expect(d).toContain("L0.0,-10.0");
    expect(d).toContain("A10,10 0 0 1 10.0,0.0");
    expect(d.endsWith("Z")).toBe(true);
    expect(wedgePath(0, 0, 10, 0.2, 0.2)).toBe("");
  });
});
