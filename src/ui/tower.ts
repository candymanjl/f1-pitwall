import { sectorColor, teamColor, tyreColor } from "../lib/colors";
import { el } from "../lib/dom";
import { formatDelta, formatLap, formatSector } from "../lib/time";
import type { TowerRow } from "../data/types";

export type TowerCols = "basic" | "timing" | "strategy";

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

function nameCell(row: TowerRow): HTMLElement {
  const dot = el("span", { class: "swatch" });
  dot.style.background = teamColor(row.driver.team_colour);
  return el("span", { class: "code" }, [dot, document.createTextNode(row.driver.name_acronym)]);
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
    onSelect?: (n: number) => void;
    showSegments?: boolean;
  },
): HTMLTableElement {
  const table = el("table", { class: "tower" });
  const head = el("thead");
  const labels =
    opts.cols === "timing"
      ? ["", "Driver", "Tyre", "Last", "Best", "Int", "Gap", "Lap", "S1", "S2", "S3", "Mini"]
      : opts.cols === "strategy"
        ? ["", "Driver", "Tyre", "Age", "Pace", "Deg", "Int", "Gap", "Traffic"]
        : ["", "Driver", "Tyre", "Last", "Best", "Int", "Gap", "Status"];
  head.append(el("tr", {}, labels.map((l) => el("th", { text: l }))));
  table.append(head);
  const body = el("tbody");
  for (const row of rows) {
    const tr = el("tr", { class: row.driver.driver_number === opts.selected ? "sel" : "" });
    tr.addEventListener("click", () => opts.onSelect?.(row.driver.driver_number));
    const cells: HTMLElement[] = [
      el("td", { class: "pos", text: String(row.pos) }),
      el("td", {}, [nameCell(row)]),
    ];
    if (opts.cols === "basic") {
      cells.push(
        el("td", {}, [tyreCell(row)]),
        el("td", { text: formatLap(row.lastLap) }),
        el("td", { text: formatLap(row.bestLap) }),
        el("td", { text: row.pos === 1 ? "—" : formatDelta(row.interval) }),
        el("td", { text: row.pos === 1 ? "LEADER" : formatDelta(row.gap) }),
        el("td", { class: `status ${row.retired ? "out" : row.inPit ? "pit" : ""}`, text: row.status }),
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
      cells.push(
        el("td", {}, [tyreCell(row)]),
        el("td", { text: formatLap(row.lastLap) }),
        el("td", { text: formatLap(row.bestLap) }),
        el("td", { text: row.pos === 1 ? "—" : formatDelta(row.interval) }),
        el("td", { text: row.pos === 1 ? "LEADER" : formatDelta(row.gap) }),
        el("td", { text: row.currentLap != null ? String(row.currentLap) : "—" }),
        el("td", { class: secClass(row.s1Kind), text: formatSector(row.s1) }),
        el("td", { class: secClass(row.s2Kind), text: formatSector(row.s2) }),
        el("td", { class: secClass(row.s3Kind), text: formatSector(row.s3) }),
        segs,
      );
    }
    tr.append(...cells);
    body.append(tr);
  }
  table.append(body);
  return table;
}

export { sectorColor };
