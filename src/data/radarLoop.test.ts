import { describe, expect, it } from "vitest";
import {
  RADAR_FRAME_MS,
  RADAR_HOLD_MS,
  formatRadarTimestamp,
  frameDelayMs,
  nearestRadarIndex,
  nextRadarIndex,
  playStartIndex,
} from "./radarLoop";

describe("radar loop timing", () => {
  it("holds the newest frame longer than the rest", () => {
    expect(frameDelayMs(0, 12, 1)).toBe(RADAR_FRAME_MS);
    expect(frameDelayMs(11, 12, 1)).toBe(RADAR_HOLD_MS);
    expect(frameDelayMs(11, 12, 2)).toBe(RADAR_HOLD_MS / 2);
    expect(frameDelayMs(3, 12, 2)).toBe(RADAR_FRAME_MS / 2);
  });

  it("wraps from the newest frame back to the oldest", () => {
    expect(nextRadarIndex(11, 12)).toBe(0);
    expect(nextRadarIndex(0, 12)).toBe(1);
    expect(playStartIndex(11, 12)).toBe(0);
    expect(playStartIndex(4, 12)).toBe(4);
  });

  it("formats a UTC frame stamp and finds the nearest time", () => {
    expect(formatRadarTimestamp(Date.parse("2026-11-08T18:40:00Z"))).toBe("2026-11-08 18:40 UTC");
    expect(nearestRadarIndex([100, 200, 300], 240)).toBe(1);
  });
});
