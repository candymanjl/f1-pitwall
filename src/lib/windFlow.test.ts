import { describe, expect, it } from "vitest";
import { prefersReducedMotion, windFlowPeriodMs } from "./windFlow";

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

describe("prefersReducedMotion", () => {
  it("reads the media query and stays false when matchMedia is missing", () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
    expect(prefersReducedMotion(undefined)).toBe(false);
  });
});
