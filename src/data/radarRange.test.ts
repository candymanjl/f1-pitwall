import { afterEach, describe, expect, it } from "vitest";
import {
  mosaicWidthMiles,
  parseRadarRange,
  RADAR_RANGE_15,
  RADAR_RANGE_50,
  RADAR_RANGE_KEY,
  RAINVIEWER_MAX_ZOOM,
  rangeScale,
  readRadarRange,
  scaleBarMiles,
  visibleWidthMiles,
  writeRadarRange,
} from "./radarRange";

const INTERLAGOS = -23.7036;
const SILVERSTONE = 52.0786;

function assertNearTarget(lat: number, target: number): void {
  const scale = rangeScale(lat, target);
  const visible = visibleWidthMiles(lat, scale);
  expect(Math.abs(visible - target) / target).toBeLessThan(0.1);
  expect(scale).toBeGreaterThan(1);
}

describe("radar range views", () => {
  afterEach(() => {
    try {
      localStorage.removeItem(RADAR_RANGE_KEY);
    } catch {
      /* node without storage */
    }
  });

  it("keeps 50 mi and 15 mi within 10% at Interlagos and Silverstone", () => {
    for (const lat of [INTERLAGOS, SILVERSTONE]) {
      assertNearTarget(lat, RADAR_RANGE_50);
      assertNearTarget(lat, RADAR_RANGE_15);
    }
  });

  it("uses a smaller CSS scale at 50 mi than at 15 mi (nearer native z=7)", () => {
    const s50 = rangeScale(INTERLAGOS, RADAR_RANGE_50);
    const s15 = rangeScale(INTERLAGOS, RADAR_RANGE_15);
    expect(s50).toBeLessThan(s15);
    expect(s15 / s50).toBeCloseTo(50 / 15, 5);
    expect(RAINVIEWER_MAX_ZOOM).toBe(7);
    expect(mosaicWidthMiles(INTERLAGOS, 7, 3)).toBeGreaterThan(50);
  });

  it("sizes the scale bar as a round fraction of the view", () => {
    expect(scaleBarMiles(50)).toBe(10);
    expect(scaleBarMiles(15)).toBe(3);
  });

  it("round-trips the last range in localStorage", () => {
    const mem = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, v);
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      },
    });
    expect(readRadarRange()).toBe(50);
    writeRadarRange(15);
    expect(parseRadarRange("15")).toBe(15);
    expect(readRadarRange()).toBe(15);
    writeRadarRange(50);
    expect(readRadarRange()).toBe(50);
  });
});
