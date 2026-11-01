import { describe, expect, it } from "vitest";
import {
  followLiveFromSlider,
  historicalStartMs,
  isFinishedSession,
  latestSampleMs,
  LIVE_SESSION_GRACE_MS,
  playableEndMs,
} from "./sessionClock";
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

  it("advances the playable end when GPS or car_data arrives after the last lap", () => {
    const start = Date.parse("2026-10-31T20:00:00.000Z");
    const gps = "2026-10-31T21:28:04.400Z";
    const car = "2026-10-31T21:28:05.200Z";
    const b = bundle({
      intervals: [{ date: "2026-10-31T21:28:00.000Z", driver_number: 1, gap_to_leader: 0, interval: 0 }],
      locations: [{ date: gps, driver_number: 1, x: 1, y: 2 }],
    });
    expect(latestSampleMs(b)).toBe(Date.parse(gps));
    expect(playableEndMs(start, b)).toBe(Date.parse(gps));
    b.carData = [{ date: car, driver_number: 1, speed: 280, throttle: 99, brake: 0, n_gear: 7, rpm: 11000, drs: 0 }];
    expect(latestSampleMs(b)).toBe(Date.parse(car));
  });
});

function lap(n: number, date: string) {
  return {
    driver_number: 1,
    lap_number: n,
    date_start: date,
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
  };
}

describe("historicalStartMs", () => {
  it("opens on the mid race lap, not the end", () => {
    const start = Date.parse("2025-10-26T20:00:00.000Z");
    const mid = Date.parse("2025-10-26T20:46:52.000Z");
    const end = Date.parse("2025-10-26T21:33:32.000Z");
    const t = historicalStartMs(
      start,
      end,
      bundle({
        laps: [
          lap(1, "2025-10-26T20:00:12.000Z"),
          lap(36, "2025-10-26T20:46:52.000Z"),
          lap(71, "2025-10-26T21:33:32.000Z"),
        ],
      }),
    );
    expect(t).toBe(mid);
    expect(t).toBeGreaterThan(start);
    expect(t).toBeLessThan(end);
  });

  it("interpolates when the mid lap is missing and uses the time midpoint without laps", () => {
    const start = Date.parse("2025-10-26T20:00:00.000Z");
    const end = Date.parse("2025-10-26T22:00:00.000Z");
    const interpolated = historicalStartMs(
      start,
      end,
      bundle({
        laps: [lap(1, "2025-10-26T20:00:12.000Z"), lap(18, "2025-10-26T20:22:52.000Z")],
      }),
    );
    expect(interpolated).toBeGreaterThan(Date.parse("2025-10-26T20:00:12.000Z"));
    expect(interpolated).toBeLessThan(Date.parse("2025-10-26T20:22:52.000Z"));
    expect(historicalStartMs(start, end, bundle())).toBe(start + (end - start) * 0.5);
  });
});

describe("isFinishedSession", () => {
  it("treats an old race as finished and a current session as live", () => {
    const now = Date.parse("2026-11-01T14:00:00.000Z");
    expect(
      isFinishedSession(
        bundle({
          session: {
            ...bundle().session,
            date_end: "2025-10-26T22:00:00.000Z",
          },
          intervals: [{ date: "2025-10-26T21:33:32.000Z", driver_number: 1, gap_to_leader: 0, interval: 0 }],
        }),
        now,
      ),
    ).toBe(true);

    const liveEnd = new Date(now + 90 * 60 * 1000).toISOString();
    const liveSample = new Date(now - 5_000).toISOString();
    expect(
      isFinishedSession(
        bundle({
          session: { ...bundle().session, date_end: liveEnd },
          intervals: [{ date: liveSample, driver_number: 1, gap_to_leader: 0, interval: 0 }],
        }),
        now,
      ),
    ).toBe(false);

    expect(
      isFinishedSession(
        bundle({
          session: { ...bundle().session, date_end: new Date(now - 2 * 60 * 1000).toISOString() },
          intervals: [{ date: new Date(now - 30_000).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 }],
        }),
        now,
      ),
    ).toBe(false);

    expect(
      isFinishedSession(
        bundle({
          session: { ...bundle().session, date_end: new Date(now - LIVE_SESSION_GRACE_MS - 1).toISOString() },
          intervals: [
            {
              date: new Date(now - LIVE_SESSION_GRACE_MS - 1).toISOString(),
              driver_number: 1,
              gap_to_leader: 0,
              interval: 0,
            },
          ],
        }),
        now,
      ),
    ).toBe(true);
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
