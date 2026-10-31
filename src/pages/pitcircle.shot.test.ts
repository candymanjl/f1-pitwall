/** @vitest-environment happy-dom */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Driver, SessionBundle, TimingSnapshot, TowerRow } from "../data/types";
import { DEFAULT_PIT_LOSS } from "../config";
import { selectDriver, state } from "../state";
import { mountPitCircle } from "./pitcircle";

function driver(n: number, code: string, colour: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Team",
    team_colour: colour,
    first_name: code,
    last_name: code,
  };
}

const drivers = [
  driver(1, "VER", "3671C6"),
  driver(44, "HAM", "27F4D2"),
  driver(16, "LEC", "E8002D"),
  driver(4, "NOR", "FF8000"),
  driver(81, "PIA", "FF8000"),
  driver(63, "RUS", "27F4D2"),
  driver(55, "SAI", "E8002D"),
];

function row(d: Driver, pos: number, progress: number, extra: Partial<TowerRow> = {}): TowerRow {
  return {
    pos,
    driver: d,
    compound: "MEDIUM",
    tyreAge: 8,
    lastLap: 78.4,
    bestLap: 77.9,
    interval: pos === 1 ? null : 0.4,
    gap: pos === 1 ? 0 : pos * 1.1,
    status: extra.inPit ? "IN PIT" : "ON TRACK",
    currentLap: 18,
    s1: 23.1,
    s2: 28.2,
    s3: 26.8,
    s1Kind: "none",
    s2Kind: "none",
    s3Kind: "none",
    segments: [],
    inPit: false,
    retired: false,
    pitOut: false,
    pits: extra.pits ?? 1,
    progress,
    gridPos: null,
    posChange: null,
    ...extra,
  };
}

describe("pit circle page", () => {
  afterEach(() => {
    state.bundle = null;
    state.snap = null;
    state.selectedDrivers = [];
    state.selectedDriver = null;
    state.pitMode = "green";
    state.pitLoss = { ...DEFAULT_PIT_LOSS };
    document.body.replaceChildren();
  });

  it("draws clockwise lap progress, pit marks, on-track gaps, ghost, and tower", () => {
    const rows = [
      row(drivers[0], 1, 0.18),
      row(drivers[1], 2, 0.12),
      row(drivers[2], 3, 0.91),
      row(drivers[3], 4, 0.74),
      row(drivers[4], 5, 0.62),
      row(drivers[5], 6, 0.41),
      row(drivers[6], 7, 0.97, { inPit: true, status: "IN PIT" }),
    ];
    const bundle: SessionBundle = {
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
      pitEntry: 0.96,
      pitExit: 0.06,
    };
    const snap: TimingSnapshot = {
      now: Date.parse("2025-10-26T20:40:00.000Z"),
      rows,
      leaderLap: 18,
      medianGreenLap: 78.4,
      weather: null,
      bestSectors: { s1: null, s2: null, s3: null },
      flagMode: "green",
      scBands: [],
      raceLaps: 71,
    };
    state.bundle = bundle;
    state.snap = snap;
    state.pitMode = "green";
    selectDriver(1);

    const root = document.createElement("div");
    document.body.append(root);
    const api = mountPitCircle(root);
    const svg = root.querySelector("svg.circle") as SVGSVGElement;
    Object.defineProperty(svg, "clientWidth", { value: 640 });
    Object.defineProperty(svg, "clientHeight", { value: 620 });
    api.update();

    const text = svg.textContent ?? "";
    expect(text).toContain("S/F");
    expect(text).toContain("PIT IN");
    expect(text).toContain("PIT OUT");
    expect(text).toContain("clockwise");
    expect(text).toContain("ghost");
    expect(svg.querySelector(".pit-ghost")).toBeTruthy();
    expect(svg.querySelector(".pit-lane")).toBeTruthy();
    expect(svg.querySelectorAll(".gap-wedge").length).toBeGreaterThanOrEqual(6);
    expect(svg.querySelectorAll(".car-dot").length).toBe(7);
    expect(svg.querySelectorAll(".gap-leader").length).toBeGreaterThanOrEqual(6);
    expect(root.querySelector("table.tower")).toBeTruthy();
    expect(svg.querySelector("[data-driver='1']")?.classList.contains("on")).toBe(true);

    const green = root.querySelector<HTMLInputElement>("input[data-mode='green']");
    const vscChip = root.querySelector<HTMLElement>(".pit-delta[data-mode='vsc']");
    expect(green).toBeTruthy();
    expect(vscChip).toBeTruthy();
    const greenNode = green!;
    greenNode.value = "19.5";
    greenNode.dispatchEvent(new Event("input", { bubbles: true }));
    expect(state.pitLoss.green).toBe(19.5);
    expect(state.pitMode).toBe("green");
    vscChip!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.pitMode).toBe("vsc");
    const greenAfter = root.querySelector("input[data-mode='green']");
    expect(greenAfter).toBe(greenNode);

    const css = readFileSync(resolve("src/styles.css"), "utf8");
    writeFileSync(
      "/tmp/pit-circle-preview.html",
      `<!doctype html><html><head><meta charset="utf-8"><title>Pit circle</title>
<style>${css}
  html,body{margin:0;background:#07080d;height:auto}
  #app{height:auto}
  .shot{width:1280px;height:800px;padding:16px;box-sizing:border-box}
  .page.pitcircle{height:760px;display:grid;grid-template-columns:420px 1fr;gap:10px}
  svg.circle{position:absolute;inset:0;width:100%;height:100%}
</style></head><body><div class="shot">${root.innerHTML}</div></body></html>`,
    );
  });
});
