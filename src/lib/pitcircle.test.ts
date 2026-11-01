import { describe, expect, it } from "vitest";
import { teamFill } from "./colors";
import {
  clockwiseDelta,
  fracToAngle,
  gapFrac,
  ghostFrac,
  ghostLapsDown,
  midFracClockwise,
  neighborsAt,
  onTrackGaps,
  rejoinGapText,
  rejoinPreview,
  pointOnCircle,
  placeCircleCars,
  placeTrackCar,
  raceGapSec,
  racingFrac,
  trackCarFrac,
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

  it("spreads cars by gap when every lap-progress is saturated", () => {
    const leader = 0.999;
    const a = gapFrac(leader, 0, 80);
    const b = gapFrac(leader, 8, 80);
    const c = gapFrac(leader, 16, 80);
    expect(a).toBeCloseTo(wrap01(leader), 5);
    expect(b).not.toBeCloseTo(a, 2);
    expect(c).not.toBeCloseTo(b, 2);
  });

  it("never uses practice best-lap gaps and prefers /location when the car is on track", () => {
    const track: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [0, 0],
    ];
    const now = Date.parse("2026-01-16T20:06:47.000Z");
    const leader = {
      pos: 1,
      gap: 0,
      progress: 0.72,
      pitOut: false,
      currentLap: 4,
      driver: { driver_number: 12 },
    };
    const clustered = {
      pos: 4,
      gap: 1.2,
      progress: 0.71,
      pitOut: false,
      currentLap: 3,
      driver: { driver_number: 16 },
    };
    const locOpts = {
      leaderProgress: 0.72,
      lapSec: 80,
      pitEntry: 0.96,
      pitExit: 0.06,
      now,
      track,
      useRaceGaps: false,
      locations: [
        { date: new Date(now).toISOString(), driver_number: 12, x: 10, y: 0 },
        { date: new Date(now).toISOString(), driver_number: 16, x: 100, y: 40 },
      ],
    };
    const a = placeTrackCar(leader, locOpts);
    const b = placeTrackCar(clustered, locOpts);
    expect(a?.source).toBe("location");
    expect(b?.source).toBe("location");
    expect(a?.frac).not.toBeCloseTo(b?.frac ?? -1, 2);
    expect(placeTrackCar(clustered, { ...locOpts, locations: [] })?.source).toBe("progress");
    expect(placeTrackCar(clustered, { ...locOpts, locations: [], useRaceGaps: false })?.frac).toBeCloseTo(0.71, 5);
    expect(
      placeTrackCar(
        { pos: 18, gap: 9876, progress: 0, pitOut: false, inGarage: true, status: "GARAGE", driver: { driver_number: 14 } },
        locOpts,
      ),
    ).toBeNull();
  });

  it("prefers a race /location sample over interval gaps, then keeps #28 when GPS is missing", () => {
    const track: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [0, 0],
    ];
    const now = Date.parse("2025-10-26T21:35:31.000Z");
    const lapped = {
      pos: 12,
      gap: "+1 LAP",
      progress: 0.18,
      pitOut: false,
      currentLap: 67,
      driver: { driver_number: 4 },
    };
    const timed = {
      pos: 2,
      gap: 4,
      progress: 0.67,
      pitOut: false,
      currentLap: 68,
      driver: { driver_number: 1 },
    };
    const opts = {
      leaderProgress: 0.72,
      lapSec: 80,
      pitEntry: 0.96,
      pitExit: 0.06,
      now,
      track,
      useRaceGaps: true,
      locations: [{ date: new Date(now).toISOString(), driver_number: 1, x: 50, y: 80 }],
    };
    const fromGps = placeTrackCar(timed, opts);
    expect(fromGps?.source).toBe("location");
    expect(fromGps?.frac).not.toBeCloseTo(gapFrac(0.72, 4, 80), 2);
    expect(placeTrackCar(timed, { ...opts, locations: [] })?.source).toBe("gap");
    expect(placeTrackCar(lapped, { ...opts, locations: [] })?.source).toBe("progress");
    expect(placeTrackCar(lapped, { ...opts, locations: [] })?.frac).toBeCloseTo(0.18, 5);
  });

  it("keeps the pit circle on race gap time even when GPS would move the map", () => {
    const track: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [0, 0],
    ];
    const now = Date.parse("2025-10-26T21:10:00.000Z");
    const rows = [
      { pos: 1, gap: 0, interval: 0, progress: 0.4, pitOut: false, currentLap: 40, driver: { driver_number: 16 } },
      { pos: 2, gap: 8, interval: 8, progress: 0.9, pitOut: false, currentLap: 40, driver: { driver_number: 1 } },
      { pos: 3, gap: "+1 LAP", interval: "+1 LAP", progress: 0.22, pitOut: false, currentLap: 39, driver: { driver_number: 4 } },
      { pos: 4, gap: "+1 LAP", interval: 1.5, progress: 0.11, pitOut: false, currentLap: 39, driver: { driver_number: 10 } },
    ];
    const opts = {
      leaderProgress: 0.4,
      lapSec: 80,
      pitEntry: 0.96,
      pitExit: 0.06,
      now,
      track,
      useRaceGaps: true,
      locations: [
        { date: new Date(now).toISOString(), driver_number: 16, x: 10, y: 0 },
        { date: new Date(now).toISOString(), driver_number: 1, x: 100, y: 40 },
        { date: new Date(now).toISOString(), driver_number: 4, x: 40, y: 80 },
      ],
    };
    const circle = placeCircleCars(rows, opts);
    expect(circle[0]?.source).toBe("gap");
    expect(circle[1]?.source).toBe("gap");
    expect(circle[0]?.frac).toBeCloseTo(gapFrac(0.4, 0, 80), 5);
    expect(circle[1]?.frac).toBeCloseTo(gapFrac(0.4, 8, 80), 5);
    expect(circle[1]?.frac).not.toBeCloseTo(placeTrackCar(rows[1], opts)?.frac ?? -1, 2);
    expect(raceGapSec(rows[2], 8, 80)).toBeCloseTo(88, 5);
    expect(circle[2]?.source).toBe("gap");
    expect(circle[2]?.frac).toBeCloseTo(gapFrac(0.4, 88, 80), 5);
    expect(circle[2]?.frac).not.toBeCloseTo(circle[0]?.frac ?? -1, 2);
    expect(circle[3]?.source).toBe("gap");
    expect(circle[3]?.frac).toBeCloseTo(gapFrac(0.4, 89.5, 80), 5);
    const later = placeCircleCars(rows, { ...opts, now: now + 2000, leaderProgress: 0.425 });
    expect(later[1]?.frac).toBeCloseTo(gapFrac(0.425, 8, 80), 5);
    expect(Math.abs((later[1]?.frac ?? 0) - (circle[1]?.frac ?? 0))).toBeLessThan(0.05);
  });

  it("keeps lapped cars on their own lap progress instead of stacking on the leader", () => {
    const leader = { pos: 1, gap: 0, progress: 0.72, pitOut: false };
    const timed = { pos: 2, gap: 4, progress: 0.67, pitOut: false };
    const lapped = { pos: 12, gap: "+1 LAP", progress: 0.18, pitOut: false };
    const missing = { pos: 14, gap: null, progress: 0.41, pitOut: false };
    const pits = { leaderProgress: 0.72, lapSec: 80, pitEntry: 0.96, pitExit: 0.06 };
    const leadFrac = trackCarFrac(leader, pits);
    expect(leadFrac).toBeCloseTo(0.72, 5);
    expect(trackCarFrac(timed, pits)).toBeCloseTo(gapFrac(0.72, 4, 80), 5);
    expect(trackCarFrac(lapped, pits)).toBeCloseTo(0.18, 5);
    expect(trackCarFrac(lapped, pits)).not.toBeCloseTo(leadFrac, 2);
    expect(trackCarFrac(missing, pits)).toBeCloseTo(0.41, 5);
    expect(trackCarFrac({ ...lapped, inPit: true }, pits)).toBeCloseTo(0.96, 5);
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

  it("keeps a lapped rejoin on the circle and reports +1L", () => {
    expect(ghostLapsDown(0.1, 20, 80)).toBe(1);
    expect(ghostLapsDown(0.9, 20, 80)).toBe(0);
    expect(ghostLapsDown(0.1, 100, 80)).toBe(2);
    const cars = [
      { driver: 44, code: "HAM", frac: 0.2, inPit: false, retired: false, pace: 80 },
      { driver: 16, code: "LEC", frac: 0.85, inPit: false, retired: false, pace: 80 },
    ];
    const preview = rejoinPreview(cars, 0.1, 90, 80);
    expect(preview.lapsDown).toBeGreaterThanOrEqual(1);
    expect(preview.frac).toBeGreaterThanOrEqual(0);
    expect(preview.frac).toBeLessThan(1);
    expect(preview.ahead || preview.behind).toBeTruthy();
  });

  it("signs the car ahead negative and the car behind positive", () => {
    expect(rejoinGapText("NOR", 1.234, "ahead")).toBe("NOR −1.234");
    expect(rejoinGapText("VER", 0.876, "behind")).toBe("VER +0.876");
    expect(rejoinGapText("LEC", -2.5, "ahead")).toBe("LEC −2.500");
    expect(rejoinGapText("HAM", null, "behind")).toBe("HAM —");
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

  it("keeps each gap slice colored by the leading driver across the S/F wrap", () => {
    const cars = [
      { driver: 1, code: "VER", frac: 0.95, inPit: false, retired: false, pace: 80, color: "3671C6" },
      { driver: 44, code: "HAM", frac: 0.1, inPit: false, retired: false, pace: 80, color: "27F4D2" },
      { driver: 16, code: "LEC", frac: 0.4, inPit: false, retired: false, pace: 80, color: "E8002D" },
    ];
    const before = onTrackGaps(cars, 80);
    const after = onTrackGaps(
      cars.map((c) => ({ ...c, frac: wrap01(c.frac + 0.2) })),
      80,
    );
    expect(before.map((g) => g.ahead)).not.toEqual(after.map((g) => g.ahead));
    const byPair = (gaps: typeof before) =>
      Object.fromEntries(gaps.map((g) => [`${g.behind}-${g.ahead}`, { fill: g.fill, color: g.color }]));
    expect(byPair(after)).toEqual(byPair(before));
    const behindHam = before.find((g) => g.ahead === 44);
    expect(behindHam?.fill).toBe(teamFill("27F4D2"));
    expect(behindHam?.color).toBe("#27F4D2");
    expect(before.find((g) => g.ahead === 1)?.fill).toBe(teamFill("3671C6"));
    expect(before.find((g) => g.ahead === 16)?.fill).toBe(teamFill("E8002D"));
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
