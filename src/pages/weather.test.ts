/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionBundle, TimingSnapshot, Weather } from "../data/types";
import { state } from "../state";
import { mountWeather } from "./weather";

const START = Date.parse("2025-10-26T20:00:00.000Z");

function wx(date: string, extra: Partial<Weather> = {}): Weather {
  return {
    date,
    air_temperature: 24.6,
    track_temperature: 31.8,
    wind_speed: 3.2,
    wind_direction: 315,
    humidity: 76,
    rainfall: 0,
    pressure: 1013.2,
    ...extra,
  };
}

function bundle(circuit: string, location: string, country: string): SessionBundle {
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: `${location} Grand Prix`,
      circuit_short_name: circuit,
      country_name: country,
      location,
      date_start: new Date(START).toISOString(),
      year: 2025,
    },
    session: {
      session_key: 99,
      meeting_key: 1,
      session_name: "Race",
      session_type: "Race",
      date_start: new Date(START).toISOString(),
      date_end: new Date(START + 2 * 3600_000).toISOString(),
      circuit_short_name: circuit,
      country_name: country,
      location,
      year: 2025,
    },
    weekendSessions: [],
    drivers: [],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [wx(new Date(START + 8 * 60_000).toISOString()), wx(new Date(START + 20 * 60_000).toISOString(), { rainfall: 1 })],
    raceControl: [],
    track: [
      [0, 0],
      [120, 0],
      [120, 80],
      [0, 80],
      [0, 0],
    ],
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3],
  };
}

function snap(now = START + 20 * 60_000): TimingSnapshot {
  return {
    now,
    rows: [],
    leaderLap: 12,
    medianGreenLap: 80,
    weather: wx(new Date(now).toISOString()),
    bestSectors: { s1: null, s2: null, s3: null },
    flagMode: "green",
    scBands: [],
    raceLaps: 71,
  };
}

describe("weather page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("rainviewer")) {
          return new Response(
            JSON.stringify({
              host: "https://tilecache.rainviewer.com",
              radar: { past: [{ time: 1700000000, path: "/v2/radar/test" }] },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("forecast")) {
          return new Response(
            JSON.stringify({ hourly: { time: ["2026-11-08T18:00"], precipitation_probability: [42] } }),
            { status: 200 },
          );
        }
        if (url.includes("archive")) {
          return new Response(JSON.stringify({ hourly: { time: ["2025-10-26T20:00"], precipitation: [0.4] } }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    state.bundle = null;
    state.snap = null;
    state.mode = "historical";
    document.body.replaceChildren();
  });

  it("shows OpenF1 cards and archive-unavailable on a Mexico replay", () => {
    state.mode = "historical";
    state.bundle = bundle("Mexico City", "Mexico City", "Mexico");
    state.start = START;
    state.end = START + 2 * 3600_000;
    state.t = START + 20 * 60_000;
    state.snap = snap();
    const root = document.createElement("div");
    document.body.append(root);
    const api = mountWeather(root);
    api.update();
    const page = root.querySelector(".page.weather") as HTMLElement;
    expect(page.dataset.mode).toBe("replay");
    expect(root.querySelector('[data-card="air"]')?.textContent).toMatch(/24\.6/);
    expect(root.querySelector('[data-card="rain"]')?.textContent).toMatch(/NO/);
    expect(root.querySelector('[data-radar="none"]')?.textContent).toMatch(/Radar archive unavailable/);
    expect(root.textContent).toMatch(/Open-Meteo/);
    expect(root.querySelector("nav")).toBeNull();
  });

  it("uses IEM radar on an Austin replay and RainViewer when live", async () => {
    state.mode = "historical";
    state.bundle = bundle("Austin", "Austin", "United States");
    state.start = START;
    state.end = START + 2 * 3600_000;
    state.t = START + 20 * 60_000;
    state.snap = snap();
    const root = document.createElement("div");
    document.body.append(root);
    const api = mountWeather(root);
    api.update();
    expect(root.querySelector(".page.weather")?.getAttribute("data-mode")).toBe("replay");
    expect(root.querySelector("[data-radar='iem'], .wx-iem")).toBeTruthy();

    state.mode = "live";
    api.update();
    await vi.waitFor(() => {
      expect(root.querySelector(".wx-mosaic, [data-radar='rainviewer']")).toBeTruthy();
    });
    expect(root.querySelector(".page.weather")?.getAttribute("data-mode")).toBe("live");
    expect(root.textContent).toMatch(/RainViewer/);
    expect(root.textContent).toMatch(/HEADWIND|TAILWIND|CROSSWIND/);
    expect(root.querySelector("[data-radar='none']")).toBeNull();
  });
});
