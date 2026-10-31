import { describe, expect, it } from "vitest";
import { gridByDriver, isRaceOrSprint, positionChange } from "./grid";

describe("gridByDriver", () => {
  it("prefers /starting_grid over the first /position", () => {
    const map = gridByDriver({
      startingGrid: [
        { driver_number: 4, position: 3 },
        { driver_number: 16, position: 1 },
      ],
      positions: [
        { date: "2025-10-26T20:00:00.000Z", driver_number: 4, position: 1 },
        { date: "2025-10-26T20:00:00.000Z", driver_number: 16, position: 2 },
      ],
    });
    expect(map.get(4)).toBe(3);
    expect(map.get(16)).toBe(1);
  });

  it("falls back to the earliest /position when the grid is empty", () => {
    const map = gridByDriver({
      startingGrid: [],
      positions: [
        { date: "2025-10-26T20:10:00.000Z", driver_number: 44, position: 4 },
        { date: "2025-10-26T20:00:01.000Z", driver_number: 44, position: 6 },
        { date: "2025-10-26T20:00:00.000Z", driver_number: 1, position: 2 },
      ],
    });
    expect(map.get(44)).toBe(6);
    expect(map.get(1)).toBe(2);
  });

  it("accepts grid_position as an alias", () => {
    const map = gridByDriver({
      startingGrid: [{ driver_number: 55, grid_position: 1 }],
      positions: [],
    });
    expect(map.get(55)).toBe(1);
  });
});

describe("positionChange", () => {
  it("is grid minus current: plus gained, minus lost", () => {
    expect(positionChange(10, 5)).toBe(5);
    expect(positionChange(3, 7)).toBe(-4);
    expect(positionChange(2, 2)).toBe(0);
    expect(positionChange(null, 1)).toBeNull();
  });
});

describe("isRaceOrSprint", () => {
  it("matches races and sprints only", () => {
    expect(isRaceOrSprint({ session_name: "Race", session_type: "Race" })).toBe(true);
    expect(isRaceOrSprint({ session_name: "Sprint", session_type: "Race" })).toBe(true);
    expect(isRaceOrSprint({ session_name: "Sprint Qualifying", session_type: "Qualifying" })).toBe(false);
    expect(isRaceOrSprint({ session_name: "Practice 1", session_type: "Practice" })).toBe(false);
    expect(isRaceOrSprint({ session_name: "Qualifying", session_type: "Qualifying" })).toBe(false);
  });
});
