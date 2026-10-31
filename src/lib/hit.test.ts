import { describe, expect, it } from "vitest";
import { applyUiScale } from "./scale";
import { DRIVER_HIT_CSS, cssPoint, driverHitRadius, gapX, hitCircle, nearestPoint, setupCanvas } from "./hit";

function fakeCanvas(clientW: number, clientH: number, dpr: number): HTMLCanvasElement {
  const canvas = {
    clientWidth: clientW,
    clientHeight: clientH,
    width: 0,
    height: 0,
    ctx: {
      setTransform: (...args: number[]) => {
        (canvas as { lastTransform?: number[] }).lastTransform = args;
      },
    },
    getContext() {
      return this.ctx;
    },
  };
  Object.defineProperty(globalThis, "devicePixelRatio", { value: dpr, configurable: true });
  return canvas as unknown as HTMLCanvasElement;
}

describe("setupCanvas + cssPoint (DPR-safe)", () => {
  it.each([1, 1.5, 2])("backs the bitmap by DPR %s but hit-tests in CSS pixels", (dpr) => {
    const canvas = fakeCanvas(400, 200, dpr);
    const { w, h, dpr: used } = setupCanvas(canvas, 400, 200);
    expect(used).toBe(dpr);
    expect(w).toBe(400);
    expect(h).toBe(200);
    expect(canvas.width).toBe(Math.round(400 * dpr));
    expect(canvas.height).toBe(Math.round(200 * dpr));
    expect((canvas as unknown as { lastTransform: number[] }).lastTransform).toEqual([dpr, 0, 0, dpr, 0, 0]);

    const el = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 400, height: 200, right: 410, bottom: 220, x: 10, y: 20, toJSON() {} }),
    };
    const p = cssPoint({ clientX: 10 + 80, clientY: 20 + 40 }, el);
    expect(p.x).toBeCloseTo(80, 5);
    expect(p.y).toBeCloseTo(40, 5);
    expect(hitCircle(p.x, p.y, 80, 40, 14)).toBe(true);
    expect(hitCircle(p.x, p.y, 80 + 15, 40, 14)).toBe(false);
  });

  it("treats browser zoom as CSS pixels via getBoundingClientRect (no DPR divide)", () => {
    const zoomed = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
    };
    const p = cssPoint({ clientX: 400, clientY: 200 }, zoomed);
    expect(p.x / p.w).toBeCloseTo(0.5, 5);
  });
});

describe("driver hit radius", () => {
  it("stays ~14 CSS px at 1× and grows with UI scale, independent of drawn radius", () => {
    applyUiScale(100, { width: 1920, height: 1080 }, null);
    expect(driverHitRadius()).toBeCloseTo(DRIVER_HIT_CSS, 5);
    expect(hitCircle(0, 0, 0, 0, driverHitRadius())).toBe(true);
    expect(hitCircle(14.1, 0, 0, 0, 4.5)).toBe(false);
    expect(hitCircle(14, 0, 0, 0, driverHitRadius())).toBe(true);
    applyUiScale(200, { width: 1920, height: 1080 }, null);
    expect(driverHitRadius()).toBeCloseTo(28, 5);
  });
});

describe("nearestPoint / gapX", () => {
  it("picks the closest driver inside the hit radius", () => {
    const hit = nearestPoint(
      [
        { n: 1, x: 10, y: 10 },
        { n: 44, x: 40, y: 10 },
      ],
      12,
      11,
      14,
    );
    expect(hit?.n).toBe(1);
    expect(gapX(0, 8, 100, 8)).toBeCloseTo(8, 5);
    expect(gapX(8, 8, 100, 8)).toBeCloseTo(92, 5);
  });
});
