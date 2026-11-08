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
              radar: {
                past: [
                  { time: 1700000000, path: "/v2/radar/a" },
                  { time: 1700000600, path: "/v2/radar/b" },
                  { time: 1700001200, path: "/v2/radar/c" },
                  { time: 1700001800, path: "/v2/radar/d" },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("forecast")) {
          const t0 = Math.floor(Date.now() / (15 * 60_000)) * 15 * 60_000;
          return new Response(
            JSON.stringify({
              hourly: {
                time: Array.from({ length: 8 }, (_, i) => new Date(t0 + i * 3600_000).toISOString().slice(0, 16)),
                precipitation_probability: [12, 24, 36, 48, 40, 28, 18, 10],
              },
              minutely_15: {
                time: Array.from({ length: 8 }, (_, i) => new Date(t0 + i * 15 * 60_000).toISOString().slice(0, 16)),
                precipitation: [0, 0.2, 0.4, 0.6, 0.5, 0.3, 0.1, 0],
                precipitation_probability: [10, 22, 38, 55, 48, 30, 18, 8],
              },
            }),
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
    try {
      localStorage.removeItem("f1pitwall.radarRange");
    } catch {
      /* ignore */
    }
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
    expect(root.querySelector("[data-radar='iem'], img.wx-iem")).toBeTruthy();

    state.mode = "live";
    api.update();
    await vi.waitFor(() => {
      expect(root.querySelector(".wx-mosaic.on, .wx-mosaic[data-radar='rainviewer']")).toBeTruthy();
    });
    expect(root.querySelector(".page.weather")?.getAttribute("data-mode")).toBe("live");
    expect(root.textContent).toMatch(/RainViewer/);
    expect(root.textContent).toMatch(/HEADWIND|TAILWIND|CROSSWIND/);
    expect(root.querySelector("[data-radar='none']")).toBeNull();
    expect(root.querySelector("svg.wx-radar-overlay")).toBeNull();
    expect(root.querySelector("[data-radar-outline]")).toBeNull();
  });

  it("loops RainViewer frames from Play and interpolates the next-hour forecast line", async () => {
    state.mode = "live";
    state.bundle = bundle("Interlagos", "São Paulo", "Brazil");
    state.start = Date.now() - 30 * 60_000;
    state.end = Date.now() + 60 * 60_000;
    state.t = Date.now();
    state.snap = snap(state.t);
    const root = document.createElement("div");
    document.body.append(root);
    const api = mountWeather(root);
    api.update();
    await vi.waitFor(() => {
      expect(root.querySelector(".wx-mosaic.wx-radar-layer")).toBeTruthy();
    });
    const player = root.querySelector(".wx-radar") as HTMLElement;
    expect(player.dataset.radarPlaying).toBe("false");
    expect(player.dataset.radarIndex).toBe("3");
    expect(root.querySelector("[data-radar-time]")?.textContent).toMatch(/UTC/);
    (root.querySelector("[data-radar-play]") as HTMLButtonElement).click();
    expect(player.dataset.radarPlaying).toBe("true");
    expect(player.dataset.radarIndex).toBe("0");
    const scrub = root.querySelector("[data-radar-scrub]") as HTMLInputElement;
    scrub.value = "2";
    scrub.dispatchEvent(new Event("input"));
    expect(player.dataset.radarPlaying).toBe("false");
    expect(player.dataset.radarIndex).toBe("2");
    await vi.waitFor(() => {
      expect(root.querySelector("[data-forecast='minute']")).toBeTruthy();
    });
    expect(root.querySelector("[data-forecast-note='minute']")?.textContent).toMatch(/Estimated 1 minute line/);
    expect(root.querySelector("[data-forecast-note='minute']")?.textContent).toMatch(/Model data, not radar/);
    expect(root.textContent).toMatch(/Later hours/);
    expect(root.textContent).toMatch(/Open-Meteo/);
    expect(root.querySelector("svg.wx-radar-overlay, [data-radar-outline], [data-radar-car]")).toBeNull();
    const btn50 = root.querySelector("button[data-radar-view='50']") as HTMLButtonElement;
    const btn15 = root.querySelector("button[data-radar-view='15']") as HTMLButtonElement;
    expect(btn50.textContent).toBe("50 mi");
    expect(btn15.textContent).toBe("15 mi");
    expect(player.dataset.radarView).toBe("50");
    expect(player.dataset.radarSmooth).toBe("off");
    expect(root.querySelector(".wx-mosaic img")?.getAttribute("src")).toMatch(/\/256\/7\//);
    const scale50 = Number(player.dataset.radarScale);
    btn15.click();
    expect(player.dataset.radarView).toBe("15");
    expect(player.dataset.radarSmooth).toBe("on");
    expect(Number(player.dataset.radarScale)).toBeGreaterThan(scale50);
    expect(root.querySelector("[data-radar-scalebar]")?.textContent).toMatch(/3 mi/);
    btn50.click();
    expect(player.dataset.radarView).toBe("50");
    expect(player.dataset.radarSmooth).toBe("off");
    expect(root.querySelector("[data-radar-scalebar]")?.textContent).toMatch(/10 mi/);
  });

  it("offers an IEM play/pause loop on an Austin replay", () => {
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
    expect(root.querySelector("[data-radar-play]")).toBeTruthy();
    expect(root.querySelectorAll("img.wx-iem.wx-radar-layer").length).toBeGreaterThan(2);
    expect(root.querySelector(".wx-radar")?.getAttribute("data-radar-playing")).toBe("false");
  });
});
