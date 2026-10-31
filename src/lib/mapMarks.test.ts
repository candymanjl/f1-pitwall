import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAP_CAR_R, MAP_CAR_R_SELECTED, MAP_LINE_WIDTH } from "./mapMarks";

describe("shared map marks", () => {
  it("keeps Track map and Pit circle on the same enlarged sizes", () => {
    expect(MAP_LINE_WIDTH).toBeGreaterThanOrEqual(3.4);
    expect(MAP_CAR_R).toBeGreaterThanOrEqual(7);
    expect(MAP_CAR_R_SELECTED).toBeGreaterThan(MAP_CAR_R);
    const track = readFileSync("src/pages/trackmap.ts", "utf8");
    const circle = readFileSync("src/pages/pitcircle.ts", "utf8");
    expect(track).toMatch(/MAP_LINE_WIDTH/);
    expect(track).toMatch(/MAP_CAR_R/);
    expect(circle).toMatch(/MAP_LINE_WIDTH/);
    expect(circle).toMatch(/MAP_CAR_R/);
    expect(track).toMatch(/mountTowerSplitter/);
    expect(circle).toMatch(/mountTowerSplitter/);
  });
});
