import { describe, expect, it } from "vitest";
import { parseTs } from "../lib/time";
import { snapshotAt } from "./derive";
import { TYRE_UPDATING, resolveStint } from "./stintResolve";
import { fitLapsFromSession } from "./tyres";
import type { Driver, Lap, SessionBundle, Stint } from "./types";

function stint(partial: Partial<Stint> & Pick<Stint, "stint_number" | "compound" | "lap_start">): Stint {
  return {
    driver_number: 1,
    lap_end: null,
    tyre_age_at_start: 0,
    ...partial,
  };
}

const inter = stint({ stint_number: 1, compound: "INTERMEDIATE", lap_start: 1, lap_end: 18 });
const soft = stint({ stint_number: 2, compound: "SOFT", lap_start: 19, lap_end: 22 });

describe("resolveStint", () => {
  it("switches INTER to SOFT instead of keeping the first stint", () => {
    const live = resolveStint({ stints: [inter, soft], driver: 1, lap: 30, live: true });
    expect(live.updating).toBe(false);
    expect(live.stint?.compound).toBe("SOFT");
  });

  it("treats a lagging lap_end as still open only while live", () => {
    expect(resolveStint({ stints: [soft], driver: 1, lap: 30, live: true }).stint?.compound).toBe("SOFT");
    expect(resolveStint({ stints: [soft], driver: 1, lap: 30, live: false }).stint).toBeNull();
  });

  it("prefers the newer overlapping range", () => {
    const rows = [
      stint({ stint_number: 1, compound: "INTERMEDIATE", lap_start: 1, lap_end: 30 }),
      stint({ stint_number: 2, compound: "SOFT", lap_start: 20, lap_end: 40 }),
    ];
    expect(resolveStint({ stints: rows, driver: 1, lap: 25 }).stint?.compound).toBe("SOFT");
    expect(resolveStint({ stints: rows, driver: 1, lap: 10 }).stint?.compound).toBe("INTERMEDIATE");
  });

  it("shows updating after a pit until the new stint arrives, then the new compound", () => {
    const waiting = resolveStint({
      stints: [inter, soft],
      driver: 1,
      lap: 30,
      live: true,
      pits: [{ date: "2025-10-26T20:40:00.000Z", driver_number: 1, lap_number: 29, lane_duration: 22, pit_duration: 24, stop_duration: 2.4 }],
    });
    expect(waiting.updating).toBe(true);
    const arrived = resolveStint({
      stints: [inter, soft, stint({ stint_number: 3, compound: "MEDIUM", lap_start: 30, lap_end: 30 })],
      driver: 1,
      lap: 30,
      live: true,
      pits: [{ date: "2025-10-26T20:40:00.000Z", driver_number: 1, lap_number: 29, lane_duration: 22, pit_duration: 24, stop_duration: 2.4 }],
    });
    expect(arrived.updating).toBe(false);
    expect(arrived.stint?.compound).toBe("MEDIUM");
  });

  it("shows updating while the car is still in the pit lane", () => {
    const choice = resolveStint({ stints: [soft], driver: 1, lap: 30, live: true, inPitLane: true });
    expect(choice.updating).toBe(true);
  });

  it("keeps an unknown compound instead of substituting another stint", () => {
    const choice = resolveStint({
      stints: [
        stint({ stint_number: 1, compound: "INTERMEDIATE", lap_start: 1, lap_end: 10 }),
        stint({ stint_number: 2, compound: "EXPERIMENTAL", lap_start: 11, lap_end: 40 }),
      ],
      driver: 1,
      lap: 20,
    });
    expect(choice.stint?.compound).toBe("EXPERIMENTAL");
    expect(resolveStint({ stints: [stint({ stint_number: 1, compound: null, lap_start: 1, lap_end: 5 })], driver: 1, lap: 3 }).stint?.compound).toBeNull();
  });
});

function driver(n: number): Driver {
  return {
    driver_number: n,
    broadcast_name: "VER",
    full_name: "Max Verstappen",
    name_acronym: "VER",
    team_name: "Red Bull",
    team_colour: "3671C6",
    first_name: "Max",
    last_name: "Verstappen",
  };
}

function liveLap(n: number, start: string): Lap {
  return {
    driver_number: 1,
    lap_number: n,
    date_start: start,
    lap_duration: n >= 30 ? null : 80,
    duration_sector_1: null,
    duration_sector_2: null,
    duration_sector_3: null,
    is_pit_out_lap: false,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
  };
}

describe("live tower compound", () => {
  const now = parseTs("2025-10-26T21:00:00.000Z");

  function snap(stints: Stint[], pits: SessionBundle["pits"] = [], live = true) {
    const bundle = {
      meeting: {
        meeting_key: 1,
        meeting_name: "Mexico",
        circuit_short_name: "Mexico",
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
        circuit_short_name: "Mexico",
        country_name: "Mexico",
        location: "Mexico City",
        year: 2025,
      },
      weekendSessions: [],
      drivers: [driver(1)],
      laps: [liveLap(30, new Date(now - 20_000).toISOString())],
      intervals: [],
      positions: [],
      stints,
      weekendStints: [],
      pits,
      weather: [],
      raceControl: [],
      track: [],
      corners: [],
      sectorFracs: [0.3, 0.4, 0.3] as [number, number, number],
    } satisfies SessionBundle;
    return snapshotAt(bundle, now, { live });
  }

  it("labels the tower SOFT when the soft stint's lap_end is behind, and replay stays on the recorded range", () => {
    expect(snap([inter, soft], [], true).rows[0].compound).toBe("SOFT");
    const complete = [
      inter,
      stint({ stint_number: 2, compound: "SOFT", lap_start: 19, lap_end: 40 }),
    ];
    expect(snap(complete, [], false).rows[0].compound).toBe("SOFT");
  });

  it("shows updating on the tower after a pit with no new stint", () => {
    const row = snap([inter, soft], [
      { date: new Date(now - 5_000).toISOString(), driver_number: 1, lap_number: 29, lane_duration: 22, pit_duration: 24, stop_duration: 2.4 },
    ]).rows[0];
    expect(row.compound).toBe(TYRE_UPDATING);
    expect(row.tyreAge).toBeNull();
  });
});

describe("tyre fit stint labels", () => {
  it("labels later laps SOFT when an older open stint overlaps them", () => {
    const laps = [10, 25].map((n) => liveLap(n, new Date(n * 1000).toISOString()));
    const rows = fitLapsFromSession({
      laps,
      stints: [
        stint({ stint_number: 1, compound: "INTERMEDIATE", lap_start: 1, lap_end: null }),
        stint({ stint_number: 2, compound: "SOFT", lap_start: 20, lap_end: 40 }),
      ],
      pits: [],
      raceControl: [],
      intervals: [],
      sessionEnd: 1_000_000,
    });
    expect(rows.find((row) => row.lapNumber === 10)?.compound).toBe("INTERMEDIATE");
    expect(rows.find((row) => row.lapNumber === 25)?.compound).toBe("SOFT");
  });
});
