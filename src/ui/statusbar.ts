import { project, windArrowScreen } from "../data/track";
import type { TimingSnapshot } from "../data/types";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { formatSector } from "../lib/time";
import { hasDriverSelection, isDriverSelected, selectDriver, state } from "../state";

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
  svg.replaceChildren();
  const w = svg.clientWidth || 96;
  const h = svg.clientHeight || 72;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const pts = state.bundle?.track ?? [];
  const dir = state.snap?.weather?.wind_direction;
  if (pts.length < 2) {
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
  const { map } = project(pts, w, h, 8);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    pts
      .map((p, i) => {
        const [px, py] = map(p[0], p[1]);
        return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" "),
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#cbd5e1");
  path.setAttribute("stroke-width", "1.4");
  svg.append(path);
  const arrow = dir != null ? windArrowScreen(pts, dir, w, h) : null;
  if (!arrow) return;
  const [x1, y1] = arrow.from;
  const [x2, y2] = arrow.to;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", "#38bdf8");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("marker-end", "url(#wind-head)");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML =
    `<marker id="wind-head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8"/></marker>`;
  svg.append(defs, line);
}

export function mountStatusBar(parent: HTMLElement): { update: () => void } {
  const root = el("div", { class: "strip statusbar" });
  parent.append(root);

  const update = () => {
    const snap = state.snap;
    root.replaceChildren();
    if (!snap) {
      root.append(el("div", { class: "legend", text: "Best sectors, field gap, and conditions appear here once a session is loaded." }));
      return;
    }
    const best = el("div", { class: "strip-best" }, [
      el("div", { class: "legend", text: "Best sectors" }),
      el("div", { class: "sec-purple", text: `S1 ${snap.bestSectors.s1 ? `${snap.bestSectors.s1.code} ${formatSector(snap.bestSectors.s1.time)}` : "—"}` }),
      el("div", { class: "sec-purple", text: `S2 ${snap.bestSectors.s2 ? `${snap.bestSectors.s2.code} ${formatSector(snap.bestSectors.s2.time)}` : "—"}` }),
      el("div", { class: "sec-purple", text: `S3 ${snap.bestSectors.s3 ? `${snap.bestSectors.s3.code} ${formatSector(snap.bestSectors.s3.time)}` : "—"}` }),
    ]);
    const canvas = el("canvas", { class: "gapline" }) as HTMLCanvasElement;
    canvas.addEventListener("click", (ev) => {
      const rows = snap.rows;
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
    const w = snap.weather;
    const windDir = w?.wind_direction;
    const rain = w?.rainfall;
    const wx = el("div", { class: "wx-text" }, [
      el("div", { class: "legend", text: "Conditions" }),
      el("div", { text: w ? `Air ${w.air_temperature?.toFixed(1) ?? "—"}°C` : "—" }),
      el("div", { text: w ? `Track ${w.track_temperature?.toFixed(1) ?? "—"}°C` : "—" }),
      el("div", {
        text: w
          ? `Wind ${w.wind_speed?.toFixed(1) ?? "—"} m/s${windDir != null ? ` ${Math.round(windDir)}°` : ""}`
          : "—",
      }),
      el("div", {
        text: w
          ? `Hum ${w.humidity?.toFixed(0) ?? "—"}% · ${rain ? "rain" : "dry"}`
          : "—",
      }),
    ]);
    const windSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    windSvg.classList.add("wind-map");
    windSvg.setAttribute("aria-label", "Wind direction on track");
    const wxWrap = el("div", { class: "wx-wind" }, [wx, windSvg]);
    root.append(best, canvas, wxWrap);
    requestAnimationFrame(() => {
      drawGap(canvas, snap.rows);
      drawWind(windSvg);
    });
  };
  return { update };
}
