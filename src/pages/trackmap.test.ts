/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import type { Driver, SessionBundle, TimingSnapshot, TowerRow } from "../data/types";
import { state } from "../state";
import { mountTrackMap } from "./trackmap";

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: "3671C6",
    first_name: code,
    last_name: code,
  };
}

function row(d: Driver, pos: number, progress: number, extra: Partial<TowerRow> = {}): TowerRow {
  return {
    pos,
    driver: d,
    compound: "MEDIUM",
    tyreAge: 4,
    lastLap: 79,
    lastLapDelta: pos === 1 ? -0.312 : 0.184,
    bestLap: 78,
    interval: pos === 1 ? null : 0.4,
    gap: pos === 1 ? 0 : pos * 0.4,
    status: "ON TRACK",
    currentLap: 1,
    s1: 22,
    s2: 29,
    s3: 26,
    s1Kind: "none",
    s2Kind: "none",
    s3Kind: "none",
    segments: [],
    inPit: false,
    retired: false,
    pitOut: false,
    pits: 0,
    progress,
    gridPos: null,
    posChange: null,
    ...extra,
  };
}

describe("track map zoom", () => {
  afterEach(() => {
    state.bundle = null;
    state.snap = null;
    state.selectedDrivers = [];
    state.selectedDriver = null;
    document.body.replaceChildren();
  });

  it("toggles a follow window around the selected driver", () => {
    const drivers = [driver(1, "VER"), driver(44, "HAM")];
    state.bundle = {
      meeting: {
        meeting_key: 1272,
        meeting_name: "Mexico City Grand Prix",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        date_start: "2025-10-26T20:00:00.000Z",
        year: 2025,
      },
      session: {
        session_key: 9877,
        meeting_key: 1272,
        session_name: "Race",
        session_type: "Race",
        date_start: "2025-10-26T20:00:00.000Z",
        date_end: "2025-10-26T22:00:00.000Z",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        year: 2025,
      },
      weekendSessions: [],
      drivers,
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
        [120, 0],
        [120, 80],
        [0, 80],
        [0, 0],
      ],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    } as SessionBundle;
    state.snap = {
      now: Date.parse("2025-10-26T20:00:12.000Z"),
      rows: [row(drivers[0], 1, 0.02), row(drivers[1], 2, 0.01)],
      leaderLap: 1,
      medianGreenLap: 80,
      weather: null,
      bestSectors: { s1: null, s2: null, s3: null },
      flagMode: "green",
      scBands: [],
      raceLaps: 71,
    } as TimingSnapshot;
    state.selectedDriver = 44;
    state.selectedDrivers = [44];

    const root = document.createElement("div");
    document.body.append(root);
    const api = mountTrackMap(root);
    const svg = root.querySelector("svg.track") as SVGSVGElement;
    Object.defineProperty(svg, "clientWidth", { value: 800 });
    Object.defineProperty(svg, "clientHeight", { value: 600 });
    api.update();
    expect(svg.dataset.zoom).toBe("full");
    expect(svg.querySelector('[data-pit="in"]')?.textContent).toContain("PIT IN");
    expect(svg.querySelector('[data-pit="out"]')?.textContent).toContain("PIT OUT");
    expect(svg.dataset.pitIn).toBe("0.9700");
    expect(svg.dataset.pitOut).toBe("0.0500");
    (state.bundle as SessionBundle).pitEntry = 0.96;
    (state.bundle as SessionBundle).pitExit = 0.06;
    api.update();
    expect(svg.dataset.pitIn).toBe("0.9600");
    expect(svg.dataset.pitOut).toBe("0.0600");
    const sf = svg.querySelector('[data-mark="S/F"]');
    const pitIn = svg.querySelector('[data-pit="in"]');
    const pitOut = svg.querySelector('[data-pit="out"]');
    const markLook = (g: Element | null) => {
      const tick = g?.querySelector("circle.map-mark-tick");
      const lab = g?.querySelector("text.map-mark-label");
      return {
        r: tick?.getAttribute("r"),
        fill: lab?.getAttribute("fill"),
        tickFill: tick?.getAttribute("fill"),
        className: lab?.getAttribute("class"),
        dx: Number(lab?.getAttribute("x")) - Number(tick?.getAttribute("cx")),
        dy: Number(lab?.getAttribute("y")) - Number(tick?.getAttribute("cy")),
        ticks: g?.querySelectorAll("line").length ?? -1,
      };
    };
    expect(markLook(pitIn)).toEqual(markLook(sf));
    expect(markLook(pitOut)).toEqual(markLook(sf));
    expect(markLook(sf).fill).toBe("#94a3b8");
    expect(markLook(sf).r).toBe("5");
    expect(markLook(sf).dx).toBe(8);
    expect(markLook(sf).dy).toBe(-8);
    expect(markLook(sf).ticks).toBe(0);
    const tower = root.querySelector("table.tower")!;
    const heads = [...tower.querySelectorAll("th")].map((th) => th.textContent);
    const lastAt = heads.indexOf("Last");
    expect(heads[lastAt + 1]).toBe("Δ");
    expect(heads[lastAt + 2]).toBe("Best");
    expect(tower.querySelector("tr[data-driver='1'] td.c-ldelta")?.textContent).toBe("-0.312");
    expect(tower.querySelector("tr[data-driver='1'] .lap-delta.faster")).toBeTruthy();
    expect(tower.querySelector("tr[data-driver='44'] td.c-ldelta")?.textContent).toBe("+0.184");
    expect(tower.querySelector("tr[data-driver='44'] .lap-delta.slower")).toBeTruthy();
    const btn = root.querySelector<HTMLButtonElement>("button.map-zoom")!;
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(svg.dataset.zoom).toBe("follow");
    expect(svg.dataset.follow).toBe("44");
    const vb = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(vb[2]).toBeLessThan(800);
    expect(vb[3]).toBeLessThan(600);
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(svg.dataset.zoom).toBe("full");
    expect(svg.getAttribute("viewBox")).toBe("0 0 800 600");
  });

  it("keeps every running car on the map, including +1 LAP traffic", () => {
    const drivers = [
      driver(16, "LEC"),
      driver(1, "VER"),
      driver(4, "NOR"),
      driver(10, "GAS"),
      driver(18, "STR"),
      driver(23, "ALB"),
      driver(43, "COL"),
      driver(6, "HAD"),
      driver(55, "SAI"),
    ];
    state.bundle = {
      meeting: {
        meeting_key: 1272,
        meeting_name: "Mexico City Grand Prix",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        date_start: "2025-10-26T20:00:00.000Z",
        year: 2025,
      },
      session: {
        session_key: 9877,
        meeting_key: 1272,
        session_name: "Race",
        session_type: "Race",
        date_start: "2025-10-26T20:00:00.000Z",
        date_end: "2025-10-26T22:00:00.000Z",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
        year: 2025,
      },
      weekendSessions: [],
      drivers,
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
        [120, 0],
        [120, 80],
        [0, 80],
        [0, 0],
      ],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    } as SessionBundle;
    const lead = [0.72, 0.7];
    const lappedProg = [0.11, 0.24, 0.37, 0.51, 0.63, 0.88];
    state.snap = {
      now: Date.parse("2025-10-26T21:35:31.000Z"),
      rows: [
        row(drivers[0], 1, lead[0], { gap: 0, status: "ON TRACK" }),
        row(drivers[1], 2, lead[1], { gap: 1.6, status: "ON TRACK" }),
        row(drivers[2], 3, lappedProg[0], { gap: "+1 LAP", status: "ON TRACK" }),
        row(drivers[3], 4, lappedProg[1], { gap: "+1 LAP", status: "ON TRACK" }),
        row(drivers[4], 5, lappedProg[2], { gap: "+1 LAP", status: "ON TRACK" }),
        row(drivers[5], 6, lappedProg[3], { gap: "+1 LAP", status: "ON TRACK" }),
        row(drivers[6], 7, lappedProg[4], { gap: "+1 LAP", status: "ON TRACK" }),
        row(drivers[7], 8, lappedProg[5], { gap: "+1 LAP", status: "ON TRACK" }),
        row(drivers[8], 9, 0.4, { gap: 12, status: "OUT", retired: true }),
      ],
      leaderLap: 68,
      medianGreenLap: 80,
      weather: null,
      bestSectors: { s1: null, s2: null, s3: null },
      flagMode: "green",
      scBands: [],
      raceLaps: 71,
    } as TimingSnapshot;

    const root = document.createElement("div");
    document.body.append(root);
    const api = mountTrackMap(root);
    const svg = root.querySelector("svg.track") as SVGSVGElement;
    Object.defineProperty(svg, "clientWidth", { value: 800 });
    Object.defineProperty(svg, "clientHeight", { value: 600 });
    api.update();
    const ids = [...svg.querySelectorAll("[data-driver]")].map((n) => n.getAttribute("data-driver"));
    expect(ids).toEqual(["16", "1", "4", "10", "18", "23", "43", "6"]);
    expect(svg.dataset.cars).toBe("8");
    expect(svg.querySelector("[data-driver='55']")).toBeNull();
    const xs = ids.map((id) => Number(svg.querySelector(`[data-driver='${id}']`)?.getAttribute("data-x")));
    expect(new Set(xs.map((x) => x.toFixed(1))).size).toBe(ids.length);
    expect(svg.querySelector("[data-driver='4'] .drv-label")?.textContent).toBe("NOR");
  });
});
