/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Driver, TimingSnapshot, TowerRow } from "../data/types";
import { state } from "../state";
import { mountStatusBar } from "./statusbar";

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: "e10600",
    first_name: code,
    last_name: code,
  };
}

function row(n: number, code: string, pos: number, gap: number | null): TowerRow {
  return {
    pos,
    driver: driver(n, code),
    compound: "MEDIUM",
    tyreAge: 4,
    lastLap: 79,
    bestLap: 78,
    interval: pos === 1 ? null : 0.3,
    gap,
    status: "ON TRACK",
    currentLap: 12,
    s1: 22.1,
    s2: 29.2,
    s3: 26.4,
    s1Kind: "overall",
    s2Kind: "none",
    s3Kind: "none",
    segments: [],
    inPit: false,
    retired: false,
    pitOut: false,
    pits: 0,
    progress: 0.2,
    gridPos: null,
    posChange: null,
  };
}

function snap(): TimingSnapshot {
  return {
    now: Date.parse("2025-10-26T20:20:00.000Z"),
    rows: [row(1, "VER", 1, 0), row(44, "HAM", 2, 2.4)],
    leaderLap: 12,
    medianGreenLap: 78.5,
    weather: {
      date: "2025-10-26T20:20:00.000Z",
      air_temperature: 21.4,
      track_temperature: 38.2,
      wind_speed: 3.6,
      wind_direction: 210,
      humidity: 44,
      rainfall: 0,
    },
    bestSectors: {
      s1: { time: 22.104, code: "VER" },
      s2: { time: 29.201, code: "HAM" },
      s3: { time: 26.4, code: "LEC" },
    },
    flagMode: "green",
    scBands: [],
    raceLaps: 71,
  };
}

describe("mountStatusBar", () => {
  afterEach(() => {
    state.snap = null;
    state.bundle = null;
    state.selectedDrivers = [];
    state.selectedDriver = null;
  });

  it("renders best sectors, gap strip, weather, and a wind map", async () => {
    const host = document.createElement("div");
    const api = mountStatusBar(host);
    state.snap = snap();
    state.bundle = {
      meeting: {
        meeting_key: 1,
        meeting_name: "Test GP",
        circuit_short_name: "Test",
        country_name: "Test",
        location: "Test",
        date_start: "2025-10-26T20:00:00.000Z",
        year: 2025,
      },
      session: {
        session_key: 1,
        meeting_key: 1,
        session_name: "Race",
        session_type: "Race",
        date_start: "2025-10-26T20:00:00.000Z",
        date_end: "2025-10-26T22:00:00.000Z",
        circuit_short_name: "Test",
        country_name: "Test",
        location: "Test",
        year: 2025,
      },
      weekendSessions: [],
      drivers: [driver(1, "VER"), driver(44, "HAM")],
      laps: [],
      intervals: [],
      positions: [],
      stints: [],
      weekendStints: [],
      pits: [],
      weather: [],
      raceControl: [],
      track: [
        [0, 0],
        [100, 0],
        [100, 80],
        [0, 80],
        [0, 0],
      ],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    };
    api.update();
    const root = host.querySelector(".statusbar")!;
    expect(root.textContent).toContain("Best sectors");
    expect(root.textContent).toContain("VER");
    expect(root.textContent).toContain("Air 21.4°C");
    expect(root.textContent).toContain("Wind 3.6 m/s 210°");
    const strip = root.querySelector("canvas.gapline") as HTMLCanvasElement;
    expect(strip).toBeTruthy();
    expect(root.querySelector("svg.wind-map")).toBeTruthy();
    const sf = Number(strip.dataset.sf);
    expect(strip.dataset.mode).toBe("track");
    expect(sf).toBeGreaterThan(40);
    expect(Math.abs(sf - (strip.clientWidth || 400) / 2)).toBeLessThan(30);
    expect(Number(strip.dataset.pitIn)).not.toBe(sf);
    expect(Number(strip.dataset.pitOut)).not.toBe(sf);
  });

  it("draws a thick flowing wind arrow whose period follows wind_speed", async () => {
    const host = document.createElement("div");
    const api = mountStatusBar(host);
    state.snap = snap();
    state.bundle = {
      meeting: {
        meeting_key: 1,
        meeting_name: "Test GP",
        circuit_short_name: "Test",
        country_name: "Test",
        location: "Test",
        date_start: "2025-10-26T20:00:00.000Z",
        year: 2025,
      },
      session: {
        session_key: 1,
        meeting_key: 1,
        session_name: "Race",
        session_type: "Race",
        date_start: "2025-10-26T20:00:00.000Z",
        date_end: "2025-10-26T22:00:00.000Z",
        circuit_short_name: "Test",
        country_name: "Test",
        location: "Test",
        year: 2025,
      },
      weekendSessions: [],
      drivers: [driver(1, "VER"), driver(44, "HAM")],
      laps: [],
      intervals: [],
      positions: [],
      stints: [],
      weekendStints: [],
      pits: [],
      weather: [],
      raceControl: [],
      track: [
        [0, 0],
        [100, 0],
        [100, 80],
        [0, 80],
        [0, 0],
      ],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    };
    api.update();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const svg = host.querySelector("svg.wind-map") as SVGSVGElement;
    const head = svg.querySelector(".wind-arrow-head");
    const chevrons = svg.querySelector(".wind-arrow-chevrons");
    expect(head).toBeTruthy();
    expect(chevrons).toBeTruthy();
    expect(head!.getAttribute("d") ?? "").toMatch(/Z$/);
    expect((chevrons!.getAttribute("d") ?? "").startsWith("M")).toBe(true);
    expect((chevrons!.getAttribute("d") ?? "").match(/M/g)?.length).toBeGreaterThanOrEqual(3);
    expect(svg.dataset.wind).toBe("chevrons");
    expect(svg.style.getPropertyValue("--wind-flow-ms")).toMatch(/ms/);
    expect(svg.style.getPropertyValue("--wind-tx")).toMatch(/px/);
    expect(svg.style.getPropertyValue("--wind-ty")).toMatch(/px/);
    const breeze = Number.parseInt(svg.style.getPropertyValue("--wind-flow-ms"), 10);
    state.snap = { ...snap(), weather: { ...snap().weather!, wind_speed: 0 } };
    api.update();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const calm = Number.parseInt(svg.style.getPropertyValue("--wind-flow-ms"), 10);
    expect(calm).toBeGreaterThan(breeze);
    expect(host.querySelector(".wind-arrow-chevrons")).toBe(chevrons);
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/@keyframes wind-chevrons/);
  });
});
