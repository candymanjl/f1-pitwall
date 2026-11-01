/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { FLAG_LABEL, FLAG_SHEET_KINDS, sheetFlagState } from "../data/trackFlag";
import { buildFlagSvg, mountFlagSheet, renderFlagIndicator } from "./flagIcon";

describe("flag icons", () => {
  it("draws a waving cloth with fold shading and no pole", () => {
    const svg = buildFlagSvg(sheetFlagState("yellow"));
    expect(svg.getAttribute("viewBox")).toBe("0 0 72 42");
    expect(svg.querySelectorAll("linearGradient").length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelector("line")).toBeNull();
    expect(svg.querySelector(".flag-badge")?.textContent).toBe("S2");
  });

  it("draws double yellow as two mirrored flags waving away from each other", () => {
    const svg = buildFlagSvg(sheetFlagState("doubleYellow"));
    expect(svg.getAttribute("viewBox")).toBe("0 0 132 44");
    const groups = [...svg.children].filter((n) => n.tagName.toLowerCase() === "g");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const transforms = groups.map((g) => g.getAttribute("transform") ?? "");
    expect(transforms.some((t) => t.includes("scale(-1"))).toBe(true);
    expect(transforms.some((t) => t.includes("scale(-1")) && transforms.some((t) => !t.includes("scale(-1"))).toBe(true);
  });

  it("paints SC and VSC on a yellow cloth", () => {
    const sc = buildFlagSvg(sheetFlagState("sc"));
    expect(sc.textContent).toContain("SC");
    const vsc = buildFlagSvg(sheetFlagState("vsc"));
    expect(vsc.textContent).toContain("VSC");
  });

  it("renders the indicator with a dash-free label beside the svg", () => {
    const root = renderFlagIndicator(sheetFlagState("red"));
    expect(root.className).toBe("flag-indicator");
    expect(root.dataset.kind).toBe("red");
    expect(root.querySelector("svg.flag-svg")).toBeTruthy();
    expect(root.querySelector(".flag-name")?.textContent).toBe("RED FLAG");
    expect(root.querySelector(".flag-name")?.textContent).not.toMatch(/-/);
  });

  it("mounts a sheet of every flag kind", () => {
    const host = document.createElement("div");
    const sheet = mountFlagSheet(host);
    expect(sheet.getAttribute("data-flagsheet")).toBe("1");
    expect(sheet.querySelectorAll(".flag-sheet-cell")).toHaveLength(FLAG_SHEET_KINDS.length);
    for (const kind of FLAG_SHEET_KINDS) {
      const cell = sheet.querySelector(`[data-kind="${kind}"]`);
      expect(cell?.textContent).toContain(FLAG_LABEL[kind]);
      expect(cell?.querySelector("svg.flag-svg")).toBeTruthy();
    }
  });
});
