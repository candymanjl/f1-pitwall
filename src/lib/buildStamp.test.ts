import { describe, expect, it } from "vitest";
import { formatBuildStamp } from "./buildStamp";

describe("formatBuildStamp", () => {
  it("formats a short SHA and America/New_York wall time", () => {
    // 2026-11-02 12:55 PM EST (DST already ended that year).
    expect(formatBuildStamp("a1b2c3def456", new Date("2026-11-02T17:55:00.000Z"))).toBe(
      "v a1b2c3d · Nov 2 12:55 PM ET",
    );
  });

  it("falls back to dev when the SHA is missing", () => {
    expect(formatBuildStamp("", new Date("2026-11-02T17:55:00.000Z"))).toMatch(/^v dev · /);
  });
});
