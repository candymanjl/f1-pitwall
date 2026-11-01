/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { defaultTyreModel, writeTyreStore } from "../data/tyres";
import type { Driver, SessionBundle, TimingSnapshot, TowerRow } from "../data/types";
import { state } from "../state";
import { frAgainstRest, shareFromPointer } from "./strategySplit";
import { mountStrategy } from "./strategy";

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

function row(n: number, code: string): TowerRow {
  return {
    pos: n,
    driver: driver(n, code),
    compound: "MEDIUM",
    tyreAge: 8,
    lastLap: 80,
    bestLap: 79,
    interval: 1.2,
    gap: n,
    status: "ON TRACK",
    currentLap: 30,
    s1: null,
    s2: null,
    s3: null,
    s1Kind: "none",
    s2Kind: "none",
    s3Kind: "none",
    segments: [],
    inPit: false,
    retired: false,
    pitOut: false,
    pits: 1,
    progress: 0.4,
    gridPos: n,
    posChange: 0,
  };
}

function world(): { bundle: SessionBundle; snap: TimingSnapshot } {
  const session = {
    session_key: 9,
    meeting_key: 1,
    session_name: "Race",
    session_type: "Race",
    date_start: "2025-10-26T20:00:00.000Z",
    date_end: "2025-10-26T22:00:00.000Z",
    circuit_short_name: "Test",
    country_name: "Test",
    location: "Test",
    year: 2025,
  };
  const rows = [row(1, "VER"), row(16, "LEC"), row(4, "NOR")];
  const bundle = {
    meeting: {
      meeting_key: 1,
      meeting_name: "Mexico",
      circuit_short_name: "Mexico",
      country_name: "Mexico",
      location: "Mexico City",
      date_start: session.date_start,
      year: 2025,
    },
    session,
    weekendSessions: [session],
    drivers: rows.map((r) => r.driver),
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
    sectorFracs: [0.33, 0.34, 0.33] as [number, number, number],
  } satisfies SessionBundle;
  const snap: TimingSnapshot = {
    now: Date.parse("2025-10-26T21:10:00.000Z"),
    rows,
    leaderLap: 30,
    medianGreenLap: 80,
    weather: null,
    bestSectors: { s1: null, s2: null, s3: null },
    flagMode: "green",
    scBands: [],
    raceLaps: 71,
  };
  return { bundle, snap };
}

describe("strategy page", () => {
  afterEach(() => {
    state.bundle = null;
    state.snap = null;
    state.selectedDriver = null;
    state.selectedDrivers = [];
    document.body.replaceChildren();
  });

  it("splits the panels, selects a row on pointerdown, and still shows a pit plan", () => {
    writeTyreStore({ model: defaultTyreModel(), fit: null });
    const { bundle, snap } = world();
    const stints = [];
    let n = 1;
    for (const [compound, count] of [
      ["SOFT", 8],
      ["MEDIUM", 3],
      ["HARD", 2],
    ] as const) {
      for (let i = 0; i < count; i++) {
        stints.push({
          driver_number: 16,
          stint_number: n++,
          lap_start: 1,
          lap_end: 2,
          compound,
          tyre_age_at_start: 0,
        });
      }
    }
    bundle.weekendStints = stints;
    state.bundle = bundle;
    state.snap = snap;
    state.selectedDriver = 16;
    state.selectedDrivers = [16];
    const root = document.createElement("div");
    document.body.append(root);
    const api = mountStrategy(root);
    api.update();

    expect(root.querySelectorAll(".strat-split").length).toBe(2);
    expect(root.querySelector(".strat-split.x")?.getAttribute("aria-orientation")).toBe("vertical");
    expect(root.querySelector(".strat-split.y")?.getAttribute("aria-orientation")).toBe("horizontal");
    expect(root.querySelectorAll(".page.strategy .panel-b").length).toBe(3);
    expect(root.querySelector(".help")?.textContent ?? "").not.toMatch(/No legal 1\/2\/3-stop/);
    const notes = [...root.querySelectorAll(".plan-note")].map((node) => node.textContent ?? "");
    expect(notes.some((note) => /pit now/i.test(note))).toBe(true);
    expect(notes.some((note) => /alternative/i.test(note))).toBe(true);
    expect(root.textContent ?? "").not.toMatch(/No pit window inside the remaining distance/);

    const lec = root.querySelector('tr[data-driver="4"]')!;
    lec.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(state.selectedDrivers).toEqual([4]);

    const page = root.querySelector(".page.strategy") as HTMLElement;
    const handle = root.querySelector(".strat-split.x") as HTMLElement;
    page.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1400, height: 800, right: 1400, bottom: 800, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    handle.getBoundingClientRect = () =>
      ({ left: 800, top: 0, width: 8, height: 800, right: 808, bottom: 800, x: 800, y: 0, toJSON() { return {}; } }) as DOMRect;
    const before = page.style.getPropertyValue("--strat-main");
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 500 }));
    handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, button: 0, clientX: 980 }));
    handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 980 }));
    expect(page.style.getPropertyValue("--strat-main")).not.toBe(before);
  });
});

describe("strategy split fractions", () => {
  it("turns a pointer share into a fr pair", () => {
    expect(shareFromPointer(400, 0, 1000, 0.4, 0.78)).toBeCloseTo(0.4);
    expect(shareFromPointer(900, 0, 1000, 0.4, 0.78)).toBeCloseTo(0.78);
    expect(frAgainstRest(0.5)).toBeCloseTo(1);
    expect(frAgainstRest(0.6)).toBeGreaterThan(1);
  });
});
