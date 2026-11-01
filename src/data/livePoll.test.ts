import { describe, expect, it } from "vitest";
import { LIVE_POLL_MS } from "../config";
import {
  duePollSpecs,
  fallbackSinceIso,
  FAST_POLL_MS,
  formatLiveDebug,
  lastSeenIso,
  livePollParams,
  LIVE_POLL_SPECS,
  nextDueInMs,
  nextPollDelayMs,
  pollSpecsForPage,
  seedLastRan,
  seedLiveCursors,
  SLOW_POLL_MS,
} from "./livePoll";
import type { SessionBundle } from "./types";

const lapsSpec = LIVE_POLL_SPECS.find((s) => s.path === "laps")!;
const posSpec = LIVE_POLL_SPECS.find((s) => s.path === "position")!;
const stintSpec = LIVE_POLL_SPECS.find((s) => s.path === "stints")!;

describe("live incremental poll helpers", () => {
  it("uses date_start> for laps and date> for position", () => {
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
    expect(livePollParams(posSpec, 99, cursors, "x")["date>"]).toBe("2025-10-26T20:10:04.000Z");
    expect(livePollParams(lapsSpec, 99, cursors, "x")["date_start>"]).toBe("2025-10-26T20:10:00.000Z");
    expect(livePollParams(lapsSpec, 99, cursors, "x")["date>"]).toBeUndefined();
    expect(livePollParams(stintSpec, 99, cursors, "x")).toEqual({ session_key: 99 });
  });

  it("only polls the fast trio on the first tick", () => {
    const now = 1_700_000_000_000;
    const last = seedLastRan(now, pollSpecsForPage("trackmap"));
    const due = duePollSpecs("trackmap", last, now).map((s) => s.path);
    expect(due).toEqual(["location", "position", "intervals"]);
    expect(duePollSpecs("trackmap", last, now + 999).some((s) => s.path === "laps")).toBe(false);
    expect(duePollSpecs("trackmap", last, now + 1000).some((s) => s.path === "laps")).toBe(true);
    expect(nextDueInMs("trackmap", last, now)).toBe(1000);
    expect(SLOW_POLL_MS).toBeGreaterThan(FAST_POLL_MS);
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
    expect(
      formatLiveDebug({
        lastPollAt: Date.parse("2026-11-01T20:57:04.000Z"),
        lastCycleMs: 880,
        added: { location: 12, position: 4 },
        lastError: "ok",
      }),
    ).toBe("poll 20:57:04 UTC · location +12 · position +4 · 880ms · ok");
  });
});
