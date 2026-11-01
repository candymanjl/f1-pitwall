/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import type { Driver, SessionBundle, TimingSnapshot } from "../data/types";
import { state } from "../state";
import { mountRaceTrace } from "./racetrace";

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

describe("race trace controls", () => {
  afterEach(() => {
    state.bundle = null;
    state.snap = null;
    state.traceMode = "leader";
    state.traceDriver = null;
    state.selectedDrivers = [];
    state.selectedDriver = null;
    state.hiddenDrivers = [];
    document.body.replaceChildren();
  });

  it("keeps Y-axis and driver buttons clickable after a rebuild tick", () => {
    const drivers = [driver(1, "VER"), driver(44, "HAM")];
    const bundle = {
      meeting: {
        meeting_key: 1,
        meeting_name: "Mexico City Grand Prix",
        circuit_short_name: "Mexico City",
        country_name: "Mexico",
        location: "Mexico City",
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
      track: [],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3],
    } as SessionBundle;
    const snap = {
      now: Date.parse("2025-10-26T20:20:00.000Z"),
      rows: [],
      leaderLap: 12,
      medianGreenLap: 78,
      weather: null,
      bestSectors: { s1: null, s2: null, s3: null },
      flagMode: "green",
      scBands: [],
      raceLaps: 71,
    } as TimingSnapshot;
    state.bundle = bundle;
    state.snap = snap;

    const root = document.createElement("div");
    document.body.append(root);
    const api = mountRaceTrace(root);
    api.update();
    const avg = root.querySelector<HTMLButtonElement>("button[data-trace-mode='average']")!;
    const ham = root.querySelector<HTMLButtonElement>(".trace-drivers button[data-driver='44']")!;
    avg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.traceMode).toBe("average");
    api.update();
    expect(root.querySelector("button[data-trace-mode='average']")).toBe(avg);
    ham.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.selectedDrivers).toEqual([44]);
    api.update();
    expect(root.querySelector(".trace-drivers button[data-driver='44']")).toBe(ham);
    expect(ham.classList.contains("sel")).toBe(true);
    root.querySelector<HTMLButtonElement>("button[data-trace-mode='driver']")!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(state.traceMode).toBe("driver");
    api.update();
    const picker = root.querySelector<HTMLElement>(".trace-ref")!;
    expect(picker.hidden).toBe(false);
    const btn = root.querySelector<HTMLButtonElement>(".trace-ref-btn")!;
    btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const list = root.querySelector<HTMLElement>(".trace-ref-list")!;
    expect(list.hidden).toBe(false);
    expect(list.querySelectorAll(".trace-ref-opt").length).toBe(2);
    expect(list.querySelector(".swatch")).toBeTruthy();
    root.querySelector<HTMLButtonElement>(".trace-ref-opt[data-driver='44']")!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(state.traceDriver).toBe(44);
    api.update();
    expect(root.querySelector<HTMLElement>(".trace-ref-list")?.hidden).toBe(true);
    expect(root.querySelector(".trace-ref-btn .trace-ref-code")?.textContent).toBe("HAM");
  });
});
