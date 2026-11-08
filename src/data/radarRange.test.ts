import { afterEach, describe, expect, it } from "vitest";
import { latLonToTile } from "./rainViewer";
import {
  METERS_PER_MILE,
  metersPerTile,
  milesToLonDelta,
  mosaicWidthMiles,
  parseRadarRange,
  RADAR_RANGE_15,
  RADAR_RANGE_50,
  RADAR_RANGE_KEY,
  RAINVIEWER_MAX_ZOOM,
  radarMosaicFor,
  radarScreenPoint,
  rangeScale,
  readRadarRange,
  scaleBarMiles,
  visibleWidthMiles,
  writeRadarRange,
} from "./radarRange";

const INTERLAGOS = -23.7036;
const INTERLAGOS_LON = -46.6997;
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

  it("centres the circuit and keeps the scale bar width honest", () => {
    const panelW = 720;
    const panelH = 380;
    const mosaic = radarMosaicFor(INTERLAGOS, INTERLAGOS_LON, RADAR_RANGE_50);
    for (const range of [RADAR_RANGE_50, RADAR_RANGE_15] as const) {
      const scale = rangeScale(INTERLAGOS, range, mosaic.z, mosaic.cols);
      const centre = radarScreenPoint(INTERLAGOS, INTERLAGOS_LON, mosaic, panelW, panelH, scale);
      expect(centre.x).toBeCloseTo(panelW / 2, 4);
      expect(centre.y).toBeCloseTo(panelH / 2, 4);
      const east = radarScreenPoint(
        INTERLAGOS,
        INTERLAGOS_LON + milesToLonDelta(INTERLAGOS, range / 2),
        mosaic,
        panelW,
        panelH,
        scale,
      );
      expect(Math.abs(east.x - panelW)).toBeLessThan(0.05);
      expect(Math.abs(east.y - panelH / 2)).toBeLessThan(0.05);
      const west = radarScreenPoint(
        INTERLAGOS,
        INTERLAGOS_LON - milesToLonDelta(INTERLAGOS, range / 2),
        mosaic,
        panelW,
        panelH,
        scale,
      );
      expect(Math.abs(west.x)).toBeLessThan(0.05);
      expect(scaleBarMiles(range) / range).toBeCloseTo(0.2, 5);
      expect(visibleWidthMiles(INTERLAGOS, scale, mosaic.z, mosaic.cols)).toBeCloseTo(range, 4);
    }
  });

  it("loads the neighbouring tile when the circuit sits on a tile edge", () => {
    const z = RAINVIEWER_MAX_ZOOM;
    const n = 2 ** z;
    const lat = INTERLAGOS;
    for (const frac of [0.01, 0.99]) {
      const lon = ((40 + frac) / n) * 360 - 180;
      const mosaic = radarMosaicFor(lat, lon, RADAR_RANGE_50, z);
      const t = latLonToTile(lat, lon, z);
      const half = RADAR_RANGE_50 / 2 / (metersPerTile(lat, z) / METERS_PER_MILE);
      expect(mosaic.x0).toBeLessThanOrEqual(t.x - half);
      expect(mosaic.x0 + mosaic.cols).toBeGreaterThanOrEqual(t.x + half);
      expect(mosaic.y0).toBeLessThanOrEqual(t.y - half);
      expect(mosaic.y0 + mosaic.rows).toBeGreaterThanOrEqual(t.y + half);
      expect(mosaic.cols).toBeGreaterThan(1);
      expect(mosaic.pinX).toBeGreaterThan(0);
      expect(mosaic.pinX).toBeLessThan(mosaic.cols);
      const pt = radarScreenPoint(lat, lon, mosaic, 640, 360, rangeScale(lat, RADAR_RANGE_50, z, mosaic.cols));
      expect(pt.x).toBeCloseTo(320, 4);
      expect(pt.y).toBeCloseTo(180, 4);
    }
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
