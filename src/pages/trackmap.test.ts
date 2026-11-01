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

function row(d: Driver, pos: number, progress: number): TowerRow {
  return {
    pos,
    driver: d,
    compound: "MEDIUM",
    tyreAge: 4,
    lastLap: 79,
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
});
