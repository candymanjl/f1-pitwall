/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { snapshotAt } from "../data/derive";
import type { Driver, Lap, Session, SessionBundle } from "../data/types";
import { parseTs } from "../lib/time";
import { state } from "../state";
import { SEG_OVERALL, SEG_PIT, SEG_YELLOW } from "./timingSectors";
import { mountTiming } from "./timing";

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

function session(): Session {
  return {
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
  };
}

function lap(partial: Partial<Lap> & Pick<Lap, "driver_number" | "lap_number" | "date_start">): Lap {
  return {
    lap_duration: 80,
    duration_sector_1: 29.153,
    duration_sector_2: 31.804,
    duration_sector_3: 19.043,
    is_pit_out_lap: false,
    segments_sector_1: [SEG_YELLOW, SEG_YELLOW, SEG_PIT, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW],
    segments_sector_2: [SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW],
    segments_sector_3: [SEG_YELLOW, SEG_YELLOW, SEG_OVERALL, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW],
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
    ...partial,
  };
}

function bundle(laps: Lap[]): SessionBundle {
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: "Mexico",
      circuit_short_name: "Mexico",
      country_name: "Mexico",
      location: "Mexico City",
      date_start: "2025-10-26T20:00:00.000Z",
      year: 2025,
    },
    session: session(),
    weekendSessions: [],
    drivers: [driver(1, "NOR")],
    laps,
    intervals: [],
    positions: [{ date: "2025-10-26T20:00:00.000Z", driver_number: 1, position: 1 }],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track: [],
    corners: [],
    sectorFracs: [0.33, 0.34, 0.33],
  };
}

describe("timing page", () => {
  afterEach(() => {
    state.bundle = null;
    state.snap = null;
    state.selectedDriver = null;
    state.selectedDrivers = [];
    document.body.replaceChildren();
  });

  it("shows full sector times, holds the last lap, and groups mini-sectors", () => {
    const laps = [
      lap({ driver_number: 1, lap_number: 1, date_start: "2025-10-26T20:00:00.000Z" }),
      lap({
        driver_number: 1,
        lap_number: 2,
        date_start: "2025-10-26T20:01:20.000Z",
        duration_sector_1: 28.4,
        duration_sector_2: 31.2,
        duration_sector_3: 18.9,
        segments_sector_1: [SEG_OVERALL, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_YELLOW, SEG_PIT],
      }),
    ];
    const now = parseTs("2025-10-26T20:01:21.000Z");
    state.bundle = bundle(laps);
    state.snap = snapshotAt(state.bundle, now);
    const root = document.createElement("div");
    document.body.append(root);
    const api = mountTiming(root);
    api.update();

    const secs = [...root.querySelectorAll("td.c-sec")].map((cell) => cell.textContent);
    expect(secs).toEqual(["29.153", "31.804", "19.043"]);
    expect(root.querySelector("td.c-sec")?.className).toContain("sec-");
    expect(root.querySelector(".segments")).toBeNull();
    const groups = [...root.querySelectorAll(".mini-group")];
    expect(groups.map((group) => group.getAttribute("data-sector"))).toEqual(["S1", "S2", "S3"]);
    expect(groups[0].querySelectorAll(".seg").length).toBe(8);
    expect(groups[0].querySelector(".seg-yellow, .seg-overall, .seg-personal, .seg-pit")).toBeNull();
    expect(groups[2].querySelectorAll(".seg").length).toBe(6);
    expect(root.querySelector(".mini-head")?.textContent).toBe("S1S2S3");

    const later = parseTs("2025-10-26T20:02:40.000Z");
    state.snap = snapshotAt(state.bundle, later);
    api.update();
    const done = [...root.querySelectorAll("tbody tr")].at(-1)!;
    const doneSecs = [...done.querySelectorAll("td.c-sec")].map((cell) => cell.textContent);
    expect(doneSecs).toEqual(["28.400", "31.200", "18.900"]);
    expect(done.querySelector(".mini-group[data-sector='S1'] .seg-overall")).not.toBeNull();
    expect(done.querySelector(".mini-group[data-sector='S1'] .seg-pit")).not.toBeNull();
    expect(done.querySelector(".mini-group[data-sector='S3'] .seg-overall")).not.toBeNull();

    done.querySelector(".seg")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(state.selectedDrivers).toEqual([1]);
  });
});
