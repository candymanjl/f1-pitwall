/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { el } from "../lib/dom";
import {
  applyTowerSplit,
  clampTowerSplitRem,
  mountTowerSplitter,
  readTowerSplitRem,
  TOWER_SPLIT_DEFAULT_REM,
  TOWER_SPLIT_STORAGE_KEY,
  writeTowerSplitRem,
} from "./splitter";

describe("tower splitter persistence", () => {
  it("clamps and persists a rem width", () => {
    expect(clampTowerSplitRem(36)).toBe(36);
    expect(clampTowerSplitRem(10)).toBe(24);
    expect(clampTowerSplitRem(99)).toBe(56);
    const store = new Map<string, string>();
    const mem = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(readTowerSplitRem(mem)).toBe(TOWER_SPLIT_DEFAULT_REM);
    expect(writeTowerSplitRem(40, mem)).toBe(40);
    expect(store.get(TOWER_SPLIT_STORAGE_KEY)).toBe("40");
    expect(readTowerSplitRem(mem)).toBe(40);
  });

  it("inserts a handle and writes --tower-split on the page", () => {
    const page = el("div", { class: "page trackmap" }, [el("section"), el("section")]);
    document.body.append(page);
    const { handle, widthRem } = mountTowerSplitter(page);
    expect(handle.classList.contains("splitter")).toBe(true);
    expect(page.children[1]).toBe(handle);
    expect(page.style.getPropertyValue("--tower-split")).toBe(`${TOWER_SPLIT_DEFAULT_REM}rem`);
    applyTowerSplit(page, 42);
    expect(page.style.getPropertyValue("--tower-split")).toBe("42rem");
    expect(widthRem()).toBe(TOWER_SPLIT_DEFAULT_REM);
    page.remove();
  });
});
