import { describe, expect, it } from "vitest";
import { latLonToTile, parseRainViewerCatalog, radarTileWindow, rainViewerTileUrl } from "./rainViewer";

describe("RainViewer catalog", () => {
  it("builds zoom-clamped tile URLs from past frames", () => {
    const frames = parseRainViewerCatalog({
      host: "https://tilecache.rainviewer.com",
      radar: { past: [{ time: 1700000000, path: "/v2/radar/abc" }] },
    });
    expect(frames).toHaveLength(1);
    expect(rainViewerTileUrl(frames[0], 6, 18, 25)).toBe(
      "https://tilecache.rainviewer.com/v2/radar/abc/256/6/18/25/2/1_1.png",
    );
    expect(rainViewerTileUrl(frames[0], 99, 1, 1)).toContain("/256/7/");
  });

  it("places a circuit pin inside a 3x3 regional window", () => {
    const t = latLonToTile(30.1328, -97.6411, 6);
    const win = radarTileWindow(30.1328, -97.6411, 6, 3);
    expect(win.pinX).toBeGreaterThan(0);
    expect(win.pinX).toBeLessThan(3);
    expect(win.pinY).toBeGreaterThan(0);
    expect(win.pinY).toBeLessThan(3);
    expect(t.x).toBeGreaterThan(win.x0);
  });
});
