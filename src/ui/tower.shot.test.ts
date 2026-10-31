/** @vitest-environment happy-dom */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Driver, TowerRow } from "../data/types";
import { driverNameCell, renderTower } from "./tower";

function driver(n: number, code: string, colour: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Team",
    team_colour: colour,
    first_name: code,
    last_name: code,
  };
}

function row(partial: Partial<TowerRow> & { driver: Driver; pos: number; posChange: number | null }): TowerRow {
  return {
    compound: "MEDIUM",
    tyreAge: 8,
    lastLap: 79.4,
    bestLap: 78.9,
    interval: partial.pos === 1 ? null : 0.412,
    gap: partial.pos === 1 ? null : 0.412,
    status: "ON TRACK",
    currentLap: 18,
    s1: 22.1,
    s2: 29.4,
    s3: 27.9,
    s1Kind: "none",
    s2Kind: "personal",
    s3Kind: "none",
    segments: Array.from({ length: 22 }, () => 2049),
    inPit: false,
    retired: false,
    pitOut: false,
    pits: 1,
    progress: 0.4,
    gridPos: partial.gridPos ?? null,
    ...partial,
  };
}

describe("positions gained/lost badge", () => {
  it("renders up, down, and unchanged marks at a fixed width", () => {
    const gained = row({
      driver: driver(4, "NOR", "FF8000"),
      pos: 2,
      gridPos: 5,
      posChange: 3,
    });
    const lost = row({
      driver: driver(16, "LEC", "E8002D"),
      pos: 6,
      gridPos: 2,
      posChange: -4,
    });
    const flat = row({
      driver: driver(1, "VER", "3671C6"),
      pos: 1,
      gridPos: 1,
      posChange: 0,
    });
    const practice = row({
      driver: driver(44, "HAM", "27F4D2"),
      pos: 3,
      posChange: null,
    });

    const up = driverNameCell(gained);
    const down = driverNameCell(lost);
    const same = driverNameCell(flat);
    const hidden = driverNameCell(practice);
    expect(up.querySelector(".pos-delta.up")?.textContent).toMatch(/▲\s*3/);
    expect(down.querySelector(".pos-delta.down")?.textContent).toMatch(/▼\s*4/);
    expect(same.querySelector(".pos-delta.flat")).toBeTruthy();
    expect(hidden.querySelector(".pos-delta")).toBeNull();

    const table = renderTower(
      [
        flat,
        gained,
        row({ driver: driver(81, "PIA", "FF8000"), pos: 3, gridPos: 4, posChange: 1, lastLap: 79.8, interval: 1.2, gap: 1.6 }),
        row({ driver: driver(63, "RUS", "27F4D2"), pos: 4, gridPos: 4, posChange: 0, lastLap: 80.1, interval: 0.3, gap: 1.9 }),
        row({ driver: driver(44, "HAM", "27F4D2"), pos: 5, gridPos: 8, posChange: 3, lastLap: 80.4, interval: 0.8, gap: 2.7 }),
        lost,
      ],
      { cols: "timing" },
    );
    expect(table.querySelectorAll(".pos-delta").length).toBe(6);

    const css = readFileSync(resolve("src/styles.css"), "utf8");
    writeFileSync(
      "/tmp/tower-pos-delta.html",
      `<!doctype html><html><head><meta charset="utf-8"><title>Positions gained/lost</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Titillium+Web:wght@400;600;700&display=swap" rel="stylesheet" />
<style>${css}
  html,body{margin:0;background:#07080d;color:#f4f6fb}
  .shot{width:1280px;min-height:720px;padding:16px;box-sizing:border-box}
  .page.timing{display:block;height:auto}
</style></head><body><div class="shot">
<header class="topbar"><div class="brand"><span class="bar"></span><span>F1</span></div>
<div class="session-title">TIMING · POSITIONS GAINED / LOST</div>
<div class="session-clock">RACE</div><div class="brand-right"><span>F1</span> TV</div></header>
<p class="legend" style="padding:10px 0">Races/sprints only · ▲ gained · ▼ lost · white line unchanged · fixed 28px</p>
<section class="panel"><div class="panel-h">Timing tower</div>
<div class="panel-b">${table.outerHTML}</div></section>
</div></body></html>`,
    );
  });
});
