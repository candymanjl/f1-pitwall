import { describe, expect, it } from "vitest";
import { rainObservedBuckets, weatherHistoryUpTo, windFromLabel } from "./weatherView";
import type { Weather } from "./types";

function wx(date: string, rain = 0, extra: Partial<Weather> = {}): Weather {
  return {
    date,
    air_temperature: 24,
    track_temperature: 32,
    wind_speed: 3,
    wind_direction: 315,
    humidity: 70,
    rainfall: rain,
    ...extra,
  };
}

describe("weather view", () => {
  it("labels meteorological FROM as a compass point", () => {
    expect(windFromLabel(0)).toBe("N");
    expect(windFromLabel(315)).toBe("NW");
  });

  it("drops OpenF1 samples after the playhead", () => {
    const rows = [
      wx("2025-10-26T20:00:00.000Z"),
      wx("2025-10-26T20:10:00.000Z", 1),
      wx("2025-10-26T20:20:00.000Z"),
    ];
    const now = Date.parse("2025-10-26T20:12:00.000Z");
    expect(weatherHistoryUpTo(rows, now)).toHaveLength(2);
    const buckets = rainObservedBuckets(rows, Date.parse("2025-10-26T20:00:00.000Z"), Date.parse("2025-10-26T21:00:00.000Z"), now, 6);
    expect(buckets.some(Boolean)).toBe(true);
    const later = rainObservedBuckets(rows, Date.parse("2025-10-26T20:00:00.000Z"), Date.parse("2025-10-26T21:00:00.000Z"), Date.parse("2025-10-26T20:05:00.000Z"), 6);
    expect(later.every((v) => !v)).toBe(true);
  });
});
