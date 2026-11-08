/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RADAR_RANGE_KEY, radarMosaicFor } from "../data/radarRange";
import { mountRadarPlayer } from "./weatherRadar";

const INTERLAGOS = { lat: -23.7036, lon: -46.6997 };

function frames() {
  return [
    { time: 1700000000, path: "/v2/radar/a", host: "https://tilecache.rainviewer.com" },
    { time: 1700000600, path: "/v2/radar/b", host: "https://tilecache.rainviewer.com" },
  ];
}

describe("live radar range views", () => {
  beforeEach(() => {
    localStorage.removeItem(RADAR_RANGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(RADAR_RANGE_KEY);
    document.body.replaceChildren();
  });

  it("does not draw a circuit outline or car dots", () => {
    const api = mountRadarPlayer();
    document.body.append(api.root);
    api.setRainViewer(frames(), INTERLAGOS.lat, INTERLAGOS.lon);
    expect(api.root.querySelector("svg.wx-radar-overlay")).toBeNull();
    expect(api.root.querySelector("[data-radar-outline]")).toBeNull();
    expect(api.root.querySelector("[data-radar-car]")).toBeNull();
    expect(api.root.querySelector(".wx-pin")).toBeTruthy();
    expect((api.root.querySelector(".wx-pin") as HTMLElement).hidden).toBe(false);
    api.destroy();
  });

  it("labels the views 50 mi and 15 mi and remembers the last choice", () => {
    const api = mountRadarPlayer();
    document.body.append(api.root);
    api.setRainViewer(frames(), INTERLAGOS.lat, INTERLAGOS.lon);
    const btn50 = api.root.querySelector("button[data-radar-view='50']") as HTMLButtonElement;
    const btn15 = api.root.querySelector("button[data-radar-view='15']") as HTMLButtonElement;
    expect(btn50.textContent).toBe("50 mi");
    expect(btn15.textContent).toBe("15 mi");
    expect(api.root.dataset.radarView).toBe("50");
    expect(api.root.dataset.radarSmooth).toBe("off");
    expect(api.root.querySelector("[data-radar-scalebar]")?.textContent).toBe("10 mi");
    btn15.click();
    expect(api.root.dataset.radarView).toBe("15");
    expect(api.root.dataset.radarSmooth).toBe("on");
    expect(localStorage.getItem(RADAR_RANGE_KEY)).toBe("15");
    expect(api.root.querySelector("[data-radar-scalebar]")?.textContent).toBe("3 mi");
    api.destroy();

    const again = mountRadarPlayer();
    document.body.append(again.root);
    again.setRainViewer(frames(), INTERLAGOS.lat, INTERLAGOS.lon);
    expect(again.root.dataset.radarView).toBe("15");
    expect(again.root.dataset.radarSmooth).toBe("on");
    expect(again.root.querySelector("img")?.src).toContain("/256/7/");
    again.destroy();
  });

  it("smooths upscaled 15 mi tiles in CSS (no nearest-neighbour)", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\[data-radar-smooth="on"\] \.wx-mosaic img \{[\s\S]*?image-rendering:\s*auto/);
    expect(css).toMatch(/\[data-radar-smooth="on"\] \.wx-mosaic img \{[\s\S]*?image-rendering:\s*smooth/);
    expect(css).toMatch(/\[data-radar-smooth="on"\] \.wx-radar-scene \{[\s\S]*?filter:\s*blur\(/);
    expect(css).not.toMatch(/image-rendering:\s*pixelated/);
    expect(css).not.toMatch(/wx-radar-overlay/);
    expect(css).not.toMatch(/wx-radar-outline/);
    expect(css).toMatch(/\.wx-mosaic img \{[\s\S]*?object-fit:\s*fill/);
    expect(css).toMatch(/grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  });

  it("fills the panel with one grid and pulls in a neighbour at a tile edge", () => {
    const api = mountRadarPlayer();
    document.body.append(api.root);
    api.setRainViewer(frames(), INTERLAGOS.lat, INTERLAGOS.lon);
    const mosaic = api.root.querySelector(".wx-mosaic") as HTMLElement;
    const fitted = radarMosaicFor(INTERLAGOS.lat, INTERLAGOS.lon, 50);
    expect(mosaic.style.gridTemplateColumns).toBe(`repeat(${fitted.cols}, minmax(0, 1fr))`);
    expect(mosaic.style.gridTemplateRows).toBe(`repeat(${fitted.rows}, minmax(0, 1fr))`);
    expect(mosaic.querySelectorAll("img").length).toBe(fitted.cols * fitted.rows);
    api.destroy();

    const n = 2 ** 7;
    const edgeLon = ((40 + 0.01) / n) * 360 - 180;
    const edge = mountRadarPlayer();
    document.body.append(edge.root);
    edge.setRainViewer(frames(), INTERLAGOS.lat, edgeLon);
    const edgeFit = radarMosaicFor(INTERLAGOS.lat, edgeLon, 50);
    expect(edgeFit.cols).toBeGreaterThan(1);
    const edgeMosaic = edge.root.querySelector(".wx-mosaic") as HTMLElement;
    expect(edgeMosaic.querySelectorAll("img").length).toBe(edgeFit.cols * edgeFit.rows);
    const srcs = [...edgeMosaic.querySelectorAll("img")].map((img) => (img as HTMLImageElement).src);
    expect(srcs.some((src) => src.includes("/256/7/40/"))).toBe(true);
    expect(srcs.some((src) => src.includes("/256/7/39/"))).toBe(true);
    edge.destroy();
  });
});
