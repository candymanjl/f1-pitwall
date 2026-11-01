/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { stepPlayback } from "./lib/playback";
import { applyLoadedClock, ingestLive, pinToLive, setClock, setPlaying, setScrubbing, state } from "./state";
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

  it("defaults a finished session to mid-race even when data mode is live", () => {
    const mid = "2026-10-31T20:46:52.000Z";
    const last = "2026-10-31T21:33:32.000Z";
    const b = fixture();
    b.laps = [
      { ...b.laps[0], lap_number: 1, date_start: LAP1 },
      { ...b.laps[0], lap_number: 36, date_start: mid },
      { ...b.laps[0], lap_number: 71, date_start: last },
    ];
    b.intervals = [{ date: last, driver_number: 1, gap_to_leader: 0, interval: 0 }];
    state.bundle = b;
    state.start = Date.parse(START);
    state.mode = "historical";
    applyLoadedClock();
    expect(state.t).toBe(Date.parse(mid));
    expect(state.t).toBeLessThan(state.end);
    state.mode = "live";
    applyLoadedClock();
    expect(state.t).toBe(Date.parse(mid));
    expect(state.t).toBeLessThan(state.end);
  });

  it("keeps an in-progress live session on the newest sample", () => {
    const now = Date.now();
    const start = new Date(now - 30 * 60 * 1000).toISOString();
    const latest = new Date(now - 2_000).toISOString();
    const b = fixture();
    b.session.date_start = start;
    b.session.date_end = new Date(now + 90 * 60 * 1000).toISOString();
    b.laps = [{ ...b.laps[0], lap_number: 12, date_start: latest, lap_duration: null }];
    b.intervals = [{ date: latest, driver_number: 1, gap_to_leader: 0, interval: 0 }];
    state.bundle = b;
    state.start = Date.parse(start);
    state.mode = "live";
    applyLoadedClock();
    expect(state.t).toBe(state.end);
    expect(state.t).toBe(Date.parse(latest));
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

  it("ingests against the loaded session key, not the picker", () => {
    state.mode = "live";
    state.bundle = fixture();
    state.sessionKey = 5555;
    state.start = Date.parse(START);
    state.end = Date.parse(LAP66);
    state.t = Date.parse(LAP1);
    state.followLive = false;
    state.playing = false;

    ingestLive("v1/intervals", [
      { date: "2026-10-31T21:28:04.000Z", driver_number: 1, gap_to_leader: 0, interval: 0, session_key: 99 },
    ]);
    expect(state.bundle?.intervals.some((row) => row.date === "2026-10-31T21:28:04.000Z")).toBe(true);

    ingestLive("v1/intervals", [
      { date: "2026-10-31T21:28:05.000Z", driver_number: 1, gap_to_leader: 0, interval: 0, session_key: 5555 },
    ]);
    expect(state.bundle?.intervals.some((row) => row.date === "2026-10-31T21:28:05.000Z")).toBe(false);
  });

  it("4× catch-up latches followLive and keeps playing as new rows extend the live edge", () => {
    state.mode = "live";
    state.bundle = fixture();
    state.sessionKey = 5555;
    state.start = Date.parse(START);
    state.end = Date.parse(LAP66);
    state.t = Date.parse(LAP66) - 80;
    state.followLive = false;
    state.playing = true;
    state.speed = 4;

    const next = stepPlayback({
      t: state.t,
      start: state.start,
      end: state.end,
      playing: true,
      speed: 4,
      dt: 25,
      mode: "live",
      followLive: false,
      now: Date.now(),
    });
    state.t = next.t;
    state.playing = next.playing;
    state.followLive = next.followLive;
    expect(state.followLive).toBe(true);
    expect(state.playing).toBe(true);
    expect(state.t).toBe(Date.parse(LAP66));

    const later = "2026-10-31T21:28:08.000Z";
    ingestLive("v1/location", [{ date: later, driver_number: 1, x: 10, y: 20, session_key: 99 }]);
    expect(state.end).toBe(Date.parse(later));
    expect(state.t).toBe(Date.parse(later));
    expect(state.followLive).toBe(true);
    expect(state.playing).toBe(true);
  });
});
