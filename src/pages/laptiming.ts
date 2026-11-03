import "./laptiming.css";
import {
  barHeightFrac,
  buildLapTimingModel,
  seedFromTower,
  toggleLapTimingId,
  type DriverLapCell,
  type DriverSummary,
  type LapTimingModel,
  type LapTimingView,
} from "../data/lapTiming";
import { compoundLetter } from "../data/tyres";
import type { SectorKind } from "../data/types";
import { teamColor, teamFill, tyreColor } from "../lib/colors";
import { addClass, el } from "../lib/dom";
import { formatDelta, formatLap, formatSector } from "../lib/time";
import { tyreAgeMark } from "../ui/tyreMark";
import {
  setLapTimingDrivers,
  setLapTimingView,
  state,
} from "../state";

function kindClass(kind: SectorKind | undefined): string {
  if (kind === "overall") return "sec-purple";
  if (kind === "personal") return "sec-green";
  if (kind === "yellow") return "sec-yellow";
  return "";
}

function viewLabel(view: LapTimingView): string {
  if (view === "chart") return "CHART";
  if (view === "table") return "TABLE";
  return "CHART + TABLE";
}

function noteTags(cell: DriverLapCell, code: string, multi: boolean): HTMLElement[] {
  const tags: HTMLElement[] = [];
  if (cell.pitIn) tags.push(el("span", { class: "lt-tag in", text: multi ? `${code} IN` : "IN" }));
  if (cell.pitOut) tags.push(el("span", { class: "lt-tag out", text: multi ? `${code} OUT` : "OUT" }));
  if (cell.sc) tags.push(el("span", { class: "lt-tag sc", text: "SC" }));
  if (cell.vsc) tags.push(el("span", { class: "lt-tag sc", text: "VSC" }));
  return tags;
}

function deltaNode(value: number | null): HTMLElement {
  const cell = el("span", { class: "lt-delta" });
  if (value == null || !Number.isFinite(value)) {
    cell.textContent = "—";
    return cell;
  }
  const faster = value < -0.0005;
  const slower = value > 0.0005;
  cell.classList.toggle("faster", faster);
  cell.classList.toggle("slower", slower);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  cell.textContent = `${sign}${Math.abs(value).toFixed(3)}`;
  return cell;
}

function paintCard(sum: DriverSummary, i: number): HTMLElement {
  const color = teamColor(sum.driver.team_colour);
  const card = el("article", { class: `lt-card${sum.striped ? " lt-stripe" : ""}` });
  card.style.setProperty("--team", color);
  card.style.borderColor = color;
  const best = el("div", { class: `lt-best${sum.bestIsOverall ? " overall" : ""}`, text: formatLap(sum.bestLap) });
  const avg = el("div", { class: "lt-avg", text: formatLap(sum.avgClean) });
  const stints = el("div", { class: "lt-stints" });
  for (const st of sum.stints) {
    const mark = el("span", { class: "tyre", text: compoundLetter(st.compound) });
    mark.style.color = tyreColor(st.compound);
    stints.append(el("span", { class: "lt-stint" }, [mark, document.createTextNode(`${st.start}–${st.end}`)]));
  }
  const head = el("div", { class: "lt-card-h" }, [
    el("span", { class: "lt-sq" }),
    el("strong", { text: `${sum.driver.driver_number} · ${sum.driver.name_acronym}` }),
    el("span", { class: "lt-team", text: `${sum.driver.team_name} · P${i + 1}` }),
  ]);
  (head.querySelector(".lt-sq") as HTMLElement).style.background = color;
  card.append(
    head,
    el("div", { class: "lt-metrics" }, [
      el("div", {}, [el("span", { class: "lt-k", text: "BEST" }), best]),
      el("div", {}, [el("span", { class: "lt-k", text: "AVG" }), avg]),
      el("div", {}, [el("span", { class: "lt-k", text: "STINTS" }), stints]),
      el("div", {}, [
        el("span", { class: "lt-k", text: "TOP SPEED" }),
        el("div", { class: "lt-spd", text: sum.topSpeed != null ? `${Math.round(sum.topSpeed)}` : "—" }),
      ]),
    ]),
  );
  return card;
}

function drawChart(svg: SVGSVGElement, model: LapTimingModel, vis: { from: number; to: number } | null, onLap: (n: number) => void): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const ns = "http://www.w3.org/2000/svg";
  const laps = model.laps;
  const nDrv = Math.max(1, model.selected.length);
  const box = svg.getBoundingClientRect();
  const w = Math.max(64, Math.round(box.width) || svg.clientWidth || 900);
  const h = Math.max(80, Math.round(box.height) || svg.clientHeight || 200);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const groupW = laps.length ? innerW / laps.length : innerW;
  const barW = Math.max(1.5, (groupW * 0.78) / nDrv);

  const defs = document.createElementNS(ns, "defs");
  for (const sum of model.selected) {
    if (!sum.striped) continue;
    const pat = document.createElementNS(ns, "pattern");
    pat.setAttribute("id", `lt-hatch-${sum.driver.driver_number}`);
    pat.setAttribute("width", "6");
    pat.setAttribute("height", "6");
    pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("patternTransform", "rotate(-45)");
    const bg = document.createElementNS(ns, "rect");
    bg.setAttribute("width", "6");
    bg.setAttribute("height", "6");
    bg.setAttribute("fill", teamColor(sum.driver.team_colour));
    const ln = document.createElementNS(ns, "line");
    ln.setAttribute("x1", "0");
    ln.setAttribute("x2", "0");
    ln.setAttribute("y1", "0");
    ln.setAttribute("y2", "6");
    ln.setAttribute("stroke", "rgba(0,0,0,0.45)");
    ln.setAttribute("stroke-width", "3");
    pat.append(bg, ln);
    defs.append(pat);
  }
  svg.append(defs);

  if (vis && laps.length) {
    const i0 = laps.findIndex((n) => n >= vis.from);
    const i1 = laps.findIndex((n) => n > vis.to);
    const a = i0 < 0 ? 0 : i0;
    const b = i1 < 0 ? laps.length : i1;
    const box = document.createElementNS(ns, "rect");
    box.setAttribute("x", String(padL + a * groupW));
    box.setAttribute("y", String(padT));
    box.setAttribute("width", String(Math.max(groupW, (b - a) * groupW)));
    box.setAttribute("height", String(innerH));
    box.setAttribute("fill", "rgba(255,255,255,0.05)");
    box.setAttribute("stroke", "rgba(255,255,255,0.18)");
    box.setAttribute("class", "lt-vis");
    svg.append(box);
  }

  const dash = document.createElementNS(ns, "line");
  dash.setAttribute("x1", String(padL));
  dash.setAttribute("x2", String(w - padR));
  dash.setAttribute("y1", String(padT + innerH));
  dash.setAttribute("y2", String(padT + innerH));
  dash.setAttribute("stroke", "#8b93a7");
  dash.setAttribute("stroke-dasharray", "4 4");
  dash.setAttribute("stroke-width", "1");
  svg.append(dash);

  laps.forEach((lapNo, i) => {
    const gx = padL + i * groupW;
    const g = document.createElementNS(ns, "g");
    g.setAttribute("data-lap", String(lapNo));
    g.style.cursor = "pointer";
    g.addEventListener("click", () => onLap(lapNo));
    model.selected.forEach((sum, di) => {
      const cell = model.cells.get(sum.driver.driver_number)?.get(lapNo);
      const frac = barHeightFrac(cell?.time ?? null, model.bestTime);
      const bh = frac * innerH;
      const rect = document.createElementNS(ns, "rect");
      const x = gx + groupW * 0.11 + di * barW;
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(padT + innerH - bh));
      rect.setAttribute("width", String(Math.max(1, barW - 0.6)));
      rect.setAttribute("height", String(Math.max(0, bh)));
      const fill = sum.striped
        ? `url(#lt-hatch-${sum.driver.driver_number})`
        : teamColor(sum.driver.team_colour);
      rect.setAttribute("fill", cell?.time == null ? "transparent" : fill);
      if (cell?.sc || cell?.vsc) rect.setAttribute("fill-opacity", "0.85");
      g.append(rect);
    });
    svg.append(g);

    const stripY = h - 14;
    const sc = model.scLaps.has(lapNo) || model.vscLaps.has(lapNo) || model.yellowLaps.has(lapNo);
    const pit = model.pitLaps.get(lapNo);
    const best = model.selected.some((s) => {
      const c = model.cells.get(s.driver.driver_number)?.get(lapNo);
      return c?.timeKind === "overall";
    });
    if (sc || pit?.inn || pit?.out || best) {
      const tick = document.createElementNS(ns, "rect");
      tick.setAttribute("x", String(gx + groupW * 0.2));
      tick.setAttribute("y", String(stripY));
      tick.setAttribute("width", String(Math.max(2, groupW * 0.6)));
      tick.setAttribute("height", "4");
      tick.setAttribute("rx", "1");
      tick.setAttribute(
        "fill",
        sc ? "#eab308" : pit?.inn || pit?.out ? "#38bdf8" : "#c084fc",
      );
      svg.append(tick);
    }
    if (lapNo === 1 || lapNo % 5 === 0 || i === laps.length - 1) {
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", String(gx + groupW / 2));
      t.setAttribute("y", String(h - 2));
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("fill", "#8b93a7");
      t.setAttribute("font-size", "9");
      t.textContent = String(lapNo);
      svg.append(t);
    }
  });
}

function paintTable(model: LapTimingModel, wrap: HTMLElement, jumpLap: number | null): void {
  wrap.replaceChildren();
  const multi = model.selected.length >= 2;
  const one = model.selected.length === 1;
  const table = el("table", { class: "lt-table" });
  const thead = el("thead");
  const h1 = el("tr");
  h1.append(el("th", { class: "lt-lap", rowspan: "2", text: "LAP" }));
  for (const sum of model.selected) {
    const th = el("th", {
      class: `lt-drv-h${sum.striped ? " lt-stripe" : ""}`,
      colspan: String(one ? 12 : 7),
    });
    th.style.setProperty("--team", teamColor(sum.driver.team_colour));
    th.append(
      el("span", { class: "lt-sq" }),
      document.createTextNode(` ${sum.driver.name_acronym}`),
    );
    (th.querySelector(".lt-sq") as HTMLElement).style.background = teamColor(sum.driver.team_colour);
    h1.append(th);
  }
  if (multi) {
    for (const sum of model.selected.slice(1)) {
      h1.append(el("th", { class: "lt-dcol", rowspan: "2", text: `Δ ${sum.driver.name_acronym}−${model.selected[0].driver.name_acronym}` }));
    }
  }
  h1.append(el("th", { class: "lt-notes", rowspan: "2", text: "NOTES" }));
  thead.append(h1);
  const h2 = el("tr");
  const sub = one
    ? ["LAP TIME", "S1", "S2", "S3", "I1", "I2", "TRAP", "TYRE", "POS", "GAP", "INT", "Δ BEST"]
    : ["LAP TIME", "S1", "S2", "S3", "TYRE", "POS", ""];
  for (const _ of model.selected) {
    for (const label of one ? sub : ["LAP TIME", "S1", "S2", "S3", "TYRE", "POS"]) {
      h2.append(el("th", { text: label, class: label === "TYRE" ? "lt-tyre-col" : undefined }));
    }
  }
  thead.append(h2);
  table.append(thead);
  const tbody = el("tbody");
  for (const lapNo of model.laps) {
    const tr = el("tr", { "data-lt-lap": String(lapNo) });
    if (jumpLap === lapNo) addClass(tr, "lt-jump");
    const anySc = model.selected.some((s) => {
      const c = model.cells.get(s.driver.driver_number)?.get(lapNo);
      return c?.sc || c?.vsc;
    });
    if (anySc) addClass(tr, "lt-sc");
    const inProg = model.selected.some((s) => model.cells.get(s.driver.driver_number)?.get(lapNo)?.inProgress);
    if (inProg) addClass(tr, "lt-progress");
    tr.append(el("td", { class: "lt-lap", text: String(lapNo) }));
    const notes: HTMLElement[] = [];
    for (const sum of model.selected) {
      const cell = model.cells.get(sum.driver.driver_number)?.get(lapNo);
      const add = (text: string, kind?: SectorKind, extra = "", col = "") => {
        const td = el("td", { text, "data-lt-col": col || undefined });
        addClass(td, extra, kindClass(kind));
        tr.append(td);
      };
      if (!cell) {
        for (let i = 0; i < (one ? 12 : 6); i++) tr.append(el("td", { text: "—" }));
        continue;
      }
      add(cell.inProgress && cell.time == null ? "…" : formatLap(cell.time), cell.timeKind, cell.inProgress ? "lt-live" : "", "time");
      add(formatSector(cell.s1), cell.s1Kind, "", "s1");
      add(formatSector(cell.s2), cell.s2Kind, "", "s2");
      add(formatSector(cell.s3), cell.s3Kind, "", "s3");
      if (one) {
        add(cell.i1 != null ? String(Math.round(cell.i1)) : "—", undefined, "", "i1");
        add(cell.i2 != null ? String(Math.round(cell.i2)) : "—", undefined, "", "i2");
        add(cell.st != null ? String(Math.round(cell.st)) : "—", undefined, "", "st");
      }
      const tyreTd = el("td", { class: "lt-tyre-col" });
      tyreTd.append(tyreAgeMark(cell.tyre, cell.tyreAge));
      tr.append(tyreTd);
      add(cell.pos != null ? `P${cell.pos}` : "—");
      if (one) {
        add(formatDelta(cell.gap, cell.pos === 1));
        add(formatDelta(cell.interval, cell.pos === 1));
        const dtd = el("td");
        dtd.append(deltaNode(cell.deltaBest));
        tr.append(dtd);
      }
      notes.push(...noteTags(cell, sum.driver.name_acronym, multi));
    }
    if (multi) {
      for (const sum of model.selected.slice(1)) {
        const cell = model.cells.get(sum.driver.driver_number)?.get(lapNo);
        const td = el("td");
        td.append(deltaNode(cell?.deltaFirst ?? null));
        tr.append(td);
      }
    }
    const noteTd = el("td", { class: "lt-notes" });
    for (const t of notes) noteTd.append(t);
    tr.append(noteTd);
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
}

function driverRowIds(list: LapTimingModel["list"]): string {
  return list.map((row) => String(row.driver.driver_number)).join(",");
}

function fillDriverRow(item: HTMLElement, row: LapTimingModel["list"][number], selectedCount: number): void {
  const color = teamColor(row.driver.team_colour);
  item.className = `lt-drv${row.selected ? " on" : ""}${row.striped ? " lt-stripe" : ""}`;
  item.dataset.driver = String(row.driver.driver_number);
  item.style.setProperty("--team", color);
  item.style.background = row.selected ? teamFill(row.driver.team_colour, row.striped ? 0.28 : 0.38) : "";
  const box = item.querySelector("input") as HTMLInputElement;
  box.checked = row.selected;
  box.disabled = !row.selected && selectedCount >= 4;
  (item.querySelector(".lt-pos") as HTMLElement).textContent = String(row.pos);
  (item.querySelector(".lt-bar") as HTMLElement).style.background = color;
  (item.querySelector(".lt-code") as HTMLElement).textContent = row.driver.name_acronym;
  (item.querySelector(".lt-num") as HTMLElement).textContent = String(row.driver.driver_number);
  (item.querySelector(".lt-gap") as HTMLElement).textContent = row.pos === 1 ? "LEADER" : formatDelta(row.gap);
}

function makeDriverRow(row: LapTimingModel["list"][number], selectedCount: number): HTMLElement {
  const item = el("label", { class: "lt-drv" });
  item.append(
    el("input", { type: "checkbox" }) as HTMLInputElement,
    el("span", { class: "lt-pos" }),
    el("span", { class: "lt-bar" }),
    el("span", { class: "lt-code" }),
    el("span", { class: "lt-num" }),
    el("span", { class: "lt-gap" }),
  );
  fillDriverRow(item, row, selectedCount);
  item.addEventListener("click", (ev) => {
    ev.preventDefault();
    const box = item.querySelector("input") as HTMLInputElement;
    if (box.disabled) return;
    setLapTimingDrivers(toggleLapTimingId(state.lapTimingDrivers, Number(item.dataset.driver)));
  });
  return item;
}

function syncDriverList(listBody: HTMLElement, list: LapTimingModel["list"], selectedCount: number): void {
  const nodes = [...listBody.querySelectorAll<HTMLElement>(".lt-drv")];
  const sameOrder = nodes.length === list.length && driverRowIds(list) === nodes.map((n) => n.dataset.driver ?? "").join(",");
  if (sameOrder) {
    list.forEach((row, i) => fillDriverRow(nodes[i], row, selectedCount));
    return;
  }
  listBody.replaceChildren();
  for (const row of list) listBody.append(makeDriverRow(row, selectedCount));
}

export function mountLapTiming(parent: HTMLElement): { update: () => void } {
  const listBody = el("div", { class: "lt-list" });
  const listHead = el("div", { class: "lt-list-h", text: "DRIVERS · SELECT UP TO 4" });
  const count = el("div", { class: "lt-count" });
  const aside = el("aside", { class: "lt-aside" }, [listHead, count, listBody]);

  const chips = el("div", { class: "lt-chips" });
  const views = el("div", { class: "lt-views" });
  for (const v of ["both", "chart", "table"] as LapTimingView[]) {
    views.append(el("button", { type: "button", "data-view": v, text: viewLabel(v) }));
  }
  const head = el("div", { class: "lt-head" }, [
    el("div", { class: "lt-comparing" }, [el("span", { class: "lt-k", text: "COMPARING" }), chips]),
    el("div", { class: "lt-view-wrap" }, [el("span", { class: "lt-k", text: "VIEW" }), views]),
  ]);
  const cards = el("div", { class: "lt-cards" });
  const chartHead = el("div", { class: "lt-chart-h" }, [
    el("span", { class: "lt-k", text: "LAP TIME COMPARE · GROUPED BARS PER LAP · CLIPPED AT +4S" }),
    el("span", { class: "lt-chart-leg" }),
  ]);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "lt-svg");
  const chart = el("div", { class: "lt-chart" }, [chartHead, svg]);
  const tableHead = el("div", { class: "lt-table-h" }, [
    el("span", { class: "lt-k", text: "LAP BY LAP" }),
    el("span", { class: "lt-hint", text: "CLICK A BAR TO JUMP" }),
  ]);
  const tableWrap = el("div", { class: "lt-table-wrap" });
  const tablePanel = el("div", { class: "lt-table-panel" }, [tableHead, tableWrap]);
  const legend = el("div", { class: "lt-legend" }, [
    el("span", { class: "lg overall", text: "Best of selected drivers" }),
    el("span", { class: "lg personal", text: "Personal best" }),
    el("span", { class: "lg other", text: "Slower" }),
    el("span", { class: "lg sc", text: "SC lap" }),
    el("span", { class: "lg faster", text: "Faster than first" }),
    el("span", { class: "lg slower", text: "Slower than first" }),
  ]);
  const empty = el("div", { class: "lt-empty", text: "Load a session to compare lap times. This page uses the laps already on the pitwall — it does not fetch extra OpenF1 data." });
  const main = el("section", { class: "lt-main" }, [head, cards, chart, tablePanel, legend, empty]);
  const page = el("div", { class: "page laptiming" }, [aside, main]);
  parent.append(page);

  let jumpLap: number | null = null;
  let vis: { from: number; to: number } | null = null;
  let stickBottom = true;
  let lastKey = "";
  let layoutRaf = 0;

  const visibleLaps = (): { from: number; to: number } | null => {
    const rows = [...tableWrap.querySelectorAll<HTMLElement>("tr[data-lt-lap]")];
    if (!rows.length) return null;
    const top = tableWrap.scrollTop;
    const bot = top + tableWrap.clientHeight;
    let from: number | null = null;
    let to: number | null = null;
    for (const row of rows) {
      const y = row.offsetTop;
      const n = Number(row.dataset.ltLap);
      if (y + row.offsetHeight >= top && y <= bot) {
        if (from == null) from = n;
        to = n;
      }
    }
    return from != null && to != null ? { from, to } : null;
  };

  const jump = (lap: number) => {
    jumpLap = lap;
    const row = tableWrap.querySelector<HTMLElement>(`tr[data-lt-lap="${lap}"]`);
    row?.scrollIntoView({ block: "center" });
    stickBottom = false;
    window.setTimeout(() => {
      jumpLap = null;
      row?.classList.remove("lt-jump");
    }, 1200);
  };

  tableWrap.addEventListener("scroll", () => {
    const near = tableWrap.scrollHeight - tableWrap.scrollTop - tableWrap.clientHeight < 48;
    stickBottom = near;
    vis = visibleLaps();
    if (state.lapTimingView !== "table") {
      drawChart(svg, lastModel, vis, jump);
    }
  });

  let lastModel: LapTimingModel = buildLapTimingModel({
    bundle: null,
    snap: null,
    selected: [],
    now: 0,
    live: false,
  });

  const tableEmpty = () => !tableWrap.querySelector("tbody tr");

  const paintChart = () => {
    if (chart.hidden) return;
    vis = state.lapTimingView === "both" ? visibleLaps() : null;
    drawChart(svg, lastModel, vis, jump);
  };

  const paintVisibleTable = (force = false) => {
    if (tablePanel.hidden) return;
    if (!force && !tableEmpty()) return;
    const keep = tableWrap.scrollTop;
    paintTable(lastModel, tableWrap, jumpLap);
    tableWrap.scrollTop = state.mode === "live" && stickBottom ? tableWrap.scrollHeight : keep;
  };

  const afterLayout = () => {
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      paintVisibleTable(tableEmpty());
      paintChart();
    });
  };

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => afterLayout());
    ro.observe(page);
    ro.observe(chart);
    ro.observe(tableWrap);
  }

  views.addEventListener("click", (ev) => {
    const btn = (ev.target as HTMLElement).closest("button[data-view]") as HTMLButtonElement | null;
    const v = btn?.dataset.view as LapTimingView | undefined;
    if (v) setLapTimingView(v);
  });

  const update = () => {
    const live = state.mode === "live";
    let selected = state.lapTimingDrivers;
    if (!selected.length && state.snap) {
      const seeded = seedFromTower(state.snap.rows, selected);
      if (seeded.length) {
        selected = seeded;
        queueMicrotask(() => {
          if (!state.lapTimingDrivers.length) setLapTimingDrivers(seeded);
        });
      }
    }
    const model = buildLapTimingModel({
      bundle: state.bundle,
      snap: state.snap,
      selected,
      now: state.t,
      live,
    });
    lastModel = model;
    const view = state.lapTimingView;
    page.dataset.view = view;
    empty.hidden = !!state.bundle;
    chart.hidden = view === "table" || !state.bundle;
    tablePanel.hidden = view === "chart" || !state.bundle;
    cards.hidden = !state.bundle;
    head.hidden = !state.bundle;
    legend.hidden = !state.bundle;

    for (const btn of views.querySelectorAll("button")) {
      btn.classList.toggle("on", btn.getAttribute("data-view") === view);
    }

    count.textContent = `${model.list.filter((r) => r.selected).length} SELECTED`;
    syncDriverList(listBody, model.list, selected.length);

    chips.replaceChildren();
    for (const sum of model.selected) {
      const chip = el("button", {
        type: "button",
        class: `lt-chip${sum.striped ? " lt-stripe" : ""}`,
        text: sum.driver.name_acronym,
      });
      chip.style.setProperty("--team", teamColor(sum.driver.team_colour));
      chip.style.background = teamColor(sum.driver.team_colour);
      chip.title = "Remove";
      chip.onclick = () => setLapTimingDrivers(state.lapTimingDrivers.filter((n) => n !== sum.driver.driver_number));
      chips.append(chip);
    }
    if (model.selected.length < 4) {
      const add = el("span", { class: "lt-add", text: "+ add driver" });
      chips.append(add);
    }

    cards.replaceChildren();
    model.selected.forEach((sum, i) => cards.append(paintCard(sum, i)));
    const names = model.selected.map((s) => s.driver.name_acronym).join("  ");
    tableHead.querySelector(".lt-k")!.textContent = names
      ? `LAP BY LAP COMPARE · ${names}`
      : "LAP BY LAP";

    const chartLeg = chartHead.querySelector(".lt-chart-leg")!;
    chartLeg.replaceChildren();
    for (const sum of model.selected) {
      const sw = el("span", { class: `lt-sw${sum.striped ? " lt-stripe" : ""}`, text: sum.driver.name_acronym });
      sw.style.background = teamColor(sum.driver.team_colour);
      chartLeg.append(sw);
    }
    chartLeg.append(el("span", { class: "lt-k", text: "STATUS STRIP · SC/YELLOW · PIT · BEST" }));

    if (!tablePanel.hidden) {
      const progress = model.inProgressLap
        ? [...model.cells.values()]
            .map((m) => {
              const cell = m.get(model.inProgressLap!);
              return cell?.s1 ?? cell?.s2 ?? cell?.s3 ?? "";
            })
            .join(",")
        : "";
      const key = `${selected.join(",")}:${view}:${model.laps.join(",")}:${model.inProgressLap}:${progress}:${live}:${state.t}`;
      if (key !== lastKey || tableEmpty()) {
        paintVisibleTable(true);
        lastKey = key;
      }
    }
    if (!chart.hidden) paintChart();
    afterLayout();
  };

  return { update };
}
