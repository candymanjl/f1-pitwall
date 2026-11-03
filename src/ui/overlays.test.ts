/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyLoadingOverlay,
  closeAllModals,
  loadSessionButtonBusy,
  loadSessionButtonText,
  shouldShowLoadingOverlay,
} from "./overlays";

describe("shouldShowLoadingOverlay", () => {
  it("shows only while a fetch is in flight and the live lock is off", () => {
    expect(shouldShowLoadingOverlay("Loading session data from OpenF1…", null)).toBe(true);
    expect(shouldShowLoadingOverlay("Retrying OpenF1…", "live")).toBe(false);
    expect(shouldShowLoadingOverlay("", null)).toBe(false);
    expect(shouldShowLoadingOverlay("", "live")).toBe(false);
  });
});

describe("loadSessionButtonText", () => {
  it("keeps Loading session… on every Load, even with a bundle already on screen", () => {
    expect(loadSessionButtonText("Loading session…", false)).toBe("Loading session…");
    expect(loadSessionButtonText("Loading session…", true)).toBe("Loading session…");
    expect(loadSessionButtonText("Loading timing…", true)).toBe("Loading timing…");
    expect(loadSessionButtonText("", true)).toBe("Load");
    expect(loadSessionButtonBusy("Loading session…", true, 99)).toBe(true);
    expect(loadSessionButtonBusy("Loading session…", false, 99)).toBe(true);
    expect(loadSessionButtonBusy("", true, 99)).toBe(false);
    expect(loadSessionButtonBusy("", false, 0)).toBe(true);
  });
});

describe("applyLoadingOverlay", () => {
  it("disarms the veil so a hidden overlay cannot intercept clicks after load", () => {
    const el = document.createElement("div");
    el.className = "overlay";
    document.body.append(el);

    applyLoadingOverlay(el, true, "Loading OpenF1…");
    expect(el.hidden).toBe(false);
    expect(el.classList.contains("is-visible")).toBe(true);
    expect(el.style.pointerEvents).toBe("auto");
    expect(el.querySelector(".overlay-title")?.textContent).toBe("Loading OpenF1…");
    expect(el.getAttribute("aria-hidden")).toBe("false");

    applyLoadingOverlay(el, false, "Loading OpenF1…");
    expect(el.hidden).toBe(true);
    expect(el.hasAttribute("hidden")).toBe(true);
    expect(el.classList.contains("is-visible")).toBe(false);
    expect(el.style.pointerEvents).toBe("none");
    expect(el.style.zIndex).toBe("-1");
    expect(el.hasAttribute("inert")).toBe(true);
    expect(el.textContent).toBe("");
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });

  it("arms inert and a high z-index only while the veil is showing", () => {
    const node = document.createElement("div");
    node.className = "overlay";
    document.body.append(node);
    applyLoadingOverlay(node, true, "Loading session…", {
      done: 2,
      total: 8,
      label: "drivers",
      pct: 25,
    });
    expect(node.classList.contains("is-visible")).toBe(true);
    expect(node.hasAttribute("inert")).toBe(false);
    expect(node.style.zIndex).toBe("5");
    expect(node.style.pointerEvents).toBe("auto");

    applyLoadingOverlay(node, false);
    expect(node.hasAttribute("inert")).toBe(true);
    expect(node.style.pointerEvents).toBe("none");
    expect(node.style.zIndex).toBe("-1");
  });

  it("author display:flex cannot keep a hidden overlay painted or clickable", () => {
    const style = document.createElement("style");
    style.textContent = `
      .overlay { position: absolute; inset: 0; display: flex; }
      .overlay[hidden] { display: none !important; pointer-events: none !important; }
    `;
    document.head.append(style);
    const el = document.createElement("div");
    el.className = "overlay";
    document.body.append(el);
    applyLoadingOverlay(el, false);

    const cs = getComputedStyle(el);
    expect(cs.display).toBe("none");
    expect(el.style.pointerEvents).toBe("none");
  });

  it("paints a labeled percent bar for in-flight session fetches", () => {
    const node = document.createElement("div");
    node.className = "overlay";
    document.body.append(node);
    applyLoadingOverlay(node, true, "Loading session…", {
      done: 3,
      total: 10,
      label: "laps",
      pct: 30,
    });
    expect(node.querySelector(".overlay-title")?.textContent).toBe("Loading session…");
    expect(node.querySelector(".overlay-label")?.textContent).toBe("laps");
    expect(node.querySelector(".overlay-pct")?.textContent).toBe("30%");
    expect((node.querySelector(".overlay-bar-fill") as HTMLElement).style.width).toBe("30%");
    const bar = node.querySelector(".overlay-bar")!;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("30");
    expect(bar.getAttribute("aria-label")).toBe("laps 30%");
  });
});

describe("closeAllModals", () => {
  it("removes leftover Settings backdrops so they cannot block the page", () => {
    document.body.innerHTML = `<div class="modal-bg"></div><div class="modal-bg"></div><div id="keep"></div>`;
    expect(closeAllModals()).toBe(2);
    expect(document.querySelector(".modal-bg")).toBeNull();
    expect(document.getElementById("keep")).not.toBeNull();
  });
});

describe("overlay CSS regression", () => {
  it("forces [hidden] overlays off with !important so display:flex cannot win", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\.overlay\[hidden\]/);
    expect(css).toMatch(/\.overlay\[hidden\][\s\S]*?display:\s*none\s*!important/);
    expect(css).toMatch(/\.overlay\[hidden\][\s\S]*?pointer-events:\s*none\s*!important/);
    expect(css).toMatch(/\.overlay:not\(\.is-visible\)/);
    expect(css).toMatch(/\.overlay-bar\b/);
    expect(css).toMatch(/\.overlay-bar-fill/);
  });
});
