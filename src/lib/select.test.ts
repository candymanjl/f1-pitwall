import { describe, expect, it } from "vitest";
import { isSelected, nextSelection } from "./select";

describe("nextSelection", () => {
  it("selects a driver on click and clears when clicking the same one again", () => {
    expect(nextSelection([], 44, false)).toEqual([44]);
    expect(nextSelection([44], 44, false)).toEqual([]);
    expect(nextSelection([44], 1, false)).toEqual([1]);
  });

  it("shift-click adds and removes without clearing others", () => {
    expect(nextSelection([44], 1, true)).toEqual([44, 1]);
    expect(nextSelection([44, 1], 44, true)).toEqual([1]);
    expect(nextSelection([1], 1, true)).toEqual([]);
  });
});

describe("isSelected", () => {
  it("is true only for numbers in the set", () => {
    expect(isSelected([44, 1], 1)).toBe(true);
    expect(isSelected([44], 16)).toBe(false);
  });
});
