import { describe, expect, it } from "vitest";
import { scheduledRaceLaps } from "./raceDistance";

describe("scheduledRaceLaps", () => {
  it("uses the official Mexico distance, not the highest lap already seen", () => {
    expect(
      scheduledRaceLaps({
        session_name: "Race",
        session_type: "Race",
        circuit_short_name: "Mexico City",
      }),
    ).toBe(71);
    expect(
      scheduledRaceLaps({
        session_name: "Sprint",
        session_type: "Race",
        circuit_short_name: "Shanghai",
      }),
    ).toBe(19);
    expect(
      scheduledRaceLaps({
        session_name: "Practice 1",
        session_type: "Practice",
        circuit_short_name: "Mexico City",
      }),
    ).toBeNull();
  });
});
