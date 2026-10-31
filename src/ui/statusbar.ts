import { project, windArrowScreen } from "../data/track";
import type { TimingSnapshot } from "../data/types";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { formatSector } from "../lib/time";
import {
  prefersReducedMotion,
  WIND_ARROW_WIDTH,
  WIND_FLOW_CYCLE,
  WIND_FLOW_DASH,
  WIND_FLOW_WIDTH,
  windFlowPeriodMs,
} from "../lib/windFlow";
import { hasDriverSelection, isDriverSelected, selectDriver, state } from "../state";

let windMarkerSeq = 0;

function drawGap(canvas: HTMLCanvasElement, rows: TimingSnapshot["rows"]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth || 400;
  const h = 36;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#2a3144";
  ctx.beginPath();
  ctx.moveTo(8, h / 2);
  ctx.lineTo(w - 8, h / 2);
  ctx.stroke();
  const gaps = rows.map((r) => (typeof r.gap === "number" ? r.gap : r.pos === 1 ? 0 : null)).filter((g): g is number => g != null);
  const max = Math.max(8, ...(gaps.length ? gaps : [8]));
  const dim = hasDriverSelection();
  for (const row of rows) {
    const g = row.pos === 1 ? 0 : typeof row.gap === "number" ? row.gap : null;
    if (g == null) continue;
    const x = 8 + (g / max) * (w - 16);
    const on = isDriverSelected(row.driver.driver_number);
    ctx.globalAlpha = dim && !on ? 0.28 : 1;
    ctx.fillStyle = teamColor(row.driver.team_colour);
    ctx.beginPath();
    ctx.arc(x, h / 2, on ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawWind(svg: SVGSVGElement): void {
  const w = svg.clientWidth || 96;
  const h = svg.clientHeight || 72;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const pts = state.bundle?.track ?? [];
  const dir = state.snap?.weather?.wind_direction;
  if (pts.length < 2) {
    svg.replaceChildren();
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(w / 2));
    t.setAttribute("y", String(h / 2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "#64748b");
    t.setAttribute("class", "car-label");
    t.textContent = "No outline";
    svg.append(t);
    return;
  }
  svg.querySelector("text.car-label")?.remove();
  const { map } = project(pts, w, h, 8);
  const d = pts
    .map((p, i) => {
      const [px, py] = map(p[0], p[1]);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
  let path = svg.querySelector<SVGPathElement>("path.wind-track");
  if (!path) {
    path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "wind-track");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#cbd5e1");
    path.setAttribute("stroke-width", "1.4");
    svg.prepend(path);
  }
  path.setAttribute("d", d);
  const arrow = dir != null ? windArrowScreen(pts, dir, w, h) : null;
  if (!arrow) return;
  const [x1, y1] = arrow.from;
  const [x2, y2] = arrow.to;
  const speed = state.snap?.weather?.wind_speed;
  const period = windFlowPeriodMs(speed);
  const reduce = prefersReducedMotion();
  svg.style.setProperty("--wind-flow-ms", `${period}ms`);
  svg.classList.toggle("wind-still", reduce || (speed ?? 0) < 0.15);

  let markerId = svg.dataset.windMarker;
  if (!markerId) {
    markerId = `wind-head-${++windMarkerSeq}`;
    svg.dataset.windMarker = markerId;
  }

  let shaft = svg.querySelector<SVGLineElement>("line.wind-arrow-shaft");
  let flow = svg.querySelector<SVGLineElement>("line.wind-arrow-flow");
  if (!shaft || !flow) {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `<marker id="${markerId}" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto"><path d="M0,0 L12,5 L0,10 Z" fill="#38bdf8"/></marker>`;
    shaft = document.createElementNS("http://www.w3.org/2000/svg", "line");
    shaft.setAttribute("class", "wind-arrow-shaft");
    shaft.setAttribute("stroke", "#38bdf8");
    shaft.setAttribute("stroke-width", String(WIND_ARROW_WIDTH));
    shaft.setAttribute("stroke-linecap", "round");
    shaft.setAttribute("marker-end", `url(#${markerId})`);
    flow = document.createElementNS("http://www.w3.org/2000/svg", "line");
    flow.setAttribute("class", "wind-arrow-flow");
    flow.setAttribute("stroke", "#e0f2fe");
    flow.setAttribute("stroke-width", String(WIND_FLOW_WIDTH));
    flow.setAttribute("stroke-linecap", "round");
    flow.setAttribute("stroke-dasharray", WIND_FLOW_DASH);
    flow.dataset.cycle = String(WIND_FLOW_CYCLE);
    svg.append(defs, shaft, flow);
  }
  for (const line of [shaft, flow]) {
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
  }
}

export function mountStatusBar(parent: HTMLElement): { update: () => void } {
  const root = el("div", { class: "strip statusbar" });
  const empty = el("div", {
    class: "legend",
    text: "Best sectors, field gap, and conditions appear here once a session is loaded.",
  });
  const s1 = el("div", { class: "sec-purple" });
  const s2 = el("div", { class: "sec-purple" });
  const s3 = el("div", { class: "sec-purple" });
  const best = el("div", { class: "strip-best" }, [el("div", { class: "legend", text: "Best sectors" }), s1, s2, s3]);
  const canvas = el("canvas", { class: "gapline" }) as HTMLCanvasElement;
  canvas.addEventListener("click", (ev) => {
    const rows = state.snap?.rows;
    if (!rows) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const gaps = rows.map((r) => (typeof r.gap === "number" ? r.gap : r.pos === 1 ? 0 : null));
    const max = Math.max(8, ...gaps.filter((g): g is number => g != null));
    let bestN: number | null = null;
    let bestD = Infinity;
    rows.forEach((row, i) => {
      const g = gaps[i];
      if (g == null) return;
      const px = 8 + (g / max) * (rect.width - 16);
      const d = Math.abs(px - x);
      if (d < bestD && d < 14) {
        bestD = d;
        bestN = row.driver.driver_number;
      }
    });
    if (bestN != null) selectDriver(bestN, ev);
  });
  const air = el("div");
  const track = el("div");
  const wind = el("div");
  const hum = el("div");
  const wx = el("div", { class: "wx-text" }, [el("div", { class: "legend", text: "Conditions" }), air, track, wind, hum]);
  const windSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  windSvg.classList.add("wind-map");
  windSvg.setAttribute("aria-label", "Wind direction on track");
  const wxWrap = el("div", { class: "wx-wind" }, [wx, windSvg]);
  parent.append(root);

  const update = () => {
    const snap = state.snap;
    if (!snap) {
      root.replaceChildren(empty);
      return;
    }
    if (root.firstChild !== best) root.replaceChildren(best, canvas, wxWrap);
    s1.textContent = `S1 ${snap.bestSectors.s1 ? `${snap.bestSectors.s1.code} ${formatSector(snap.bestSectors.s1.time)}` : "—"}`;
    s2.textContent = `S2 ${snap.bestSectors.s2 ? `${snap.bestSectors.s2.code} ${formatSector(snap.bestSectors.s2.time)}` : "—"}`;
    s3.textContent = `S3 ${snap.bestSectors.s3 ? `${snap.bestSectors.s3.code} ${formatSector(snap.bestSectors.s3.time)}` : "—"}`;
    const w = snap.weather;
    const windDir = w?.wind_direction;
    air.textContent = w ? `Air ${w.air_temperature?.toFixed(1) ?? "—"}°C` : "—";
    track.textContent = w ? `Track ${w.track_temperature?.toFixed(1) ?? "—"}°C` : "—";
    wind.textContent = w
      ? `Wind ${w.wind_speed?.toFixed(1) ?? "—"} m/s${windDir != null ? ` ${Math.round(windDir)}°` : ""}`
      : "—";
    hum.textContent = w ? `Hum ${w.humidity?.toFixed(0) ?? "—"}% · ${w.rainfall ? "rain" : "dry"}` : "—";
    requestAnimationFrame(() => {
      drawGap(canvas, snap.rows);
      drawWind(windSvg);
    });
  };
  return { update };
}
