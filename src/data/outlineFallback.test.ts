import { afterEach, describe, expect, it } from "vitest";
import {
  formatOutlineLabel,
  maybePromoteLiveOutline,
  preferOutlineDonors,
  resetOutlinePromoteForTests,
  resolveFallbackOutline,
} from "./outlineFallback";
import { OUTLINE_CACHE_KEY, readCachedOutline, writeCachedOutline } from "./outlineCache";
import { liveOutlineBeatsFallback, polylineLength } from "./track";
import type { Driver, Lap, LocationSample, Meeting, Session, SessionBundle } from "./types";

function mockStorage(): void {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    },
    configurable: true,
  });
}

function oval(n = 40, rx = 4000, ry = 2200): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * ry] as [number, number];
  });
}

function session(partial: Partial<Session> & Pick<Session, "session_key" | "session_name" | "date_start">): Session {
  return {
    meeting_key: 1299,
    session_type: partial.session_name,
    date_end: partial.date_start,
    circuit_key: 14,
    circuit_short_name: "Interlagos",
    country_name: "Brazil",
    location: "São Paulo",
    year: 2026,
    ...partial,
  };
}

const fp1 = session({
  session_key: 11405,
  session_name: "Practice 1",
  date_start: "2026-11-06T15:30:00.000Z",
  year: 2026,
});
const race2025 = session({
  session_key: 9869,
  meeting_key: 1273,
  session_name: "Race",
  date_start: "2025-11-09T17:00:00.000Z",
  year: 2025,
});
const fp1_2025 = session({
  session_key: 9859,
  meeting_key: 1273,
  session_name: "Practice 1",
  date_start: "2025-11-07T14:30:00.000Z",
  year: 2025,
});

afterEach(() => {
  resetOutlinePromoteForTests();
  try {
    Reflect.deleteProperty(globalThis, "localStorage");
  } catch {
    /* ignore */
  }
});

describe("preferOutlineDonors", () => {
  it("picks the most recent race at the same circuit_key before the current session", () => {
    const ranked = preferOutlineDonors(fp1, [fp1, fp1_2025, race2025]);
    expect(ranked.map((s) => s.session_key)).toEqual([9869, 9859]);
  });

  it("matches circuit_short_name when circuit_key is missing", () => {
    const current = { ...fp1, circuit_key: undefined };
    const donor = { ...race2025, circuit_key: undefined };
    expect(preferOutlineDonors(current, [donor])[0]?.session_key).toBe(9869);
  });
});

describe("formatOutlineLabel", () => {
  it("shortens Grand Prix and keeps the year", () => {
    expect(
      formatOutlineLabel({
        year: 2025,
        meetingName: "São Paulo Grand Prix",
        sessionName: "Race",
        sessionKey: 9869,
      }),
    ).toBe("Outline from 2025 São Paulo GP");
  });
});

describe("outline cache", () => {
  it("round-trips a circuit outline in localStorage", () => {
    mockStorage();
    const track = oval();
    writeCachedOutline(fp1, {
      track,
      sectorFracs: [0.25, 0.5, 0.25],
      year: 2025,
      meetingName: "São Paulo Grand Prix",
      sessionName: "Race",
      sessionKey: 9869,
    });
    const hit = readCachedOutline(fp1);
    expect(hit?.sessionKey).toBe(9869);
    expect(hit?.track).toEqual(track);
    expect(localStorage.getItem(OUTLINE_CACHE_KEY)).toContain("k:14");
  });
});

describe("resolveFallbackOutline", () => {
  it("returns the cached outline without fetching", async () => {
    mockStorage();
    const track = oval();
    writeCachedOutline(fp1, {
      track,
      sectorFracs: [0.28, 0.4, 0.32],
      year: 2025,
      meetingName: "São Paulo Grand Prix",
      sessionName: "Race",
      sessionKey: 9869,
    });
    const meeting: Meeting = {
      meeting_key: 1299,
      meeting_name: "São Paulo Grand Prix",
      circuit_key: 14,
      circuit_short_name: "Interlagos",
      country_name: "Brazil",
      location: "São Paulo",
      date_start: "2026-11-06T00:00:00.000Z",
      year: 2026,
    };
    const resolved = await resolveFallbackOutline({ session: fp1, meeting, weekendSessions: [fp1] });
    expect(resolved?.from?.year).toBe(2025);
    expect(resolved?.track).toHaveLength(track.length);
    expect(formatOutlineLabel(resolved?.from)).toBe("Outline from 2025 São Paulo GP");
  });
});

describe("live outline promotion", () => {
  const driver: Driver = {
    driver_number: 1,
    broadcast_name: "VER",
    full_name: "VER",
    name_acronym: "VER",
    team_name: "RB",
    team_colour: "3671C6",
    first_name: "Max",
    last_name: "Verstappen",
  };
  const start = Date.parse("2026-11-06T15:40:00.000Z");
  const laps: Lap[] = [
    {
      driver_number: 1,
      lap_number: 2,
      date_start: new Date(start).toISOString(),
      lap_duration: 72,
      duration_sector_1: 18,
      duration_sector_2: 37,
      duration_sector_3: 17,
      is_pit_out_lap: false,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
      i1_speed: null,
      i2_speed: null,
      st_speed: null,
    },
  ];

  function bundle(partial: Partial<SessionBundle> = {}): SessionBundle {
    return {
      meeting: {
        meeting_key: 1299,
        meeting_name: "São Paulo Grand Prix",
        circuit_key: 14,
        circuit_short_name: "Interlagos",
        country_name: "Brazil",
        location: "São Paulo",
        date_start: "2026-11-06T00:00:00.000Z",
        year: 2026,
      },
      session: fp1,
      weekendSessions: [fp1],
      drivers: [driver],
      laps,
      intervals: [],
      positions: [],
      stints: [],
      weekendStints: [],
      pits: [],
      weather: [],
      raceControl: [],
      track: oval(),
      corners: [],
      sectorFracs: [0.26, 0.5, 0.24],
      outlineFrom: {
        year: 2025,
        meetingName: "São Paulo Grand Prix",
        sessionName: "Race",
        sessionKey: 9869,
      },
      ...partial,
    };
  }

  it("does not replace a circuit fallback with a short pit-lane scribble", () => {
    const fallback = oval();
    const scribble: [number, number][] = Array.from({ length: 20 }, (_, i) => [i * 10, 0]);
    expect(liveOutlineBeatsFallback(scribble, fallback)).toBe(false);
    expect(polylineLength(fallback)).toBeGreaterThan(polylineLength(scribble) * 4);
  });

  it("promotes to live GPS once a flying-lap path is long enough", () => {
    mockStorage();
    const samples: LocationSample[] = oval(80).map((p, i) => ({
      date: new Date(start + i * 900).toISOString(),
      driver_number: 1,
      x: p[0],
      y: p[1],
    }));
    const promoted = maybePromoteLiveOutline(bundle({ locations: samples }));
    expect(promoted).toBeTruthy();
    expect(promoted?.outlineFrom).toBeNull();
    expect(promoted!.track.length).toBeGreaterThan(8);
    expect(readCachedOutline(fp1)?.year).toBe(2026);
  });

  it("keeps the fallback when live GPS is still a garage blob", () => {
    const samples: LocationSample[] = Array.from({ length: 40 }, (_, i) => ({
      date: new Date(start + i * 200).toISOString(),
      driver_number: 1,
      x: 10 + i,
      y: 10,
    }));
    expect(maybePromoteLiveOutline(bundle({ locations: samples }))).toBeNull();
  });
});
