import { describe, expect, it } from "vitest";
import { archiveUrl, forecastUrl, parseArchive, parseForecast, upcomingForecast } from "./openMeteo";

describe("Open-Meteo URLs", () => {
  it("asks the forecast API for precipitation probability", () => {
    expect(forecastUrl(30.13, -97.64)).toContain("api.open-meteo.com/v1/forecast");
    expect(forecastUrl(30.13, -97.64)).toContain("precipitation_probability");
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
  });

  it("reads archive precipitation totals", () => {
    const rows = parseArchive({
      hourly: { time: ["2025-10-26T20:00"], precipitation: [1.2], cloud_cover: [80], wind_speed_10m: [4] },
    });
    expect(rows[0].precipMm).toBeCloseTo(1.2, 5);
  });
});
