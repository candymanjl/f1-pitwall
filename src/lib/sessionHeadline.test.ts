import { describe, expect, it } from "vitest";
import { formatSessionHeadline } from "./sessionHeadline";

describe("formatSessionHeadline", () => {
  it("shows race laps as current/total next to the session clock", () => {
    expect(
      formatSessionHeadline({
        sessionName: "Race",
        elapsedMs: 12 * 60 * 1000 + 34 * 1000,
        currentLap: 12,
        totalLaps: 71,
        race: true,
      }),
    ).toBe("RACE / 00:12:34 / LAP 12/71");
  });

  it("shows the leader lap for qualifying without a fake race distance", () => {
    expect(
      formatSessionHeadline({
        sessionName: "Qualifying",
        elapsedMs: 99 * 60 * 1000 + 28 * 1000,
        currentLap: 12,
        totalLaps: 20,
        race: false,
      }),
    ).toBe("QUALIFYING / 01:39:28 / LAP 12");
  });

  it("omits the lap clause before any lap has started", () => {
    expect(
      formatSessionHeadline({
        sessionName: "Practice 1",
        elapsedMs: 1000,
        currentLap: null,
        race: false,
      }),
    ).toBe("PRACTICE 1 / 00:00:01");
  });
});
