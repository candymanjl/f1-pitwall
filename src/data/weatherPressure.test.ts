import { describe, expect, it } from "vitest";
import type { Weather } from "./types";
import {
  earlierPressureSample,
  formatPressure,
  pressureTrendMark,
  weatherPressureAt,
} from "./weatherPressure";

function wx(date: string, pressure: number | null): Weather {
  return {
    date,
    air_temperature: 21,
    track_temperature: 38,
    wind_speed: 3,
    wind_direction: 200,
    humidity: 40,
    rainfall: 0,
    pressure,
  };
}

const T0 = Date.parse("2025-10-26T20:20:00.000Z");

describe("weather pressure trend", () => {
  it("rises, falls, or stays flat versus the 10–15 minute sample", () => {
    const rows = [
      wx("2025-10-26T20:07:30.000Z", 1010.2),
      wx("2025-10-26T20:20:00.000Z", 1013.1),
    ];
    expect(weatherPressureAt(rows, T0)).toEqual({ value: 1013.1, trend: "up" });
    expect(weatherPressureAt([wx("2025-10-26T20:07:00.000Z", 1013.4), wx("2025-10-26T20:20:00.000Z", 1010.1)], T0)).toEqual({
      value: 1010.1,
      trend: "down",
    });
    expect(weatherPressureAt([wx("2025-10-26T20:08:00.000Z", 1012.8), wx("2025-10-26T20:20:00.000Z", 1013.1)], T0)).toEqual({
      value: 1013.1,
      trend: "steady",
    });
  });

  it("uses the sample closest to 12.5 minutes earlier and ignores a 0.5 mbar wobble", () => {
    const rows = [
      wx("2025-10-26T20:05:00.000Z", 1008),
      wx("2025-10-26T20:07:30.000Z", 1010),
      wx("2025-10-26T20:10:00.000Z", 1012),
      wx("2025-10-26T20:20:00.000Z", 1010.4),
    ];
    const earlier = earlierPressureSample(rows, T0);
    expect(earlier?.date).toBe("2025-10-26T20:07:30.000Z");
    expect(weatherPressureAt(rows, T0).trend).toBe("steady");
  });

  it("follows the playhead and has no trend until a 10-minute baseline exists", () => {
    const rows = [
      wx("2025-10-26T20:00:00.000Z", 1010),
      wx("2025-10-26T20:08:00.000Z", 1014),
      wx("2025-10-26T20:20:00.000Z", 1008),
    ];
    expect(weatherPressureAt(rows, Date.parse("2025-10-26T20:08:00.000Z"))).toEqual({ value: 1014, trend: null });
    expect(weatherPressureAt(rows, T0)).toEqual({ value: 1008, trend: "down" });
    expect(weatherPressureAt(rows, Date.parse("2025-10-26T19:50:00.000Z"))).toEqual({ value: null, trend: null });
  });

  it("skips null pressure rows and formats the readout", () => {
    const rows = [wx("2025-10-26T20:07:00.000Z", null), wx("2025-10-26T20:20:00.000Z", 778.5)];
    expect(weatherPressureAt(rows, T0)).toEqual({ value: 778.5, trend: null });
    expect(formatPressure(1013)).toBe("1013 mbar");
    expect(formatPressure(778.5)).toBe("778.5 mbar");
    expect(formatPressure(null)).toBe("— mbar");
    expect(pressureTrendMark("up")).toBe("↑");
    expect(pressureTrendMark("down")).toBe("↓");
    expect(pressureTrendMark("steady")).toBe("–");
    expect(pressureTrendMark(null)).toBe("–");
  });
});
