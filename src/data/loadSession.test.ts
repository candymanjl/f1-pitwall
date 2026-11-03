import { afterEach, describe, expect, it, vi } from "vitest";
import { writeRelayUrl } from "../config";
import { resetClientForTests } from "./client";
import { cachedMeeting, cachedSession, loadBundle, mapPagesFirst } from "./loadSession";
import type { Meeting, Session } from "./types";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const meeting: Meeting = {
  meeting_key: 1272,
  meeting_name: "Mexico City Grand Prix",
  circuit_short_name: "Mexico City",
  country_name: "Mexico",
  location: "Mexico City",
  date_start: "2025-10-24T00:00:00.000Z",
  year: 2025,
};

const race: Session = {
  session_key: 9877,
  meeting_key: 1272,
  session_name: "Race",
  session_type: "Race",
  date_start: "2025-10-26T20:00:00.000Z",
  date_end: "2025-10-26T22:00:00.000Z",
  circuit_short_name: "Mexico City",
  country_name: "Mexico",
  location: "Mexico City",
  year: 2025,
};

const fp1: Session = { ...race, session_key: 9871, session_name: "Practice 1", session_type: "Practice" };

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

afterEach(() => {
  writeRelayUrl("");
  resetClientForTests();
  try {
    Reflect.deleteProperty(globalThis, "localStorage");
  } catch {
    /* ignore */
  }
  vi.unstubAllGlobals();
});

describe("session cache helpers", () => {
  it("reuses picker lists so Load does not refetch meetings/sessions", () => {
    expect(cachedSession([fp1, race], 9877)).toEqual(race);
    expect(cachedMeeting([meeting], 1272)).toEqual(meeting);
    expect(cachedSession([fp1], 9877)).toBeUndefined();
  });

  it("loads map pages before weekend stints, tyres/strategy the other way", () => {
    expect(mapPagesFirst("trackmap")).toBe(true);
    expect(mapPagesFirst("timing")).toBe(true);
    expect(mapPagesFirst("laptiming")).toBe(true);
    expect(mapPagesFirst("tyres")).toBe(false);
    expect(mapPagesFirst("strategy")).toBe(false);
  });
});

describe("loadBundle", () => {
  it("skips meeting/session list fetches when the picker already has them and emits timing first", async () => {
    mockStorage();
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    const seen: string[] = [];
    const phases: string[] = [];
    const fetches: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url);
        seen.push(href);
        if (href.includes("/meetings")) return jsonRes(200, [meeting]);
        if (href.includes("/sessions")) return jsonRes(200, [fp1, race]);
        if (href.includes("/drivers")) return jsonRes(200, []);
        if (href.includes("/laps")) return jsonRes(200, []);
        if (href.includes("/stints")) {
          await new Promise((r) => setTimeout(r, 20));
          return jsonRes(200, []);
        }
        if (href.includes("/location")) {
          await new Promise((r) => setTimeout(r, 5));
          return jsonRes(200, []);
        }
        return jsonRes(200, []);
      }),
    );

    await loadBundle(9877, {
      meeting,
      weekendSessions: [fp1, race],
      page: "trackmap",
      onProgress: (phase) => {
        phases.push(phase);
      },
      onFetch: (p) => {
        fetches.push(`${p.label}:${p.done}/${p.total}`);
      },
    });

    expect(seen.some((u) => u.includes("/meetings"))).toBe(false);
    expect(seen.some((u) => /\/sessions\?/.test(u) || u.includes("/sessions?"))).toBe(false);
    expect(phases[0]).toBe("timing");
    expect(phases.indexOf("map")).toBeLessThan(phases.indexOf("weekend"));
    expect(fetches.some((row) => row.startsWith("drivers:"))).toBe(true);
    expect(fetches.some((row) => row.startsWith("laps:"))).toBe(true);
    expect(fetches.some((row) => row.startsWith("stints:"))).toBe(true);
    expect(fetches.at(-1)).toMatch(/\/\d+$/);
  });

  it("publishes the track outline on Load before all-driver GPS, even from Lap timing", async () => {
    mockStorage();
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    const lapStart = "2025-10-26T20:20:00.000Z";
    const driver = {
      driver_number: 1,
      broadcast_name: "VER",
      full_name: "Max Verstappen",
      name_acronym: "VER",
      team_name: "Red Bull",
      team_colour: "3671C6",
      first_name: "Max",
      last_name: "Verstappen",
    };
    const outlineSamples = Array.from({ length: 16 }, (_, i) => ({
      date: new Date(Date.parse(lapStart) + i * 1000).toISOString(),
      driver_number: 1,
      x: i * 40,
      y: (i % 4) * 40,
    }));
    let outlineAt = "";
    let locationsDone = false;
    const phases: string[] = [];
    const tracks: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url);
        if (href.includes("/drivers")) return jsonRes(200, [driver]);
        if (href.includes("/laps")) {
          return jsonRes(200, [
            {
              driver_number: 1,
              lap_number: 12,
              date_start: lapStart,
              lap_duration: 80,
              duration_sector_1: 22,
              duration_sector_2: 29,
              duration_sector_3: 29,
              is_pit_out_lap: false,
              segments_sector_1: null,
              segments_sector_2: null,
              segments_sector_3: null,
              i1_speed: null,
              i2_speed: null,
              st_speed: null,
            },
          ]);
        }
        if (href.includes("/location") && href.includes("22:00:00")) {
          await new Promise((r) => setTimeout(r, 80));
          locationsDone = true;
          return jsonRes(200, []);
        }
        if (href.includes("/location")) {
          return jsonRes(200, outlineSamples);
        }
        return jsonRes(200, []);
      }),
    );

    await loadBundle(9877, {
      meeting,
      weekendSessions: [fp1, race],
      page: "laptiming",
      onProgress: (phase, bundle) => {
        phases.push(phase);
        tracks.push(bundle.track.length);
        if (phase === "outline") outlineAt = locationsDone ? "after-gps" : "before-gps";
      },
    });

    expect(phases[0]).toBe("timing");
    expect(phases).toContain("outline");
    expect(phases.indexOf("outline")).toBeLessThan(phases.indexOf("map"));
    expect(outlineAt).toBe("before-gps");
    expect(tracks[phases.indexOf("outline")]).toBeGreaterThan(2);
  });

  it("replaces time-median sector fractions with GPS timestamp splits on the outline lap", async () => {
    mockStorage();
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    const lapStart = "2025-10-26T20:20:00.000Z";
    const start = Date.parse(lapStart);
    const driver = {
      driver_number: 1,
      broadcast_name: "VER",
      full_name: "Max Verstappen",
      name_acronym: "VER",
      team_name: "Red Bull",
      team_colour: "3671C6",
      first_name: "Max",
      last_name: "Verstappen",
    };
    const outlineSamples = Array.from({ length: 81 }, (_, i) => ({
      date: new Date(start + i * 1000).toISOString(),
      driver_number: 1,
      x: i * 10,
      y: 0,
    }));
    let outlineFracs: [number, number, number] | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url);
        if (href.includes("/drivers")) return jsonRes(200, [driver]);
        if (href.includes("/laps")) {
          return jsonRes(200, [
            {
              driver_number: 1,
              lap_number: 12,
              date_start: lapStart,
              lap_duration: 80,
              duration_sector_1: 20,
              duration_sector_2: 30,
              duration_sector_3: 30,
              is_pit_out_lap: false,
              segments_sector_1: null,
              segments_sector_2: null,
              segments_sector_3: null,
              i1_speed: null,
              i2_speed: null,
              st_speed: null,
            },
          ]);
        }
        if (href.includes("/location") && href.includes("22:00:00")) return jsonRes(200, []);
        if (href.includes("/location")) return jsonRes(200, outlineSamples);
        return jsonRes(200, []);
      }),
    );

    await loadBundle(9877, {
      meeting,
      weekendSessions: [fp1, race],
      page: "trackmap",
      onProgress: (phase, bundle) => {
        if (phase === "outline") outlineFracs = bundle.sectorFracs;
      },
    });

    expect(outlineFracs).toBeTruthy();
    expect(outlineFracs![0]).toBeCloseTo(0.25, 1);
    expect(outlineFracs![1]).toBeCloseTo(0.375, 1);
  });
});
