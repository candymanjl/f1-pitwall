import { pitLaneFracs } from "../data/pitlane";
import { project, windArrowScreen } from "../data/track";
import type { TimingSnapshot } from "../data/types";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { racingFrac, wrap01 } from "../lib/pitcircle";
import { formatSector } from "../lib/time";
import { nearestStripCar, stripX } from "../lib/trackStrip";
import {
  prefersReducedMotion,
  WIND_CHEVRON_WIDTH,
  fitWindArrow,
  windChevronGeometry,
  windFlowPeriodMs,
} from "../lib/windFlow";
import { hasDriverSelection, isDriverSelected, selectDriver, state } from "../state";

type StripCar = { n: number; x: number };

let lastStrip: { w: number; cars: StripCar[] } = { w: 0, cars: [] };

function lapFrac(row: TimingSnapshot["rows"][number], pitEntry: number, pitExit: number): number {
  if (row.inPit) return wrap01(pitEntry);
  return racingFrac(row.progress, row.pitOut, pitExit);
}

function drawGap(canvas: HTMLCanvasElement, rows: TimingSnapshot["rows"]): void {
  const w = canvas.clientWidth || 400;
  const h = 36;
  const pad = 8;
  const { entry: pitEntry, exit: pitExit } = pitLaneFracs(state.bundle);
  const midY = h / 2;
  const sfX = stripX(0, w, pad);
  const pitInX = stripX(pitEntry, w, pad);
  const pitOutX = stripX(pitExit, w, pad);
  canvas.dataset.sf = String(sfX);
  canvas.dataset.pitIn = String(pitInX);
  canvas.dataset.pitOut = String(pitOutX);
  canvas.dataset.mode = "track";
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    lastStrip = {
      w,
      cars: rows
        .filter((row) => !row.retired)
        .map((row) => ({ n: row.driver.driver_number, x: stripX(lapFrac(row, pitEntry, pitExit), w, pad) })),
    };
    return;
  }
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = "#2a3144";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, midY);
  ctx.lineTo(w - pad, midY);
  ctx.stroke();

  const mark = (x: number, color: string, label: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x, h - 6);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "700 10px Titillium Web, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, 10);
  };
  mark(sfX, "#e10600", "S/F");
  mark(pitInX, "#fbbf24", "IN");
  mark(pitOutX, "#22c55e", "OUT");

  const dim = hasDriverSelection();
  const cars: StripCar[] = [];
  for (const row of rows) {
    if (row.retired) continue;
    const frac = lapFrac(row, pitEntry, pitExit);
    const x = stripX(frac, w, pad);
    const on = isDriverSelected(row.driver.driver_number);
    ctx.globalAlpha = dim && !on ? 0.28 : 1;
    ctx.fillStyle = teamColor(row.driver.team_colour);
    ctx.beginPath();
    ctx.arc(x, midY, on ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    cars.push({ n: row.driver.driver_number, x });
  }
  lastStrip = { w, cars };
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
  const fitted = fitWindArrow(arrow.from[0], arrow.from[1], arrow.to[0], arrow.to[1], w, h);
  const { x1, y1, x2, y2 } = fitted;
  const speed = state.snap?.weather?.wind_speed;
  const period = windFlowPeriodMs(speed);
  const reduce = prefersReducedMotion();
  svg.style.setProperty("--wind-flow-ms", `${period}ms`);
  svg.classList.toggle("wind-still", reduce || (speed ?? 0) < 0.15);

  const geo = windChevronGeometry(x1, y1, x2, y2);
  svg.style.setProperty("--wind-tx", `${geo.cycleX.toFixed(2)}px`);
  svg.style.setProperty("--wind-ty", `${geo.cycleY.toFixed(2)}px`);
  svg.dataset.wind = "chevrons";
  svg.dataset.chevrons = String(geo.count);

  let defs = svg.querySelector("defs");
  let clip = svg.querySelector<SVGClipPathElement>("#wind-chevron-clip");
  let clipPath = svg.querySelector<SVGPathElement>("#wind-chevron-clip path");
  let chevrons = svg.querySelector<SVGPathElement>("path.wind-arrow-chevrons");
  let head = svg.querySelector<SVGPathElement>("path.wind-arrow-head");
  if (!defs || !clip || !clipPath || !chevrons || !head) {
    svg.querySelectorAll("path.wind-arrow-body, path.wind-arrow-flow, line.wind-arrow-shaft, line.wind-arrow-flow, defs").forEach(
      (n) => n.remove(),
    );
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
    clip.setAttribute("id", "wind-chevron-clip");
    clipPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    clip.append(clipPath);
    defs.append(clip);
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "wind-arrow-chevron-layer");
    layer.setAttribute("clip-path", "url(#wind-chevron-clip)");
    chevrons = document.createElementNS("http://www.w3.org/2000/svg", "path");
    chevrons.setAttribute("class", "wind-arrow-chevrons");
    chevrons.setAttribute("fill", "none");
    chevrons.setAttribute("stroke", "#7dd3fc");
    chevrons.setAttribute("stroke-width", String(WIND_CHEVRON_WIDTH));
    chevrons.setAttribute("stroke-linecap", "round");
    chevrons.setAttribute("stroke-linejoin", "round");
    layer.append(chevrons);
    head = document.createElementNS("http://www.w3.org/2000/svg", "path");
    head.setAttribute("class", "wind-arrow-head");
    svg.append(defs, layer, head);
  }
  clipPath.setAttribute("d", geo.clip);
  chevrons.setAttribute("d", geo.chevrons);
  chevrons.dataset.cycle = String(geo.cycle);
  head.setAttribute("d", geo.head);
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
  canvas.setAttribute("aria-label", "Track strip, start/finish at center");
  const pick = (ev: PointerEvent) => {
    const rows = state.snap?.rows;
    if (!rows) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const scale = lastStrip.w > 0 ? lastStrip.w / Math.max(1, rect.width) : 1;
    const hit = nearestStripCar(lastStrip.cars, x * scale, 18);
    if (hit) selectDriver(hit.n, ev);
  };
  canvas.addEventListener("pointerdown", pick);
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
    drawGap(canvas, snap.rows);
    drawWind(windSvg);
  };
  return { update };
}
