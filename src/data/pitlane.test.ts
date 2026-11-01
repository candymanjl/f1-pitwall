import { describe, expect, it } from "vitest";
import { DEFAULT_PIT_ENTRY, DEFAULT_PIT_EXIT, detectPitLane, nearestFrac, pitLaneFracs } from "./pitlane";
import type { LocationSample } from "./types";

const SQUARE: [number, number][] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 0],
];

function loc(i: number, x: number, y: number): LocationSample {
  return {
    date: new Date(Date.parse("2025-10-26T20:00:00.000Z") + i * 200).toISOString(),
    driver_number: 1,
    x,
    y,
  };
}

describe("pitLaneFracs", () => {
  it("uses bundle marks when present and the same defaults as the footer strip", () => {
    expect(pitLaneFracs({ pitEntry: 0.96, pitExit: 0.06 })).toEqual({ entry: 0.96, exit: 0.06 });
    expect(pitLaneFracs(null)).toEqual({ entry: DEFAULT_PIT_ENTRY, exit: DEFAULT_PIT_EXIT });
    expect(pitLaneFracs({})).toEqual({ entry: DEFAULT_PIT_ENTRY, exit: DEFAULT_PIT_EXIT });
  });
});

describe("nearestFrac", () => {
  it("returns 0 at S/F and ~0.375 at the midpoint of the second side", () => {
    expect(nearestFrac(SQUARE, 0, 0)).toBeCloseTo(0, 3);
    expect(nearestFrac(SQUARE, 100, 50)).toBeCloseTo(0.375, 2);
  });
});

describe("detectPitLane", () => {
  it("reads entry/exit from a trace that leaves and rejoins the racing line", () => {
    const onLine: LocationSample[] = [];
    for (let i = 0; i <= 10; i++) onLine.push(loc(i, 10 + i * 8, 0));
    const inPit: LocationSample[] = [];
    for (let i = 11; i <= 20; i++) inPit.push(loc(i, 80, -40 - (i - 11) * 2));
    const rejoin: LocationSample[] = [];
    for (let i = 21; i <= 30; i++) rejoin.push(loc(i, 100, 10 + (i - 21) * 8));
    const hit = detectPitLane(SQUARE, [...onLine, ...inPit, ...rejoin]);
    expect(hit).toBeTruthy();
    expect(hit!.entry).toBeGreaterThan(0.05);
    expect(hit!.entry).toBeLessThan(0.4);
    expect(hit!.exit).toBeGreaterThan(0.25);
    expect(hit!.exit).toBeLessThan(0.7);
    expect(hit!.exit).toBeGreaterThan(hit!.entry);
  });

  it("returns null without a clear off-line pit run", () => {
    const onlyLine = Array.from({ length: 8 }, (_, i) => loc(i, i * 10, 0));
    expect(detectPitLane(SQUARE, onlyLine)).toBeNull();
    expect(detectPitLane([], onlyLine)).toBeNull();
  });
});
