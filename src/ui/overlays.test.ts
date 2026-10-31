/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyLoadingOverlay, closeAllModals, shouldShowLoadingOverlay } from "./overlays";

describe("shouldShowLoadingOverlay", () => {
  it("shows only while a fetch is in flight and the live lock is off", () => {
    expect(shouldShowLoadingOverlay("Loading session data from OpenF1…", null)).toBe(true);
    expect(shouldShowLoadingOverlay("Retrying OpenF1…", "live")).toBe(false);
    expect(shouldShowLoadingOverlay("", null)).toBe(false);
    expect(shouldShowLoadingOverlay("", "live")).toBe(false);
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
    expect(el.textContent).toBe("Loading OpenF1…");
    expect(el.getAttribute("aria-hidden")).toBe("false");

    applyLoadingOverlay(el, false, "Loading OpenF1…");
    expect(el.hidden).toBe(true);
    expect(el.hasAttribute("hidden")).toBe(true);
    expect(el.classList.contains("is-visible")).toBe(false);
    expect(el.style.pointerEvents).toBe("none");
    expect(el.textContent).toBe("");
    expect(el.getAttribute("aria-hidden")).toBe("true");
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
  });
});
