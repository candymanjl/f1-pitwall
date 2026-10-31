import { DEFAULT_PIT_ENTRY, DEFAULT_PIT_EXIT } from "../data/pitlane";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import {
  GAP_WEDGE_FILLS,
  ghostFrac,
  neighborsAt,
  onTrackGaps,
  pointOnCircle,
  racingFrac,
  wedgePath,
  wrap01,
  type CircleCar,
} from "../lib/pitcircle";
import { formatDelta } from "../lib/time";
import { panel } from "../ui/panel";
import { renderTower } from "../ui/tower";
import { hasDriverSelection, isDriverSelected, selectDriver, setPitLoss, setPitMode, state } from "../state";

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

function clockwiseArc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = pointOnCircle(cx, cy, r, from);
  const b = pointOnCircle(cx, cy, r, to);
  const delta = wrap01(to - from);
  const large = delta > 0.5 ? 1 : 0;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

function tick(cx: number, cy: number, r: number, frac: number, len: number, stroke: string, width = 2): SVGLineElement {
  const inner = pointOnCircle(cx, cy, r - len, frac);
  const outer = pointOnCircle(cx, cy, r + len, frac);
  return svgEl("line", {
    x1: inner.x,
    y1: inner.y,
    x2: outer.x,
    y2: outer.y,
    stroke,
    "stroke-width": width,
  });
}

function labelAt(
  cx: number,
  cy: number,
  r: number,
  frac: number,
  text: string,
  fill: string,
  extraClass = "",
): SVGTextElement {
  const p = pointOnCircle(cx, cy, r, frac);
  const anchor = Math.cos(p.a) > 0.25 ? "start" : Math.cos(p.a) < -0.25 ? "end" : "middle";
  const dy = Math.sin(p.a) > 0.45 ? 10 : Math.sin(p.a) < -0.45 ? -4 : 4;
  return svgEl(
    "text",
    {
      x: p.x,
      y: p.y + dy,
      "text-anchor": anchor,
      fill,
      class: `car-label ${extraClass}`.trim(),
    },
    text,
  );
}

function carsOnCircle(): CircleCar[] {
  const snap = state.snap;
  if (!snap) return [];
  const pitExit = state.bundle?.pitExit ?? DEFAULT_PIT_EXIT;
  return snap.rows.map((row) => ({
    driver: row.driver.driver_number,
    code: row.driver.name_acronym,
    frac: row.inPit
      ? wrap01(state.bundle?.pitEntry ?? DEFAULT_PIT_ENTRY)
      : racingFrac(row.progress, row.pitOut, pitExit),
    inPit: row.inPit,
    retired: row.retired,
    pace: typeof row.lastLap === "number" && row.lastLap > 0 ? row.lastLap : snap.medianGreenLap,
  }));
}

function drawCircle(svg: SVGSVGElement): void {
  svg.replaceChildren();
  const snap = state.snap;
  if (!snap) return;
  const w = svg.clientWidth || 640;
  const h = svg.clientHeight || 640;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.34;
  const lap = snap.medianGreenLap;
  const pitEntry = state.bundle?.pitEntry ?? DEFAULT_PIT_ENTRY;
  const pitExit = state.bundle?.pitExit ?? DEFAULT_PIT_EXIT;
  const cars = carsOnCircle();

  const gaps = onTrackGaps(cars, lap);
  for (const [i, g] of gaps.entries()) {
    const d = wedgePath(cx, cy, r, g.from, g.to);
    if (!d) continue;
    svg.append(
      svgEl("path", {
        d,
        fill: GAP_WEDGE_FILLS[i % GAP_WEDGE_FILLS.length],
        stroke: "none",
        class: "gap-wedge",
        "data-behind": g.behind,
        "data-ahead": g.ahead,
      }),
    );
  }

  svg.append(
    svgEl("circle", {
      cx,
      cy,
      r,
      fill: "none",
      stroke: "#e8edf7",
      "stroke-width": 2.2,
    }),
  );

  const pitR = r - 16;
  svg.append(
    svgEl("path", {
      d: clockwiseArc(cx, cy, pitR, pitEntry, pitExit),
      fill: "none",
      stroke: "#64748b",
      "stroke-width": 1.4,
      "stroke-dasharray": "4 4",
      class: "pit-lane",
    }),
  );

  svg.append(tick(cx, cy, r, 0, 10, "#e10600", 2.4));
  svg.append(labelAt(cx, cy, r + 22, 0, "S/F", "#e10600", "sf-label"));
  svg.append(tick(cx, cy, r, pitEntry, 8, "#fbbf24", 2));
  svg.append(labelAt(cx, cy, r + 26, pitEntry, "PIT IN", "#fbbf24"));
  svg.append(tick(cx, cy, r, pitExit, 8, "#22c55e", 2));
  svg.append(labelAt(cx, cy, r + 26, pitExit, "PIT OUT", "#22c55e"));

  for (const g of gaps) {
    const inner = pointOnCircle(cx, cy, r, g.mid);
    const outer = pointOnCircle(cx, cy, r + 20, g.mid);
    svg.append(
      svgEl("line", {
        x1: inner.x,
        y1: inner.y,
        x2: outer.x,
        y2: outer.y,
        stroke: "#64748b",
        "stroke-width": 1,
        class: "gap-leader",
      }),
    );
    svg.append(
      svgEl("circle", {
        cx: inner.x,
        cy: inner.y,
        r: 2.4,
        fill: "#94a3b8",
      }),
    );
    svg.append(labelAt(cx, cy, r + 34, g.mid, formatDelta(g.gap), "#cbd5e1", "gap-callout"));
  }

  for (const row of snap.rows) {
    if (row.retired) continue;
    const car = cars.find((c) => c.driver === row.driver.driver_number);
    if (!car) continue;
    const rr = car.inPit ? pitR : r;
    const { x, y } = pointOnCircle(cx, cy, rr, car.frac);
    const on = isDriverSelected(row.driver.driver_number);
    const dim = hasDriverSelection() && !on;
    const c = svgEl("circle", {
      cx: x,
      cy: y,
      r: on ? 7.5 : 5,
      fill: teamColor(row.driver.team_colour),
      class: `car-dot${on ? " on" : dim ? " dim" : ""}`,
      "data-driver": row.driver.driver_number,
      stroke: on ? "#f8fafc" : car.inPit ? "#fbbf24" : "none",
      "stroke-width": on || car.inPit ? 1.6 : 0,
    });
    c.style.cursor = "pointer";
    c.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectDriver(row.driver.driver_number, ev);
    });
    svg.append(c);
    svg.append(labelAt(cx, cy, rr + 16, car.frac, `${row.pos} ${row.driver.name_acronym}`, "#e5e7eb"));
  }

  const sel = snap.rows.find((row) => row.driver.driver_number === state.selectedDriver);
  const loss = state.pitLoss[state.pitMode];
  if (sel && !sel.retired) {
    const selCar = cars.find((c) => c.driver === sel.driver.driver_number);
    const gf = ghostFrac(selCar?.frac ?? 0, loss, lap);
    const { x: gx, y: gy } = pointOnCircle(cx, cy, r, gf);
    svg.append(
      svgEl("circle", {
        cx: gx,
        cy: gy,
        r: 6,
        fill: "none",
        stroke: "#f8fafc",
        "stroke-dasharray": "3 3",
        class: "pit-ghost",
      }),
    );
    const others = cars.filter((c) => c.driver !== sel.driver.driver_number);
    const { ahead, behind } = neighborsAt(others, gf);
    svg.append(
      svgEl(
        "text",
        {
          x: cx,
          y: cy - 6,
          "text-anchor": "middle",
          fill: "#cbd5e1",
          class: "car-label",
        },
        `${sel.driver.name_acronym} ghost · ${state.pitMode.toUpperCase()} −${loss.toFixed(0)}s`,
      ),
    );
    svg.append(
      svgEl(
        "text",
        {
          x: cx,
          y: cy + 12,
          "text-anchor": "middle",
          fill: "#94a3b8",
          class: "car-label",
        },
        `${ahead ? `rejoins ahead of ${ahead.code}` : ""} ${behind && behind.driver !== ahead?.driver ? `behind ${behind.code}` : ""}`.trim(),
      ),
    );
  }

  svg.append(
    svgEl(
      "text",
      {
        x: cx,
        y: cy + (sel && !sel.retired ? 30 : 8),
        "text-anchor": "middle",
        fill: "#8b93a7",
        class: "car-label",
      },
      `1 rev = 1 lap clockwise · S/F at 12 o'clock`,
    ),
  );
}

type PitField = { mode: "green" | "vsc" | "sc"; chip: HTMLElement; input: HTMLInputElement };

function mountPitDeltaBar(parent: HTMLElement): PitField[] {
  const bar = el("div", { class: "pit-delta-bar" });
  const fields: PitField[] = [];
  for (const mode of ["green", "vsc", "sc"] as const) {
    const input = el("input", {
      type: "number",
      step: "0.1",
      min: "0",
      max: "180",
      "data-mode": mode,
      "aria-label": `${mode} pit loss seconds`,
    }) as HTMLInputElement;
    input.value = String(state.pitLoss[mode]);
    const chip = el("label", { class: `pit-delta${state.pitMode === mode ? " on" : ""}`, "data-mode": mode }, [
      el("span", { class: "pit-delta-name", text: mode.toUpperCase() }),
      input,
      el("span", { class: "pit-delta-unit", text: "s" }),
    ]);
    chip.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      setPitMode(mode);
    });
    input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    input.addEventListener("click", (ev) => ev.stopPropagation());
    const commit = () => {
      const n = Number(input.value);
      if (!Number.isFinite(n) || n < 0) {
        input.value = String(state.pitLoss[mode]);
        return;
      }
      if (n === state.pitLoss[mode] && state.pitMode === mode) return;
      setPitMode(mode);
      setPitLoss({ ...state.pitLoss, [mode]: n });
    };
    input.addEventListener("input", commit);
    input.addEventListener("change", commit);
    bar.append(chip);
    fields.push({ mode, chip, input });
  }
  parent.append(bar);
  return fields;
}

function syncPitDeltaBar(fields: PitField[]): void {
  for (const f of fields) {
    f.chip.classList.toggle("on", state.pitMode === f.mode);
    if (document.activeElement !== f.input) f.input.value = String(state.pitLoss[f.mode]);
  }
}

export function mountPitCircle(parent: HTMLElement): { update: () => void } {
  const left = panel("Timing tower");
  const right = panel("Pit circle  ·  on-track gaps");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("circle");
  const wrap = el("div", { class: "chart-wrap" });
  wrap.append(svg);
  right.body.style.display = "flex";
  right.body.style.flexDirection = "column";
  wrap.style.flex = "1";
  wrap.style.minHeight = "0";
  const fields = mountPitDeltaBar(right.body);
  right.body.append(wrap);
  const page = el("div", { class: "page pitcircle" }, [left.root, right.root]);
  parent.append(page);

  const update = () => {
    const issue = !state.snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null;
    left.setError(issue);
    right.setError(issue);
    left.body.replaceChildren();
    if (state.snap) {
      left.body.append(
        renderTower(state.snap.rows, {
          cols: "basic",
          selected: state.selectedDriver,
        }),
      );
    }
    syncPitDeltaBar(fields);
    drawCircle(svg);
  };
  return { update };
}
