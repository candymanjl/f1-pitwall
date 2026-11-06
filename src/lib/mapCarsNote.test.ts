import { describe, expect, it } from "vitest";
import { liveLocationWaitNote } from "./mapCarsNote";

describe("liveLocationWaitNote", () => {
  const now = Date.parse("2026-11-06T19:37:00.000Z");

  it("stays off in historical replay", () => {
    expect(liveLocationWaitNote({ live: false, locations: [], now })).toBeNull();
  });

  it("waits when live GPS has never arrived", () => {
    expect(liveLocationWaitNote({ live: true, locations: [], now })).toBe("Waiting for live positions from OpenF1");
  });

  it("stays quiet while a sample is still fresh", () => {
    expect(
      liveLocationWaitNote({
        live: true,
        now,
        locations: [{ date: new Date(now - 4000).toISOString(), driver_number: 12, x: 10, y: 0 }],
      }),
    ).toBeNull();
  });

  it("names how long ago the last sample was", () => {
    expect(
      liveLocationWaitNote({
        live: true,
        now,
        locations: [{ date: new Date(now - 41_000).toISOString(), driver_number: 12, x: 10, y: 0 }],
      }),
    ).toBe("Waiting for live positions from OpenF1, last sample 41s ago");
  });
});
