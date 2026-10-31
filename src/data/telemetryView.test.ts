import { describe, expect, it } from "vitest";
import {
  brushFromPointer,
  cornerWindow,
  defaultTracePrefs,
  laneHeight,
  normalizeTrace,
  readTracePrefs,
  resetBrush,
  slicePolyline,
  traceDash,
  visibleTraces,
  writeTracePrefs,
  TRACE_IDS,
} from "./telemetryView";

describe("telemetry brush", () => {
  it("resets to the full lap", () => {
    expect(resetBrush()).toEqual({ start: 0, end: 1 });
  });

  it("slides the selection without changing its width and stops at the ends", () => {
    const origin = { start: 0.2, end: 0.5 };
    const moved = brushFromPointer("move", origin, 0.3, 0.4);
    expect(moved.start).toBeCloseTo(0.3);
    expect(moved.end).toBeCloseTo(0.6);
    const pinned = brushFromPointer("move", origin, 0.2, 0.95);
    expect(pinned.end).toBeCloseTo(1);
    expect(pinned.end - pinned.start).toBeCloseTo(0.3);
    const left = brushFromPointer("move", origin, 0.4, 0);
    expect(left.start).toBeCloseTo(0);
    expect(left.end - left.start).toBeCloseTo(0.3);
  });

  it("drags each handle and keeps a minimum span", () => {
    const origin = { start: 0.2, end: 0.6 };
    const next = brushFromPointer("start", origin, 0.2, 0.55);
    expect(next.start).toBeGreaterThan(0.5);
    expect(next.end).toBeCloseTo(0.6);
    expect(next.end - next.start).toBeGreaterThanOrEqual(0.02);
    expect(brushFromPointer("end", origin, 0.6, 0.9).end).toBeCloseTo(0.9);
  });

  it("opens a corner window and clamps it onto the lap", () => {
    const mid = cornerWindow(0.4, 0.06);
    expect(mid.start).toBeCloseTo(0.34);
    expect(mid.end).toBeCloseTo(0.46);
    const start = cornerWindow(0, 0.06);
    expect(start.start).toBeCloseTo(0);
    expect(start.end).toBeGreaterThan(0.02);
    const end = cornerWindow(1, 0.06);
    expect(end.end).toBeCloseTo(1);
    expect(end.start).toBeLessThan(1);
  });
});

describe("telemetry traces", () => {
  it("drops hidden channels and gives the rest the full height", () => {
    const prefs = defaultTracePrefs();
    prefs.visible.brake = false;
    prefs.visible.gear = false;
    prefs.visible.drs = false;
    const shown = visibleTraces(prefs);
    expect(shown).toEqual(["speed", "throttle", "rpm", "delta"]);
    expect(laneHeight(640, shown.length)).toBeCloseTo(160);
    expect(laneHeight(640, 7)).toBeCloseTo(640 / 7);
    prefs.visible.speed = false;
    prefs.visible.throttle = false;
    prefs.visible.rpm = false;
    prefs.visible.delta = false;
    expect(visibleTraces(prefs)).toEqual([]);
    expect(laneHeight(640, 0)).toBe(640);
  });

  it("normalizes each channel onto 0..1 and gives every channel its own line style", () => {
    expect(normalizeTrace(20, 0, 40)).toBeCloseTo(0.5);
    expect(normalizeTrace(0, 0, 40)).toBeCloseTo(0);
    expect(normalizeTrace(40, 0, 40)).toBeCloseTo(1);
    expect(normalizeTrace(7, 7, 7)).toBeCloseTo(0.5);
    const dashes = TRACE_IDS.map((id) => traceDash(id).join(","));
    expect(new Set(dashes).size).toBe(TRACE_IDS.length);
  });

  it("remembers overlay mode and which channels are on", () => {
    const memory = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => void memory.set(key, value),
        removeItem: (key: string) => void memory.delete(key),
        clear: () => memory.clear(),
        key: (index: number) => [...memory.keys()][index] ?? null,
        get length() {
          return memory.size;
        },
      },
      configurable: true,
    });
    const prefs = defaultTracePrefs();
    prefs.overlay = true;
    prefs.visible.rpm = false;
    writeTracePrefs(prefs);
    const again = readTracePrefs();
    expect(again.overlay).toBe(true);
    expect(again.visible.rpm).toBe(false);
    expect(again.visible.speed).toBe(true);
  });
});

describe("mini-map section", () => {
  it("returns the polyline between two lap fractions", () => {
    const pts: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    const slice = slicePolyline(pts, 0.25, 0.5);
    expect(slice[0][0]).toBeCloseTo(50);
    expect(slice[0][1]).toBeCloseTo(0);
    expect(slice[slice.length - 1][0]).toBeCloseTo(100);
    expect(slice[slice.length - 1][1]).toBeCloseTo(0);
  });
});
