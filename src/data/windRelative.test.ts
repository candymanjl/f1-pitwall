import { describe, expect, it } from "vitest";
import { derivedStraightWinds, travelHeadingDeg, windComponent } from "./windRelative";

describe("windComponent", () => {
  it("calls a northbound car in a north wind a headwind", () => {
    const hit = windComponent(0, 0, 4);
    expect(hit.kind).toBe("HEADWIND");
    expect(hit.speed).toBeCloseTo(4, 5);
  });

  it("calls the same car with a south wind a tailwind", () => {
    expect(windComponent(180, 0, 3).kind).toBe("TAILWIND");
  });

  it("calls a west wind on a northbound car a crosswind", () => {
    expect(windComponent(270, 0, 5).kind).toBe("CROSSWIND");
  });
});

describe("derivedStraightWinds", () => {
  it("labels components as derived from one station reading", () => {
    const square: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [0, 0],
    ];
    const rows = derivedStraightWinds(square, 90, 4, [0.3, 0.4, 0.3]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.label)).toEqual(["Main straight", "Back straight", "Sector 2 approach"]);
    expect(rows.every((r) => r.speed >= 0)).toBe(true);
    expect(travelHeadingDeg(square.slice(0, 2))).toBeCloseTo(90, 5);
  });
});
