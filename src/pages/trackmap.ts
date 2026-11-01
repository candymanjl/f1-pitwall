import { snapshotAt } from "../data/derive";
import { pitLaneFracs } from "../data/pitlane";
import { pointAt, project } from "../data/track";
import type { SessionBundle, TimingSnapshot } from "../data/types";
import { bindDriverSelect } from "../lib/bindSelect";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import {
  MAP_CAR_R,
  MAP_CAR_R_SELECTED,
  MAP_LABEL_DX,
  MAP_LABEL_DY,
  MAP_LINE_WIDTH,
  MAP_PIT_R,
  MAP_PIT_TICK,
  MAP_SECTOR_R,
} from "../lib/mapMarks";
import { followViewBox, MAP_FOLLOW_ZOOM } from "../lib/mapZoom";
import { appendDriverDot } from "../lib/svgcar";
import { asNumber } from "../lib/time";
import { panel } from "../ui/panel";
import { mountTowerSplitter } from "../ui/splitter";
import { renderTower } from "../ui/tower";
import { hasDriverSelection, isDriverSelected, state } from "../state";

function carFrac(row: TimingSnapshot["rows"][number], leaderProg: number, lap: number): number {
  const gap = row.pos === 1 ? 0 : asNumber(row.gap) ?? 0;
  return ((leaderProg - gap / Math.max(1, lap)) % 1 + 1) % 1;
}

function appendPitMark(
  svg: SVGSVGElement,
  map: (x: number, y: number) => [number, number],
  pts: [number, number][],
  frac: number,
  kind: "in" | "out",
  label: string,
  color: string,
): void {
  const [x, y] = pointAt(pts, frac);
  const [px, py] = map(x, y);
  const [ax, ay] = pointAt(pts, frac + 0.012);
  const [qx, qy] = map(ax, ay);
  const dx = qx - px;
  const dy = qy - py;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * MAP_PIT_TICK;
  const ny = (dx / len) * MAP_PIT_TICK;
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "pit-mark");
  g.setAttribute("data-pit", kind);
  g.setAttribute("data-frac", frac.toFixed(4));
  const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
  tick.setAttribute("class", "pit-mark-tick");
  tick.setAttribute("x1", (px - nx).toFixed(1));
  tick.setAttribute("y1", (py - ny).toFixed(1));
  tick.setAttribute("x2", (px + nx).toFixed(1));
  tick.setAttribute("y2", (py + ny).toFixed(1));
  tick.setAttribute("stroke", color);
  tick.setAttribute("stroke-width", "3");
  tick.setAttribute("stroke-linecap", "round");
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("class", "pit-mark-dot");
  dot.setAttribute("cx", px.toFixed(1));
  dot.setAttribute("cy", py.toFixed(1));
  dot.setAttribute("r", String(MAP_PIT_R));
  dot.setAttribute("fill", color);
  const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lab.setAttribute("class", "car-label pit-mark-label");
  lab.setAttribute("x", (px + nx * 1.35).toFixed(1));
  lab.setAttribute("y", (py + ny * 1.35).toFixed(1));
  lab.setAttribute("fill", color);
  lab.setAttribute("text-anchor", nx > 2 ? "start" : nx < -2 ? "end" : "middle");
  lab.textContent = label;
  g.append(tick, dot, lab);
  svg.append(g);
}

function drawMap(svg: SVGSVGElement, bundle: SessionBundle, snap: TimingSnapshot, followZoom: boolean): void {
  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 600;
  svg.replaceChildren();
  const pts = bundle.track;
  if (pts.length < 2) {
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
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
  const pits = pitLaneFracs(bundle);
  svg.dataset.pitIn = pits.entry.toFixed(4);
  svg.dataset.pitOut = pits.exit.toFixed(4);
  appendPitMark(svg, map, pts, pits.entry, "in", "PIT IN", "#fbbf24");
  appendPitMark(svg, map, pts, pits.exit, "out", "PIT OUT", "#22c55e");
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
  const followN = state.selectedDriver ?? snap.rows[0]?.driver.driver_number ?? null;
  let followPx = w / 2;
  let followPy = h / 2;
  for (const row of snap.rows) {
    if (row.retired) continue;
    const frac = carFrac(row, leaderProg, snap.medianGreenLap);
    const [x, y] = pointAt(pts, frac);
    const [px, py] = map(x, y);
    if (row.driver.driver_number === followN) {
      followPx = px;
      followPy = py;
    }
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

  if (followZoom && pts.length >= 2) {
    const box = followViewBox(followPx, followPy, w, h, MAP_FOLLOW_ZOOM);
    svg.setAttribute("viewBox", `${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`);
    svg.dataset.zoom = "follow";
    svg.dataset.follow = followN != null ? String(followN) : "";
  } else {
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.dataset.zoom = "full";
    svg.dataset.follow = "";
  }
}

export function mountTrackMap(parent: HTMLElement): { update: () => void } {
  const left = panel("Timing tower");
  let followZoom = false;
  const zoomBtn = el("button", {
    type: "button",
    class: "map-zoom",
    text: "Zoom",
    "aria-pressed": "false",
    title: "Zoom around the selected driver (or the leader) and follow them",
  });
  const right = panel("Track map  ·  outline from OpenF1 /location", "", zoomBtn);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("track");
  const wrap = el("div", { class: "chart-wrap" });
  wrap.append(svg);
  right.body.append(wrap);
  const page = el("div", { class: "page trackmap" }, [left.root, right.root]);
  parent.append(page);

  const syncZoomBtn = () => {
    zoomBtn.classList.toggle("on", followZoom);
    zoomBtn.setAttribute("aria-pressed", followZoom ? "true" : "false");
    zoomBtn.textContent = followZoom ? "Full map" : "Zoom";
  };

  const draw = () => {
    const bundle = state.bundle;
    const snap = state.snap ?? (bundle ? snapshotAt(bundle, state.t) : null);
    if (bundle && snap) drawMap(svg, bundle, snap, followZoom);
  };

  zoomBtn.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    followZoom = !followZoom;
    syncZoomBtn();
    draw();
  });

  mountTowerSplitter(page, { onResize: draw });
  bindDriverSelect(left.body);
  bindDriverSelect(svg);
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
