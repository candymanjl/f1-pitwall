import { describe, expect, it } from "vitest";
import { createFetchTracker, emptyFetchProgress, fetchProgressPct, trackJob } from "./loadProgress";

describe("fetch progress", () => {
  it("rounds a completed-over-total fraction into a 0–100 percent", () => {
    expect(fetchProgressPct(0, 0)).toBe(0);
    expect(fetchProgressPct(1, 0)).toBe(100);
    expect(fetchProgressPct(0, 8)).toBe(0);
    expect(fetchProgressPct(1, 8)).toBe(13);
    expect(fetchProgressPct(4, 8)).toBe(50);
    expect(fetchProgressPct(8, 8)).toBe(100);
    expect(fetchProgressPct(9, 8)).toBe(100);
  });

  it("counts endpoints as they finish and exposes the current label", async () => {
    const seen: string[] = [];
    const tracker = createFetchTracker((p) => {
      seen.push(`${p.done}/${p.total} ${p.label} ${p.pct}%`);
    });
    expect(tracker.snapshot()).toEqual(emptyFetchProgress("Starting…"));
    const a = trackJob(tracker, "drivers", Promise.resolve("ok"));
    const b = trackJob(tracker, "laps", Promise.resolve("ok"));
    await Promise.all([a, b]);
    expect(tracker.snapshot()).toMatchObject({ done: 2, total: 2, pct: 100 });
    expect(seen[0]).toBe("0/0 Starting… 0%");
    expect(seen.some((row) => row.includes("drivers"))).toBe(true);
    expect(seen.at(-1)).toMatch(/2\/2 (drivers|laps) 100%/);
  });
});
