import { describe, expect, it } from "vitest";
import { parseTs } from "./time";

describe("parseTs", () => {
  it("reads OpenF1 microseconds and treats naive ISO as UTC", () => {
    const utc = Date.parse("2026-11-06T15:31:02.019Z");
    expect(parseTs("2026-11-06T15:31:02.019000+00:00")).toBe(utc);
    expect(parseTs("2026-11-06T15:31:02.019000Z")).toBe(utc);
    expect(parseTs("2026-11-06T15:31:02.019000")).toBe(utc);
    expect(parseTs("2026-11-06 15:31:02.019000")).toBe(utc);
    expect(parseTs("2026-11-06T15:30:00+00:00")).toBe(Date.parse("2026-11-06T15:30:00.000Z"));
  });

  it("does not shift zoned stamps into the local timezone", () => {
    const zoned = parseTs("2026-11-06T15:32:52.806000+00:00");
    const start = parseTs("2026-11-06T15:30:00+00:00");
    expect(zoned - start).toBe(Date.parse("2026-11-06T15:32:52.806Z") - Date.parse("2026-11-06T15:30:00.000Z"));
    expect(zoned - start).toBeLessThan(3 * 60 * 1000);
  });

  it("returns NaN for empty values", () => {
    expect(Number.isNaN(parseTs(null))).toBe(true);
    expect(Number.isNaN(parseTs(""))).toBe(true);
    expect(Number.isNaN(parseTs("   "))).toBe(true);
  });
});
