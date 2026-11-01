/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import type { Driver, TowerRow } from "../data/types";
import { bindDriverSelect } from "../lib/bindSelect";
import { state } from "../state";
import { renderTower } from "./tower";

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: "e10600",
    first_name: code,
    last_name: code,
  };
}

function row(n: number, code: string, pos: number, extra: Partial<TowerRow> = {}): TowerRow {
  return {
    pos,
    driver: driver(n, code),
    compound: "SOFT",
    tyreAge: 8,
    lastLap: 78.123,
    lastLapDelta: 0.222,
    bestLap: 77.901,
    interval: pos === 1 ? null : 0.412,
    gap: pos === 1 ? 0 : 1.234,
    status: "ON TRACK",
    currentLap: 18,
    s1: 23.1,
    s2: 28.2,
    s3: 26.8,
    s1Kind: "none",
    s2Kind: "personal",
    s3Kind: "none",
    segments: [2049, 2049, 0],
    inPit: false,
    retired: false,
    pitOut: false,
    pits: 1,
    progress: 0.4,
    gridPos: null,
    posChange: null,
    ...extra,
  };
}

describe("renderTower", () => {
  afterEach(() => {
    state.selectedDrivers = [];
    state.selectedDriver = null;
  });

  it("uses table-layout class and a colgroup with explicit column classes", () => {
    const table = renderTower([row(1, "VER", 1)], { cols: "timing" });
    expect(table.classList.contains("tower")).toBe(true);
    expect(table.classList.contains("cols-timing")).toBe(true);
    const cols = [...table.querySelectorAll("col")].map((c) => c.className);
    expect(cols).toEqual([
      "c-pos",
      "c-drv",
      "c-tyre",
      "c-pits",
      "c-lap",
      "c-ldelta",
      "c-lap",
      "c-gap",
      "c-gap",
      "c-n",
      "c-sec",
      "c-sec",
      "c-sec",
      "c-mini",
    ]);
    expect(table.querySelectorAll("th").length).toBe(cols.length);
    const heads = [...table.querySelectorAll("th")].map((th) => th.textContent);
    expect(heads).toContain("Pits");
    const lastAt = heads.indexOf("Last");
    expect(heads[lastAt + 1]).toBe("Δ");
    expect(heads[lastAt + 2]).toBe("Best");
    const delta = table.querySelector("td.c-ldelta");
    expect(delta?.textContent).toBe("+0.222");
    expect(delta?.querySelector(".slower")).not.toBeNull();
    expect(table.querySelector("td.c-pits")?.textContent).toBe("1");
  });

  it("puts the previous-lap delta between Last and Best on the basic tower", () => {
    const table = renderTower(
      [row(1, "VER", 1, { lastLapDelta: -0.312 }), row(44, "HAM", 2, { lastLapDelta: null })],
      { cols: "basic" },
    );
    const heads = [...table.querySelectorAll("th")].map((th) => th.textContent);
    const lastAt = heads.indexOf("Last");
    expect(heads[lastAt + 1]).toBe("Δ");
    expect(heads[lastAt + 2]).toBe("Best");
    expect(table.querySelectorAll("col.c-ldelta")).toHaveLength(1);
    const ver = table.querySelector("tr[data-driver='1'] td.c-ldelta");
    expect(ver?.textContent).toBe("-0.312");
    expect(ver?.querySelector(".faster")).not.toBeNull();
    expect(table.querySelector("tr[data-driver='44'] td.c-ldelta")?.textContent).toBe("");
  });

  it("selects a driver on pointerdown, clears on a second press, and shift-add works", () => {
    const table = renderTower([row(1, "VER", 1), row(44, "HAM", 2)], { cols: "basic" });
    bindDriverSelect(table);
    const ver = table.querySelector<HTMLTableRowElement>("tr[data-driver='1']")!;
    const ham = table.querySelector<HTMLTableRowElement>("tr[data-driver='44']")!;
    ver.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.selectedDrivers).toEqual([1]);
    ham.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, shiftKey: true }));
    expect(state.selectedDrivers).toEqual([1, 44]);
    ver.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.selectedDrivers).toEqual([1]);
    ver.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(state.selectedDrivers).toEqual([]);
  });
});
