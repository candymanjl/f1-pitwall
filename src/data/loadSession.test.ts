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
    });

    expect(seen.some((u) => u.includes("/meetings"))).toBe(false);
    expect(seen.some((u) => /\/sessions\?/.test(u) || u.includes("/sessions?"))).toBe(false);
    expect(phases[0]).toBe("timing");
    expect(phases.indexOf("map")).toBeLessThan(phases.indexOf("weekend"));
  });
});
