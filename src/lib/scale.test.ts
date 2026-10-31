import { describe, expect, it } from "vitest";
import { applyUiScale, autoScale, parseUiScale, resolveScale } from "./scale";

describe("autoScale", () => {
  it("is 1× at 1080p and grows to fill 1440p / 4K", () => {
    expect(autoScale(1920, 1080)).toBeCloseTo(1, 5);
    expect(autoScale(2560, 1440)).toBeCloseTo(2560 / 1920, 5);
    expect(autoScale(3840, 2160)).toBe(2);
  });

  it("does not shrink below 1× on smaller viewports", () => {
    expect(autoScale(1366, 768)).toBe(1);
    expect(autoScale(800, 600)).toBe(1);
  });
});

describe("resolveScale / parseUiScale", () => {
  it("honors a manual percent and ignores viewport", () => {
    expect(resolveScale(150, 3840, 2160)).toBe(1.5);
    expect(resolveScale(100, 3840, 2160)).toBe(1);
    expect(resolveScale("auto", 3840, 2160)).toBe(2);
  });

  it("parses stored preferences", () => {
    expect(parseUiScale("auto")).toBe("auto");
    expect(parseUiScale("175")).toBe(175);
    expect(parseUiScale("90")).toBe("auto");
  });
});

describe("applyUiScale", () => {
  it("writes --ui-scale and a rem root font-size", () => {
    const root = { style: { fontSize: "", props: {} as Record<string, string>, setProperty(k: string, v: string) { this.props[k] = v; } } };
    const scale = applyUiScale("auto", { width: 2560, height: 1440 }, root as unknown as HTMLElement);
    expect(scale).toBeCloseTo(2560 / 1920, 5);
    expect(root.style.props["--ui-scale"]).toBe(String(scale));
    expect(root.style.fontSize).toBe(`${16 * scale}px`);
  });
});
