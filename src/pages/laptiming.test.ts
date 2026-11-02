/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotAt } from "../data/derive";
import type { Driver, Lap, SessionBundle } from "../data/types";
import { setLapTimingDrivers, setLapTimingView, state } from "../state";
import { mountLapTiming } from "./laptiming";

function driver(n: number, code: string, team: string, colour: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: team,
    team_colour: colour,
    first_name: code,
    last_name: code,
  };
}

function lap(partial: Partial<Lap> & { driver_number: number; lap_number: number }): Lap {
  return {
    date_start: "2026-11-01T20:00:00.000Z",
    lap_duration: 80,
    duration_sector_1: 22,
    duration_sector_2: 30,
    duration_sector_3: 28,
    is_pit_out_lap: false,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: 280,
    i2_speed: 300,
    st_speed: 330,
    ...partial,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  state.bundle = null;
  state.snap = null;
  state.lapTimingDrivers = [];
  state.lapTimingView = "both";
  state.mode = "historical";
});

describe("Lap timing page", () => {
  it("does not fetch and shows an empty prompt before Load", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const host = document.createElement("div");
    document.body.append(host);
    const api = mountLapTiming(host);
    api.update();
    expect(host.textContent).toMatch(/Load a session/);
    expect(host.querySelector(".lt-empty")?.hasAttribute("hidden")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("renders three views and stripes the McLaren teammate", () => {
    const start = Date.parse("2026-11-01T20:00:00.000Z");
    const t = (n: number) => new Date(start + n * 80_000).toISOString();
    const drivers = [
      driver(4, "NOR", "McLaren", "FF8000"),
      driver(16, "LEC", "Ferrari", "E8002D"),
      driver(81, "PIA", "McLaren", "FF8000"),
    ];
    const bundle: SessionBundle = {
      meeting: {
        meeting_key: 1,
        meeting_name: "Mexico City Grand Prix",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        date_start: new Date(start).toISOString(),
        year: 2026,
      },
      session: {
        session_key: 99,
        meeting_key: 1,
        session_name: "Race",
        session_type: "Race",
        date_start: new Date(start).toISOString(),
        date_end: new Date(start + 90 * 60 * 1000).toISOString(),
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        year: 2026,
      },
      weekendSessions: [],
      drivers,
      laps: drivers.flatMap((d) =>
        [1, 2, 3].map((n) =>
          lap({
            driver_number: d.driver_number,
            lap_number: n,
            date_start: t(n),
            lap_duration: 79 + d.driver_number / 100,
          }),
        ),
      ),
      intervals: [],
      positions: drivers.map((d, i) => ({
        date: new Date(start).toISOString(),
        driver_number: d.driver_number,
        position: i + 1,
      })),
      stints: drivers.map((d) => ({
        driver_number: d.driver_number,
        stint_number: 1,
        lap_start: 1,
        lap_end: 3,
        compound: "MEDIUM",
        tyre_age_at_start: 0,
      })),
      weekendStints: [],
      pits: [],
      weather: [],
      raceControl: [],
      track: [],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    };
    state.bundle = bundle;
    state.t = start + 400_000;
    state.snap = snapshotAt(bundle, state.t);
    state.lapTimingDrivers = [4, 16, 81];
    const host = document.createElement("div");
    document.body.append(host);
    const api = mountLapTiming(host);
    api.update();
    expect(host.querySelectorAll(".lt-drv").length).toBe(3);
    expect(host.querySelector(".lt-drv.lt-stripe .lt-code")?.textContent).toBe("PIA");
    expect(host.querySelector(".lt-chip.lt-stripe")?.textContent).toBe("PIA");
    expect(host.querySelector(".lt-card.lt-stripe")).toBeTruthy();
    expect((host.querySelector(".lt-chart") as HTMLElement).hidden).toBe(false);
    expect((host.querySelector(".lt-table-panel") as HTMLElement).hidden).toBe(false);
    expect(host.textContent).toMatch(/Δ PIA−NOR/);

    setLapTimingView("chart");
    api.update();
    expect((host.querySelector(".lt-chart") as HTMLElement).hidden).toBe(false);
    expect((host.querySelector(".lt-table-panel") as HTMLElement).hidden).toBe(true);

    setLapTimingView("table");
    api.update();
    expect((host.querySelector(".lt-chart") as HTMLElement).hidden).toBe(true);
    expect((host.querySelector(".lt-table-panel") as HTMLElement).hidden).toBe(false);

    setLapTimingDrivers([4]);
    api.update();
    expect(host.textContent).toMatch(/TRAP/);
    expect(host.querySelector(".lt-drv.lt-stripe")).toBeNull();
  });

  it("paints the lap table on the first update without a view toggle", () => {
    const start = Date.parse("2026-11-01T20:00:00.000Z");
    const drivers = [
      driver(16, "LEC", "Ferrari", "E8002D"),
      driver(1, "VER", "Red Bull", "3671C6"),
      driver(12, "ANT", "Mercedes", "27F4D2"),
    ];
    const bundle: SessionBundle = {
      meeting: {
        meeting_key: 1,
        meeting_name: "Mexico City Grand Prix",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        date_start: new Date(start).toISOString(),
        year: 2026,
      },
      session: {
        session_key: 99,
        meeting_key: 1,
        session_name: "Race",
        session_type: "Race",
        date_start: new Date(start).toISOString(),
        date_end: new Date(start + 90 * 60 * 1000).toISOString(),
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        year: 2026,
      },
      weekendSessions: [],
      drivers,
      laps: drivers.flatMap((d) =>
        [1, 2, 3, 36].map((n) =>
          lap({
            driver_number: d.driver_number,
            lap_number: n,
            date_start: new Date(start + n * 80_000).toISOString(),
            lap_duration: 79 + d.driver_number / 100,
          }),
        ),
      ),
      intervals: [],
      positions: drivers.map((d, i) => ({
        date: new Date(start).toISOString(),
        driver_number: d.driver_number,
        position: i + 1,
      })),
      stints: drivers.map((d) => ({
        driver_number: d.driver_number,
        stint_number: 1,
        lap_start: 1,
        lap_end: 36,
        compound: "MEDIUM",
        tyre_age_at_start: 0,
      })),
      weekendStints: [],
      pits: [],
      weather: [],
      raceControl: [],
      track: [],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    };
    state.bundle = bundle;
    state.t = start + 36 * 80_000;
    state.snap = snapshotAt(bundle, state.t);
    state.lapTimingDrivers = [];
    state.lapTimingView = "both";
    const host = document.createElement("div");
    document.body.append(host);
    const api = mountLapTiming(host);
    api.update();
    expect(host.querySelector(".lt-table tbody tr")).toBeTruthy();
    expect(host.querySelectorAll(".lt-table tbody tr").length).toBe(4);
    expect(host.querySelector(".lt-chip")?.textContent).toBe("LEC");
    expect((host.querySelector(".lt-chart") as HTMLElement).hidden).toBe(false);
    expect((host.querySelector(".lt-table-panel") as HTMLElement).hidden).toBe(false);

    host.querySelector(".lt-table-wrap")!.replaceChildren();
    expect(host.querySelector(".lt-table tbody tr")).toBeNull();
    api.update();
    expect(host.querySelectorAll(".lt-table tbody tr").length).toBe(4);

    setLapTimingView("table");
    api.update();
    expect((host.querySelector(".lt-table-panel") as HTMLElement).hidden).toBe(false);
    expect(host.querySelectorAll(".lt-table tbody tr").length).toBe(4);

    setLapTimingDrivers([16, 1, 12]);
    api.update();
    expect(host.textContent).toMatch(/Δ VER−LEC/);
    expect(host.textContent).toMatch(/Δ ANT−LEC/);
    expect(host.querySelectorAll(".lt-table tbody tr").length).toBe(4);
    const ages = [...host.querySelectorAll(".lt-table .tyre-age-n")].map((n) => n.textContent ?? "");
    expect(ages.some((a) => a.length === 1)).toBe(true);
    expect(ages.some((a) => a.length === 2)).toBe(true);
    expect(host.querySelectorAll(".lt-table .tyre-age").length).toBe(ages.length);
    expect(host.querySelectorAll(".lt-table th.lt-tyre-col").length).toBe(3);
  });

  it("paints a single leader with missing sector classes in live mode", () => {
    const start = Date.parse("2026-11-01T20:00:00.000Z");
    const ant = driver(12, "ANT", "Mercedes", "27F4D2");
    const bundle: SessionBundle = {
      meeting: {
        meeting_key: 1,
        meeting_name: "Mexico City Grand Prix",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        date_start: new Date(start).toISOString(),
        year: 2026,
      },
      session: {
        session_key: 99,
        meeting_key: 1,
        session_name: "Race",
        session_type: "Race",
        date_start: new Date(start).toISOString(),
        date_end: new Date(start + 90 * 60 * 1000).toISOString(),
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        year: 2026,
      },
      weekendSessions: [],
      drivers: [ant],
      laps: [
        lap({
          driver_number: 12,
          lap_number: 35,
          date_start: new Date(start + 35 * 80_000).toISOString(),
          lap_duration: 79.5,
        }),
        lap({
          driver_number: 12,
          lap_number: 36,
          date_start: new Date(start + 36 * 80_000).toISOString(),
          lap_duration: 79.4,
          duration_sector_3: null,
        }),
        lap({
          driver_number: 12,
          lap_number: 37,
          date_start: new Date(start + 37 * 80_000).toISOString(),
          lap_duration: null,
          duration_sector_1: 21.7,
          duration_sector_2: null,
          duration_sector_3: null,
        }),
      ],
      intervals: [],
      positions: [{ date: new Date(start).toISOString(), driver_number: 12, position: 1 }],
      stints: [{ driver_number: 12, stint_number: 1, lap_start: 1, lap_end: 71, compound: "HARD", tyre_age_at_start: 0 }],
      weekendStints: [],
      pits: [],
      weather: [],
      raceControl: [],
      track: [],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    };
    state.bundle = bundle;
    state.mode = "live";
    state.t = start + 37 * 80_000 + 15_000;
    state.snap = snapshotAt(bundle, state.t);
    state.lapTimingDrivers = [12];
    state.lapTimingView = "both";
    const host = document.createElement("div");
    document.body.append(host);
    const api = mountLapTiming(host);
    expect(() => api.update()).not.toThrow();
    expect(host.querySelector(".lt-chip")?.textContent).toBe("ANT");
    expect(host.querySelector(".lt-drv.lt-stripe")).toBeNull();
    expect(host.textContent).toMatch(/TRAP/);
    expect(host.textContent).toMatch(/LEADER/);
    expect(host.querySelectorAll(".lt-table tbody tr").length).toBe(3);
    expect((host.querySelector(".lt-chart") as HTMLElement).hidden).toBe(false);
    expect(host.querySelector(".lt-svg")?.childNodes.length).toBeGreaterThan(0);

    for (const view of ["chart", "table", "both"] as const) {
      setLapTimingView(view);
      expect(() => api.update()).not.toThrow();
      if (view !== "chart") {
        expect(host.querySelectorAll(".lt-table tbody tr").length).toBe(3);
      }
    }
  });
});
