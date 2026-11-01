import { describe, expect, it } from "vitest";
import { LIVE_POLL_MS } from "../config";
import {
  fallbackSinceIso,
  lastSeenIso,
  livePollParams,
  nextPollDelayMs,
  pollSpecsForPage,
  seedLiveCursors,
} from "./livePoll";
import type { SessionBundle } from "./types";

describe("live incremental poll helpers", () => {
  it("seeds date> cursors from the newest row per endpoint", () => {
    const bundle = {
      laps: [{ date_start: "2025-10-26T20:10:00.000Z" }],
      positions: [{ date: "2025-10-26T20:10:04.000Z" }],
      intervals: [{ date: "2025-10-26T20:10:03.000Z" }],
      locations: [{ date: "2025-10-26T20:10:05.000Z" }],
      pits: [],
      weather: [],
      raceControl: [],
    } as unknown as SessionBundle;
    const cursors = seedLiveCursors(bundle);
    expect(cursors.laps).toBe("2025-10-26T20:10:00.000Z");
    expect(cursors.position).toBe("2025-10-26T20:10:04.000Z");
    expect(cursors.location).toBe("2025-10-26T20:10:05.000Z");
    expect(livePollParams({ path: "position", topic: "v1/position", dateField: "date" }, 99, cursors, "x")["date>"]).toBe(
      "2025-10-26T20:10:04.000Z",
    );
  });

  it("backs off on errors without going past 30s", () => {
    expect(nextPollDelayMs(0)).toBe(LIVE_POLL_MS);
    expect(nextPollDelayMs(1)).toBe(LIVE_POLL_MS * 2);
    expect(nextPollDelayMs(8)).toBe(30_000);
  });

  it("only polls car_data on the Telemetry page", () => {
    expect(pollSpecsForPage("trackmap").some((s) => s.path === "car_data")).toBe(false);
    expect(pollSpecsForPage("telemetry").some((s) => s.path === "car_data")).toBe(true);
    expect(
      lastSeenIso([{ date: "2025-10-26T20:10:01.000Z" }, { date: "2025-10-26T20:10:04.000Z" }], "date"),
    ).toBe("2025-10-26T20:10:04.000Z");
    expect(fallbackSinceIso(1_700_000_020_000, 20_000)).toBe(new Date(1_700_000_000_000).toISOString());
  });
});
