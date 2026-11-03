/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { appendSectorOutline, SECTOR_STROKES } from "./trackOutline";

describe("appendSectorOutline", () => {
  it("draws three colored sector paths from S/F", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 80],
      [0, 80],
      [0, 0],
    ];
    const map = (x: number, y: number): [number, number] => [x, y];
    const paths = appendSectorOutline(svg, pts, map, [0.3, 0.4, 0.3], { width: 3.6, className: "track-line" });
    expect(paths).toHaveLength(3);
    expect(paths.map((p) => p.dataset.sector)).toEqual(["1", "2", "3"]);
    expect(paths.map((p) => p.getAttribute("stroke"))).toEqual([...SECTOR_STROKES]);
    expect(paths[0].classList.contains("track-s1")).toBe(true);
    expect(paths[1].classList.contains("track-s2")).toBe(true);
    expect(paths[2].classList.contains("track-s3")).toBe(true);
  });
});
