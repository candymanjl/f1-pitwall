import { describe, expect, it } from "vitest";
import { geoCircuitFor, lngLatToMetres } from "./geoCircuit";
import { applySimilarity, fitSimilarity, procrustes, resampleClosed } from "./trackFit";

function rotate(pts: [number, number][], deg: number, scale: number, tx: number, ty: number, flipX = false): [number, number][] {
  const th = (deg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  return pts.map(([x, y]) => {
    const px = flipX ? -x : x;
    return [scale * (c * px - s * y) + tx, scale * (s * px + c * y) + ty];
  });
}

const SQUARE: [number, number][] = [
  [0, 0],
  [100, 0],
  [140, 40],
  [120, 110],
  [40, 130],
  [-20, 80],
  [0, 0],
];

describe("track similarity fit", () => {
  it("resamples a closed outline to a fixed count", () => {
    expect(resampleClosed(SQUARE, 16)).toHaveLength(16);
  });

  it("recovers rotation, scale, and translation", () => {
    const dst = rotate(SQUARE, 37, 2.4, 500, -80);
    const fit = fitSimilarity(SQUARE, dst, 48);
    expect(fit).toBeTruthy();
    expect(fit!.flipX).toBe(false);
    expect(fit!.scale).toBeCloseTo(2.4, 2);
    expect((fit!.theta * 180) / Math.PI).toBeCloseTo(37, 1);
    expect(fit!.rmsM).toBeLessThan(1);
    const [x, y] = applySimilarity(fit!, 100, 0);
    const [ex, ey] = rotate([[100, 0]], 37, 2.4, 500, -80)[0];
    expect(x).toBeCloseTo(ex, 1);
    expect(y).toBeCloseTo(ey, 1);
  });

  it("recovers a mirrored outline", () => {
    const dst = rotate(SQUARE, -22, 0.75, 10, 20, true);
    const fit = fitSimilarity(SQUARE, dst, 48);
    expect(fit).toBeTruthy();
    expect(fit!.flipX).toBe(true);
    expect(fit!.scale).toBeCloseTo(0.75, 2);
    expect(fit!.rmsM).toBeLessThan(1);
    const [x, y] = applySimilarity(fit!, 40, 130);
    const [ex, ey] = rotate([[40, 130]], -22, 0.75, 10, 20, true)[0];
    expect(x).toBeCloseTo(ex, 1);
    expect(y).toBeCloseTo(ey, 1);
  });

  it("recovers a rotated, scaled, and mirrored circuit outline", () => {
    const geo = geoCircuitFor({ circuit_short_name: "Interlagos", location: "São Paulo", country_name: "Brazil" })!;
    const loop = lngLatToMetres(geo.lngLat, geo.lat0, geo.lon0);
    const dst = rotate(loop, 18, 1.04, 40, -15, true);
    const fit = fitSimilarity(loop, dst, 48);
    expect(fit).toBeTruthy();
    expect(fit!.flipX).toBe(true);
    expect(fit!.scale).toBeCloseTo(1.04, 2);
    expect(fit!.rmsM).toBeLessThan(8);
  });

  it("procrustes on identical points is identity", () => {
    const pts: [number, number][] = [
      [1, 0],
      [2, 1],
      [0, 2],
    ];
    const fit = procrustes(pts, pts);
    expect(fit.rmsM).toBeCloseTo(0, 8);
    expect(fit.scale).toBeCloseTo(1, 6);
    expect(fit.theta).toBeCloseTo(0, 6);
  });
});
