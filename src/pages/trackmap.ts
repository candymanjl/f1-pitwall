import { snapshotAt } from "../data/derive";
import { pointAt, project } from "../data/track";
import type { SessionBundle, TimingSnapshot } from "../data/types";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { MAP_CAR_R, MAP_CAR_R_SELECTED, MAP_LABEL_DX, MAP_LABEL_DY, MAP_LINE_WIDTH, MAP_SECTOR_R } from "../lib/mapMarks";
import { asNumber } from "../lib/time";
import { panel } from "../ui/panel";
import { mountTowerSplitter } from "../ui/splitter";
import { renderTower } from "../ui/tower";
import { appendDriverDot } from "../lib/svgcar";
import { hasDriverSelection, isDriverSelected, state } from "../state";

function drawMap(svg: SVGSVGElement, bundle: SessionBundle, snap: TimingSnapshot): void {
  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 600;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren();
  const pts = bundle.track;
  if (pts.length < 2) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(w / 2));
    t.setAttribute("y", String(h / 2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "#8b93a7");
    t.textContent = "Loading track outline from /location…";
    svg.append(t);
    return;
  }
  const { map } = project(pts, w, h, 48);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    pts.map((p, i) => {
      const [px, py] = map(p[0], p[1]);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" "),
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#e8edf7");
  path.setAttribute("stroke-width", String(MAP_LINE_WIDTH));
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-linecap", "round");
  svg.append(path);

  const [f1, f2] = bundle.sectorFracs;
  const marks = [
    { frac: 0, label: "S/F" },
    { frac: f1, label: "SECTOR 1" },
    { frac: f1 + f2, label: "SECTOR 2" },
  ];
  for (const m of marks) {
    const [x, y] = pointAt(pts, m.frac);
    const [px, py] = map(x, y);
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(px));
    c.setAttribute("cy", String(py));
    c.setAttribute("r", String(MAP_SECTOR_R));
    c.setAttribute("fill", "#94a3b8");
    svg.append(c);
    const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lab.setAttribute("x", String(px + 8));
    lab.setAttribute("y", String(py - 8));
    lab.setAttribute("class", "car-label");
    lab.setAttribute("fill", "#94a3b8");
    lab.textContent = m.label;
    svg.append(lab);
  }
  for (const corner of bundle.corners) {
    const [px, py] = map(corner.x, corner.y);
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(px));
    t.setAttribute("y", String(py));
    t.setAttribute("class", "car-label");
    t.setAttribute("fill", "#64748b");
    t.textContent = String(corner.n);
    svg.append(t);
  }

  const leaderProg = snap.rows[0]?.progress ?? 0;
  for (const row of snap.rows) {
    if (row.retired) continue;
    const gap = row.pos === 1 ? 0 : asNumber(row.gap) ?? 0;
    const frac = ((leaderProg - gap / Math.max(1, snap.medianGreenLap)) % 1 + 1) % 1;
    const [x, y] = pointAt(pts, frac);
    const [px, py] = map(x, y);
    const on = isDriverSelected(row.driver.driver_number);
    const dim = hasDriverSelection() && !on;
    appendDriverDot(svg, px, py, {
      n: row.driver.driver_number,
      color: teamColor(row.driver.team_colour),
      selected: on,
      dim,
      visualR: on ? MAP_CAR_R_SELECTED : MAP_CAR_R,
      label: row.driver.name_acronym,
      labelX: px + MAP_LABEL_DX,
      labelY: py + MAP_LABEL_DY,
    });
  }
}

export function mountTrackMap(parent: HTMLElement): { update: () => void } {
  const left = panel("Timing tower");
  const right = panel("Track map  ·  outline from OpenF1 /location");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("track");
  const wrap = el("div", { class: "chart-wrap" });
  wrap.append(svg);
  right.body.append(wrap);
  const page = el("div", { class: "page trackmap" }, [left.root, right.root]);
  parent.append(page);

  const draw = () => {
    const bundle = state.bundle;
    const snap = state.snap ?? (bundle ? snapshotAt(bundle, state.t) : null);
    if (bundle && snap) drawMap(svg, bundle, snap);
  };

  mountTowerSplitter(page, { onResize: draw });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => draw()).observe(wrap);
  }

  const update = () => {
    const bundle = state.bundle;
    const snap = state.snap ?? (bundle ? snapshotAt(bundle, state.t) : null);
    left.body.replaceChildren();
    if (snap) {
      left.body.append(
        renderTower(snap.rows, {
          cols: "basic",
          selected: state.selectedDriver,
        }),
      );
    }
    draw();
    const trackErr =
      state.panelErrors.track ||
      (bundle && bundle.track.length < 2 ? "Track outline could not be loaded from OpenF1 /location." : "");
    right.setError(state.lock ? null : trackErr || null);
    if (!snap && state.error && !state.lock) {
      left.setError(state.error);
    } else {
      left.setError(null);
    }
  };
  return { update };
}
