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
  MAP_MARK_FILL,
  MAP_MARK_LABEL_DX,
  MAP_MARK_LABEL_DY,
  MAP_SECTOR_R,
} from "../lib/mapMarks";
import { followViewBox, MAP_FOLLOW_ZOOM } from "../lib/mapZoom";
import { trackCarFrac } from "../lib/pitcircle";
import { appendDriverDot } from "../lib/svgcar";
import { panel } from "../ui/panel";
import { mountTowerSplitter } from "../ui/splitter";
import { renderTower } from "../ui/tower";
import { hasDriverSelection, isDriverSelected, state } from "../state";

function appendMapMark(
  svg: SVGSVGElement,
  px: number,
  py: number,
  label: string,
  attrs: Record<string, string> = {},
): SVGGElement {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", "map-mark");
  for (const [key, value] of Object.entries(attrs)) g.setAttribute(key, value);
  const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  c.setAttribute("class", "map-mark-tick");
  c.setAttribute("cx", String(px));
  c.setAttribute("cy", String(py));
  c.setAttribute("r", String(MAP_SECTOR_R));
  c.setAttribute("fill", MAP_MARK_FILL);
  const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
  lab.setAttribute("class", "car-label map-mark-label");
  lab.setAttribute("x", String(px + MAP_MARK_LABEL_DX));
  lab.setAttribute("y", String(py + MAP_MARK_LABEL_DY));
  lab.setAttribute("fill", MAP_MARK_FILL);
  lab.textContent = label;
  g.append(c, lab);
  svg.append(g);
  return g;
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
    appendMapMark(svg, px, py, m.label, { "data-mark": m.label });
  }
  const pits = pitLaneFracs(bundle);
  svg.dataset.pitIn = pits.entry.toFixed(4);
  svg.dataset.pitOut = pits.exit.toFixed(4);
  const [inX, inY] = pointAt(pts, pits.entry);
  const [outX, outY] = pointAt(pts, pits.exit);
  const [inPx, inPy] = map(inX, inY);
  const [outPx, outPy] = map(outX, outY);
  appendMapMark(svg, inPx, inPy, "PIT IN", { "data-pit": "in", "data-frac": pits.entry.toFixed(4) });
  appendMapMark(svg, outPx, outPy, "PIT OUT", { "data-pit": "out", "data-frac": pits.exit.toFixed(4) });
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
  let running = 0;
  for (const row of snap.rows) {
    if (row.retired) continue;
    running += 1;
    const frac = trackCarFrac(row, {
      leaderProgress: leaderProg,
      lapSec: snap.medianGreenLap,
      pitEntry: pits.entry,
      pitExit: pits.exit,
    });
    const [x, y] = pointAt(pts, frac);
    const [px, py] = map(x, y);
    if (row.driver.driver_number === followN) {
      followPx = px;
      followPy = py;
    }
    const on = isDriverSelected(row.driver.driver_number);
    const dim = hasDriverSelection() && !on;
    const dot = appendDriverDot(svg, px, py, {
      n: row.driver.driver_number,
      color: teamColor(row.driver.team_colour),
      selected: on,
      dim,
      visualR: on ? MAP_CAR_R_SELECTED : MAP_CAR_R,
      label: row.driver.name_acronym,
      labelX: px + MAP_LABEL_DX,
      labelY: py + MAP_LABEL_DY,
    });
    dot.dataset.frac = frac.toFixed(4);
  }
  svg.dataset.cars = String(running);

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
