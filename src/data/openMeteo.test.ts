import { describe, expect, it } from "vitest";
import {
  archiveUrl,
  forecastUrl,
  interpolateMinutePoints,
  laterHourlyForecast,
  parseArchive,
  parseForecast,
  parseMinutely,
  upcomingForecast,
} from "./openMeteo";

describe("Open-Meteo URLs", () => {
  it("asks the forecast API for hourly and 15-minute precipitation probability", () => {
    const url = forecastUrl(30.13, -97.64);
    expect(url).toContain("api.open-meteo.com/v1/forecast");
    expect(url).toContain("precipitation_probability");
    expect(url).toContain("minutely_15=precipitation");
    expect(url).toContain("forecast_minutely_15=8");
  });

  it("asks the archive API for hourly precipitation", () => {
    const url = archiveUrl(19.4, -99.09, Date.parse("2025-10-26T20:00:00Z"), Date.parse("2025-10-26T22:00:00Z"));
    expect(url).toContain("archive-api.open-meteo.com/v1/archive");
    expect(url).toContain("start_date=2025-10-26");
    expect(url).toContain("precipitation");
  });
});

describe("Open-Meteo parse", () => {
  it("keeps upcoming hours and drops the distant past", () => {
    const hours = parseForecast({
      hourly: {
        time: ["2026-11-08T10:00", "2026-11-08T11:00", "2026-11-08T12:00"],
        precipitation_probability: [10, 40, 55],
      },
    });
    expect(hours[1].prob).toBe(40);
    const now = Date.parse("2026-11-08T10:50:00Z");
    expect(upcomingForecast(hours, now, 2).map((h) => h.prob)).toEqual([40, 55]);
    expect(laterHourlyForecast(hours, now).map((h) => h.prob)).toEqual([55]);
  });

  it("reads archive precipitation totals", () => {
    const rows = parseArchive({
      hourly: { time: ["2025-10-26T20:00"], precipitation: [1.2], cloud_cover: [80], wind_speed_10m: [4] },
    });
    expect(rows[0].precipMm).toBeCloseTo(1.2, 5);
  });

  it("parses 15-minute precipitation and interpolates 60 one-minute points", () => {
    const now = Date.parse("2026-11-08T18:00:00Z");
    const samples = parseMinutely({
      minutely_15: {
        time: ["2026-11-08T18:00", "2026-11-08T18:15", "2026-11-08T18:30", "2026-11-08T18:45"],
        precipitation_probability: [0, 30, 30, 0],
        precipitation: [0, 0.6, 0.6, 0],
      },
    });
    expect(samples).toHaveLength(4);
    const pts = interpolateMinutePoints(samples, now, 60);
    expect(pts).toHaveLength(60);
    expect(pts[0].prob).toBeCloseTo(0, 5);
    expect(pts[15].prob).toBeCloseTo(30, 5);
    expect(pts[7].prob).toBeGreaterThan(10);
    expect(pts[7].prob).toBeLessThan(20);
    expect(pts[22].prob).toBeLessThanOrEqual(30);
    expect(pts[22].precipMm).toBeGreaterThan(0.4);
  });
});
