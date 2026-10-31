import { describe, expect, it } from "vitest";
import { followLiveFromSlider, latestSampleMs, playableEndMs } from "./sessionClock";
import type { SessionBundle } from "../data/types";

function bundle(partial: Partial<SessionBundle> = {}): SessionBundle {
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: "Test",
      circuit_short_name: "Test",
      country_name: "Test",
      location: "Test",
      date_start: "2026-10-31T20:00:00.000Z",
      year: 2026,
    },
    session: {
      session_key: 1,
      meeting_key: 1,
      session_name: "Race",
      session_type: "Race",
      date_start: "2026-10-31T20:00:00.000Z",
      date_end: "2026-10-31T22:00:00.000Z",
      circuit_short_name: "Test",
      country_name: "Test",
      location: "Test",
      year: 2026,
    },
    weekendSessions: [],
    drivers: [],
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
    ...partial,
  };
}

describe("latestSampleMs / playableEndMs", () => {
  it("uses the newest interval/lap, not scheduled date_end or wall clock", () => {
    const start = Date.parse("2026-10-31T20:00:00.000Z");
    const lap66 = Date.parse("2026-10-31T21:28:00.000Z");
    const b = bundle({
      laps: [
        {
          driver_number: 1,
          lap_number: 1,
          date_start: "2026-10-31T20:00:10.000Z",
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
      intervals: [{ date: "2026-10-31T21:28:00.000Z", driver_number: 1, gap_to_leader: 0, interval: 0 }],
    });
    expect(latestSampleMs(b)).toBe(lap66);
    expect(playableEndMs(start, b)).toBe(lap66);
    expect(playableEndMs(start, b)).toBeLessThan(Date.parse(b.session.date_end));
  });
});

describe("followLiveFromSlider", () => {
  it("is false for any mid-session scrub", () => {
    expect(followLiveFromSlider(0, "live")).toBe(false);
    expect(followLiveFromSlider(0.5, "live")).toBe(false);
    expect(followLiveFromSlider(0.99, "live")).toBe(false);
    expect(followLiveFromSlider(1, "live")).toBe(true);
    expect(followLiveFromSlider(1, "historical")).toBe(false);
  });
});
