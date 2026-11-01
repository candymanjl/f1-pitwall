import { describe, expect, it } from "vitest";
import { prefersReducedMotion, windArrowPaths, windFlowPeriodMs } from "./windFlow";

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

describe("windArrowPaths", () => {
  it("builds a closed tail+head body and a flow path along the whole arrow", () => {
    const { body, flow } = windArrowPaths(10, 20, 80, 20);
    expect(body.startsWith("M")).toBe(true);
    expect(body.endsWith("Z")).toBe(true);
    expect(flow).toContain("M10.0,20.0");
    expect(flow).toContain("L80.0,20.0");
    expect(flow.match(/M/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("prefersReducedMotion", () => {
  it("reads the media query and stays false when matchMedia is missing", () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
  });
});
