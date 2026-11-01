import { teamColor, tyreColor } from "../lib/colors";
import { el } from "../lib/dom";
import { formatDelta, formatLap, formatLapDelta, formatSector } from "../lib/time";
import type { TowerRow } from "../data/types";
import { hasDriverSelection, isDriverSelected } from "../state";

export type TowerCols = "basic" | "timing" | "strategy";

const LAST_BEST = [
  { label: "Last", cls: "c-lap" },
  { label: "Δ", cls: "c-ldelta" },
  { label: "Best", cls: "c-lap" },
] as const;

const COLS: Record<TowerCols, { label: string; cls: string }[]> = {
  basic: [
    { label: "", cls: "c-pos" },
    { label: "Driver", cls: "c-drv" },
    { label: "Tyre", cls: "c-tyre" },
    { label: "Pits", cls: "c-pits" },
    ...LAST_BEST,
    { label: "Int", cls: "c-gap" },
    { label: "Gap", cls: "c-gap" },
    { label: "Status", cls: "c-stat" },
  ],
  timing: [
    { label: "", cls: "c-pos" },
    { label: "Driver", cls: "c-drv" },
    { label: "Tyre", cls: "c-tyre" },
    { label: "Pits", cls: "c-pits" },
    ...LAST_BEST,
    { label: "Int", cls: "c-gap" },
    { label: "Gap", cls: "c-gap" },
    { label: "Lap", cls: "c-n" },
    { label: "S1", cls: "c-sec" },
    { label: "S2", cls: "c-sec" },
    { label: "S3", cls: "c-sec" },
    { label: "Mini", cls: "c-mini" },
  ],
  strategy: [
    { label: "", cls: "c-pos" },
    { label: "Driver", cls: "c-drv" },
    { label: "Tyre", cls: "c-tyre" },
    { label: "Pits", cls: "c-pits" },
    { label: "Age", cls: "c-n" },
    { label: "Pace", cls: "c-lap" },
    { label: "Deg", cls: "c-deg" },
    { label: "Int", cls: "c-gap" },
    { label: "Gap", cls: "c-gap" },
    { label: "Traffic", cls: "c-traf" },
  ],
};

function tyreCell(row: TowerRow): HTMLElement {
  const color = tyreColor(row.compound);
  const letter = (row.compound ?? "?").slice(0, 1);
  const node = el("span", { class: "tyre", text: letter });
  node.style.color = color;
  const wrap = el("span", { class: "code" }, [
    node,
    document.createTextNode(row.tyreAge != null ? String(row.tyreAge) : "—"),
  ]);
  return wrap;
}

export function posChangeBadge(row: TowerRow): HTMLElement | null {
  if (row.posChange == null) return null;
  const wrap = el("span", { class: "pos-delta" });
  if (row.posChange === 0) {
    wrap.classList.add("flat");
    wrap.setAttribute("aria-label", "positions unchanged");
    wrap.title = "Unchanged vs grid";
    return wrap;
  }
  if (row.posChange > 0) {
    wrap.classList.add("up");
    wrap.setAttribute("aria-label", `gained ${row.posChange}`);
    wrap.title = `+${row.posChange} vs grid`;
    wrap.append(el("span", { class: "arrow", text: "▲" }), el("span", { class: "n", text: String(row.posChange) }));
    return wrap;
  }
  wrap.classList.add("down");
  const lost = Math.abs(row.posChange);
  wrap.setAttribute("aria-label", `lost ${lost}`);
  wrap.title = `−${lost} vs grid`;
  wrap.append(el("span", { class: "arrow", text: "▼" }), el("span", { class: "n", text: String(lost) }));
  return wrap;
}

export function driverNameCell(row: TowerRow): HTMLElement {
  const dot = el("span", { class: "swatch" });
  dot.style.background = teamColor(row.driver.team_colour);
  const kids: Array<Node | string | null> = [dot, row.driver.name_acronym, posChangeBadge(row)];
  return el("span", { class: "code" }, kids);
}

function lapDeltaCell(delta: number | null | undefined): HTMLElement {
  const td = el("td", { class: "c-ldelta" });
  if (delta == null || !Number.isFinite(delta)) return td;
  const faster = delta < -0.0005;
  const slower = delta > 0.0005;
  const text = formatLapDelta(delta);
  td.title = faster ? `${text} faster than the previous lap` : slower ? `${text} slower than the previous lap` : "Level with the previous lap";
  td.append(el("span", { class: `lap-delta${faster ? " faster" : slower ? " slower" : ""}`, text }));
  return td;
}

function lastBestCells(row: TowerRow): HTMLElement[] {
  return [
    el("td", { class: "c-lap", text: formatLap(row.lastLap) }),
    lapDeltaCell(row.lastLapDelta),
    el("td", { class: "c-lap", text: formatLap(row.bestLap) }),
  ];
}

function secClass(kind: TowerRow["s1Kind"]): string {
  if (kind === "overall") return "sec-purple";
  if (kind === "personal") return "sec-green";
  if (kind === "yellow") return "sec-yellow";
  return "";
}

export function renderTower(
  rows: TowerRow[],
  opts: {
    cols: TowerCols;
    selected?: number | null;
    showSegments?: boolean;
  },
): HTMLTableElement {
  const spec = COLS[opts.cols];
  const table = el("table", { class: `tower cols-${opts.cols}` });
  const group = document.createElement("colgroup");
  for (const col of spec) {
    const c = document.createElement("col");
    c.className = col.cls;
    group.append(c);
  }
  table.append(group);
  const head = el("thead");
  head.append(el("tr", {}, spec.map((c) => el("th", { class: c.cls, text: c.label }))));
  table.append(head);
  const body = el("tbody");
  for (const row of rows) {
    const n = row.driver.driver_number;
    const on = isDriverSelected(n) || n === opts.selected;
    const tr = el("tr", {
      class: on ? "sel" : hasDriverSelection() ? "dim" : "",
      "data-driver": String(n),
    });
    const cells: HTMLElement[] = [
      el("td", { class: "pos c-pos", text: String(row.pos) }),
      el("td", { class: "c-drv" }, [driverNameCell(row)]),
    ];
    if (opts.cols === "basic") {
      cells.push(
        el("td", { class: "c-tyre" }, [tyreCell(row)]),
        el("td", { class: "c-pits", text: String(row.pits) }),
        ...lastBestCells(row),
        el("td", { class: "c-gap", text: row.pos === 1 ? "—" : formatDelta(row.interval) }),
        el("td", { class: "c-gap", text: row.pos === 1 ? "LEADER" : formatDelta(row.gap) }),
        el("td", { class: `status c-stat ${row.retired ? "out" : row.inPit ? "pit" : ""}`, text: row.status }),
      );
    } else if (opts.cols === "timing") {
      const segs = el("td");
      const bar = el("div", { class: "segments" });
      const segsSrc = row.segments.length ? row.segments : Array.from({ length: 22 }, () => 0);
      for (const code of segsSrc) {
        const i = el("i");
        i.style.background =
          code === 2048 ? "#eab308" : code === 2049 ? "#22c55e" : code === 2051 ? "#c084fc" : code === 2064 ? "#9ca3af" : "#1f2430";
        bar.append(i);
      }
      segs.append(bar);
      segs.className = "c-mini";
      cells.push(
        el("td", { class: "c-tyre" }, [tyreCell(row)]),
        el("td", { class: "c-pits", text: String(row.pits) }),
        ...lastBestCells(row),
        el("td", { class: "c-gap", text: row.pos === 1 ? "—" : formatDelta(row.interval) }),
        el("td", { class: "c-gap", text: row.pos === 1 ? "LEADER" : formatDelta(row.gap) }),
        el("td", { class: "c-n", text: row.currentLap != null ? String(row.currentLap) : "—" }),
        el("td", { class: `c-sec ${secClass(row.s1Kind)}`, text: formatSector(row.s1) }),
        el("td", { class: `c-sec ${secClass(row.s2Kind)}`, text: formatSector(row.s2) }),
        el("td", { class: `c-sec ${secClass(row.s3Kind)}`, text: formatSector(row.s3) }),
        segs,
      );
    }
    tr.append(...cells);
    body.append(tr);
  }
  table.append(body);
  return table;
}
