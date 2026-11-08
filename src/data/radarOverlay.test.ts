import { describe, expect, it } from "vitest";
import { geoCircuitFor, lngLatToMetres } from "./geoCircuit";
import { liveRadarOverlay, NO_GEO_NOTE } from "./radarOverlay";
import { resampleClosed } from "./trackFit";
import type { Driver, Meeting, Session, SessionBundle } from "./types";

const SESSION: Session = {
  session_key: 1,
  meeting_key: 1,
  session_name: "Race",
  session_type: "Race",
  date_start: "2024-11-03T17:00:00.000Z",
  date_end: "2024-11-03T19:00:00.000Z",
  circuit_short_name: "Interlagos",
  country_name: "Brazil",
  location: "São Paulo",
  year: 2024,
};

const MEETING: Meeting = {
  meeting_key: 1,
  meeting_name: "São Paulo Grand Prix",
  circuit_short_name: "Interlagos",
  country_name: "Brazil",
  location: "São Paulo",
  date_start: SESSION.date_start,
  year: 2024,
};

const DRIVER: Driver = {
  driver_number: 1,
  broadcast_name: "VER",
  full_name: "Max Verstappen",
  name_acronym: "VER",
  team_name: "Red Bull Racing",
  team_colour: "3671C6",
  first_name: "Max",
  last_name: "Verstappen",
};

function bundle(track: [number, number][], extra: Partial<SessionBundle> = {}): SessionBundle {
  return {
    meeting: MEETING,
    session: SESSION,
    weekendSessions: [],
    drivers: [DRIVER],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track,
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3],
    ...extra,
  };
}

describe("live radar overlay", () => {
  it("fits an OpenF1 outline that already lives in local metres", () => {
    const geo = geoCircuitFor(SESSION, MEETING)!;
    const metres = lngLatToMetres(geo.lngLat, geo.lat0, geo.lon0);
    const now = Date.parse("2024-11-03T17:40:00.000Z");
    const [x, y] = metres[4];
    const out = liveRadarOverlay(
      bundle(metres, {
        locations: [
          { driver_number: 1, x, y, date: new Date(now - 400).toISOString() },
          { driver_number: 1, x: x + 8, y: y + 4, date: new Date(now + 400).toISOString() },
        ],
      }),
      now,
    );
    expect(out.note).toBeNull();
    expect(out.overlay?.fitLabel).toMatch(/Fit RMS /);
    expect(out.overlay?.fitLabel).toMatch(/not mirrored/);
    expect(out.overlay?.cars).toHaveLength(1);
    expect(out.overlay?.cars[0].code).toBe("VER");
    expect(out.overlay?.cars[0].lat).toBeCloseTo(geo.lngLat[4][1], 3);
    expect(out.overlay?.cars[0].lon).toBeCloseTo(geo.lngLat[4][0], 3);
  });

  it("withholds the overlay when the OpenF1 outline is a different shape", () => {
    const pentagon = resampleClosed(
      [
        [0, 0],
        [140, 10],
        [160, 90],
        [40, 110],
        [-20, 50],
      ],
      16,
    );
    const out = liveRadarOverlay(bundle(pentagon), Date.parse(SESSION.date_start));
    expect(out.overlay).toBeNull();
    expect(out.note).toMatch(/withheld/);
    expect(out.note).toMatch(/RMS/);
  });

  it("falls back when no GeoJSON match exists", () => {
    const out = liveRadarOverlay(
      bundle(resampleClosed([[0, 0], [100, 0], [100, 80], [0, 80]], 16), {
        session: { ...SESSION, circuit_short_name: "Unknownville", location: "Unknownville", country_name: "Nowhere" },
        meeting: { ...MEETING, circuit_short_name: "Unknownville", location: "Unknownville" },
      }),
      Date.parse(SESSION.date_start),
    );
    expect(out.overlay).toBeNull();
    expect(out.note).toBe(NO_GEO_NOTE);
  });
});
