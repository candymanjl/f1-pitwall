/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { ingestLive, pinToLive, setClock, setPlaying, setScrubbing, state } from "./state";
import type { SessionBundle } from "./data/types";

const START = "2026-10-31T20:00:00.000Z";
const LAP1 = "2026-10-31T20:00:12.000Z";
const LAP66 = "2026-10-31T21:28:00.000Z";

function fixture(): SessionBundle {
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: "Mexico City Grand Prix",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      date_start: START,
      year: 2026,
    },
    session: {
      session_key: 99,
      meeting_key: 1,
      session_name: "Race",
      session_type: "Race",
      date_start: START,
      date_end: "2026-10-31T22:00:00.000Z",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      year: 2026,
    },
    weekendSessions: [],
    drivers: [],
    laps: [
      {
        driver_number: 1,
        lap_number: 1,
        date_start: LAP1,
        lap_duration: 80,
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
      },
    ],
    intervals: [{ date: LAP66, driver_number: 1, gap_to_leader: 0, interval: 0 }],
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
    ],
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3],
  };
}

afterEach(() => {
  state.bundle = null;
  state.snap = null;
  state.playing = false;
  state.followLive = false;
  state.scrubbing = false;
  state.mode = "historical";
  state.t = 0;
  state.start = 0;
  state.end = 1;
});

describe("scrub vs live ingest", () => {
  it("keeps a mid-session scrub after simulated polling/MQTT, even when Pause is on", () => {
    state.mode = "live";
    state.bundle = fixture();
    state.start = Date.parse(START);
    state.end = Date.parse(LAP66);
    state.t = Date.parse(LAP66);
    state.followLive = true;
    state.playing = false;

    setScrubbing(true);
    setClock(Date.parse(LAP1), "scrub");
    expect(state.followLive).toBe(false);
    expect(state.t).toBe(Date.parse(LAP1));

    ingestLive("v1/intervals", [
      { date: "2026-10-31T21:28:01.200Z", driver_number: 1, gap_to_leader: 0, interval: 0 },
    ]);
    ingestLive("v1/laps", {
      driver_number: 4,
      lap_number: 66,
      date_start: "2026-10-31T21:27:50.000Z",
      lap_duration: null,
    });

    expect(state.t).toBe(Date.parse(LAP1));
    expect(state.followLive).toBe(false);
    expect(state.end).toBeGreaterThan(Date.parse(LAP66));
  });

  it("jumps to the newest sample only after LIVE", () => {
    state.mode = "live";
    state.bundle = fixture();
    state.start = Date.parse(START);
    state.end = Date.parse(LAP66);
    state.t = Date.parse(LAP1);
    state.followLive = false;
    pinToLive();
    expect(state.followLive).toBe(true);
    expect(state.t).toBe(Date.parse(LAP66));
    setPlaying(true);
    ingestLive("v1/intervals", [
      { date: "2026-10-31T21:29:00.000Z", driver_number: 1, gap_to_leader: 0, interval: 0 },
    ]);
    expect(state.t).toBe(Date.parse("2026-10-31T21:29:00.000Z"));
  });
});
