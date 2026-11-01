import "./timing.css";
import type { SectorKind } from "../data/types";
import { bindDriverSelect } from "../lib/bindSelect";
import { el } from "../lib/dom";
import { formatSector } from "../lib/time";
import { panel } from "../ui/panel";
import { renderTower } from "../ui/tower";
import { state } from "../state";
import {
  driverTimingAt,
  formatSectorDelta,
  segmentClass,
  segmentLabel,
  sessionMiniSlots,
  type SectorReadout,
} from "./timingSectors";

function legendSwatch(kind: string, text: string): HTMLElement {
  return el("span", { class: `lg ${kind}`, text });
}

function paintSector(cell: HTMLElement, read: SectorReadout): void {
  cell.classList.remove("sec-purple", "sec-green", "sec-yellow");
  const kind: SectorKind = read.kind;
  if (kind === "overall") cell.classList.add("sec-purple");
  else if (kind === "personal") cell.classList.add("sec-green");
  else if (kind === "yellow") cell.classList.add("sec-yellow");
  if (read.held) cell.dataset.held = "1";
  else delete cell.dataset.held;
  const time = formatSector(read.time);
  const delta = read.delta == null ? "" : formatSectorDelta(read.delta);
  cell.replaceChildren(el("span", { class: "sec-time", text: time }));
  if (delta) {
    const faster = (read.delta ?? 0) < -0.0005;
    const slower = (read.delta ?? 0) > 0.0005;
    cell.append(el("span", { class: `sec-delta${faster ? " faster" : slower ? " slower" : ""}`, text: delta }));
  }
  cell.title = delta ? `${time} ${delta} vs previous lap` : time === "—" ? "" : time;
}

/** Mini-sectors sit ahead of the S1/S2/S3 clocks. The shared tower keeps Mini last. */
function placeMiniBeforeSectors(table: HTMLTableElement): void {
  const miniCol = table.querySelector("col.c-mini");
  const firstSecCol = table.querySelector("col.c-sec");
  if (miniCol && firstSecCol) firstSecCol.before(miniCol);
  for (const row of table.querySelectorAll("tr")) {
    const mini = row.querySelector(".c-mini");
    const firstSec = row.querySelector(".c-sec");
    if (mini && firstSec) firstSec.before(mini);
  }
}

function miniGroup(label: string, codes: Array<number | null>): HTMLElement {
  const group = el("div", { class: "mini-group" });
  group.dataset.sector = label;
  group.setAttribute("aria-label", `${label} mini sectors`);
  for (const code of codes) {
    const tick = el("i", { class: `seg ${segmentClass(code)}` });
    tick.title = segmentLabel(code);
    group.append(tick);
  }
  return group;
}

export function mountTiming(parent: HTMLElement): { update: () => void } {
  const legend = el("div", { class: "timing-legend" }, [
    legendSwatch("overall", "Overall best"),
    legendSwatch("personal", "Personal best"),
    legendSwatch("other", "Other"),
    legendSwatch("pit", "Pit lane"),
  ]);
  const tablePanel = panel("Live timing  ·  2025-style sectors  ·  no team radio", "", legend);
  const page = el("div", { class: "page timing" }, [tablePanel.root]);
  parent.append(page);
  bindDriverSelect(tablePanel.body);

  const update = () => {
    const snap = state.snap;
    tablePanel.setError(!snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null);
    tablePanel.body.replaceChildren();
    if (!snap) return;
    const table = renderTower(snap.rows, {
      cols: "timing",
      selected: state.selectedDriver,
      showSegments: true,
    });
    const bundle = state.bundle;
    const slots = sessionMiniSlots(bundle?.laps ?? []);
    page.style.setProperty(
      "--mini-track",
      `${Math.max(1, slots.s1)}fr ${Math.max(1, slots.s2)}fr ${Math.max(1, slots.s3)}fr`,
    );

    const head = table.querySelector("th.c-mini");
    if (head) {
      head.replaceChildren(
        el("span", { class: "mini-head" }, [el("span", { text: "S1" }), el("span", { text: "S2" }), el("span", { text: "S3" })]),
      );
    }

    if (bundle) {
      for (const tr of table.querySelectorAll<HTMLTableRowElement>("tbody tr")) {
        const driver = Number(tr.dataset.driver);
        if (!Number.isFinite(driver)) continue;
        const view = driverTimingAt(bundle.laps, driver, snap.now, slots);
        const cells = tr.querySelectorAll<HTMLElement>("td.c-sec");
        if (cells[0]) paintSector(cells[0], view.s1);
        if (cells[1]) paintSector(cells[1], view.s2);
        if (cells[2]) paintSector(cells[2], view.s3);
        const mini = tr.querySelector("td.c-mini");
        if (mini) {
          mini.replaceChildren(
            el("div", { class: "mini-sectors" }, [
              miniGroup("S1", view.minis.s1),
              miniGroup("S2", view.minis.s2),
              miniGroup("S3", view.minis.s3),
            ]),
          );
        }
      }
    }
    placeMiniBeforeSectors(table);
    tablePanel.body.append(table);
  };
  return { update };
}
