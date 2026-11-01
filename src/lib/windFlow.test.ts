import { describe, expect, it } from "vitest";
import {
  prefersReducedMotion,
  WIND_ARROW_MIN_LEN,
  WIND_CHEVRON_STEP,
  fitWindArrow,
  windArrowHeadPath,
  windChevronGeometry,
  windFlowPeriodMs,
} from "./windFlow";

describe("windFlowPeriodMs", () => {
  it("is near-still when calm and faster as wind_speed rises", () => {
    const calm = windFlowPeriodMs(0);
    const breeze = windFlowPeriodMs(3.6);
    const stiff = windFlowPeriodMs(12);
    expect(calm).toBeGreaterThan(6000);
    expect(breeze).toBeLessThan(calm);
    expect(stiff).toBeLessThan(breeze);
    expect(stiff).toBeLessThan(700);
    expect(windFlowPeriodMs(null)).toBe(calm);
  });
});

describe("windChevronGeometry", () => {
  it("builds a closed head and repeating chevrons that point toward the tip", () => {
    const geo = windChevronGeometry(10, 20, 80, 20);
    expect(geo.head.startsWith("M")).toBe(true);
    expect(geo.head.endsWith("Z")).toBe(true);
    expect(geo.head).toContain("L80.0,20.0");
    expect(geo.chevrons.startsWith("M")).toBe(true);
    expect((geo.chevrons.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(geo.count).toBeGreaterThanOrEqual(4);
    expect(geo.cycle).toBe(WIND_CHEVRON_STEP);
    expect(geo.cycleX).toBeCloseTo(WIND_CHEVRON_STEP, 5);
    expect(geo.cycleY).toBeCloseTo(0, 5);
    expect(geo.clip.endsWith("Z")).toBe(true);
  });

  it("lengthens a short bearing so the footer shaft can hold chevrons", () => {
    const fitted = fitWindArrow(48, 36, 54, 36, 96, 72);
    expect(Math.hypot(fitted.x2 - fitted.x1, fitted.y2 - fitted.y1)).toBeGreaterThanOrEqual(WIND_ARROW_MIN_LEN - 1);
    expect(fitted.x1).toBeGreaterThanOrEqual(6);
    expect(fitted.x2).toBeLessThanOrEqual(90);
  });

  it("rotates the travel step with the arrow direction", () => {
    const down = windChevronGeometry(40, 10, 40, 70);
    expect(down.cycleX).toBeCloseTo(0, 5);
    expect(down.cycleY).toBeCloseTo(WIND_CHEVRON_STEP, 5);
    expect(windArrowHeadPath(40, 10, 40, 70)).toContain("L40.0,70.0");
  });
});

describe("prefersReducedMotion", () => {
  it("reads the media query and stays false when matchMedia is missing", () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
  });
});
