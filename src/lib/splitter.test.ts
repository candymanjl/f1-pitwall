import { describe, expect, it } from "vitest";
import { clampSplit, readSplitWidth, splitWidthFromDrag, writeSplitWidth } from "./splitter";

describe("column splitter", () => {
  it("clamps a drag and ignores a non-numeric width", () => {
    expect(splitWidthFromDrag(300, 10, 80, 280, 560)).toBe(370);
    expect(splitWidthFromDrag(300, 40, 0, 280, 560)).toBe(280);
    expect(splitWidthFromDrag(500, 0, 200, 280, 560)).toBe(560);
    expect(clampSplit(Number.NaN, 280, 560)).toBe(280);
  });

  it("remembers a width and rejects values outside the range", () => {
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
    expect(readSplitWidth("f1pitwall.telemetryDriversWidth", 352, 280, 560)).toBe(352);
    writeSplitWidth("f1pitwall.telemetryDriversWidth", 410.4);
    expect(readSplitWidth("f1pitwall.telemetryDriversWidth", 352, 280, 560)).toBe(410);
    writeSplitWidth("f1pitwall.telemetryDriversWidth", 900);
    expect(readSplitWidth("f1pitwall.telemetryDriversWidth", 352, 280, 560)).toBe(560);
  });
});
