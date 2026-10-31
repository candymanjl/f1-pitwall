import { apiGet } from "../data/client";
import {
  defaultLapForDriver,
  ensureMinDrivers,
  fastestCompleteLap,
  slotsAtFastest,
  slotsAtLap,
} from "../data/telemetryLaps";
import { cumulativeDistance, detectCorners, lapWindow, pointAt, project } from "../data/track";
import type { CarSample, LocationSample } from "../data/types";
import {
  TRACE_IDS,
  brushFromPointer,
  cornerWindow,
  laneHeight,
  normalizeTrace,
  readTracePrefs,
  resetBrush,
  slicePolyline,
  traceDash,
  traceLabel,
  visibleTraces,
  writeTracePrefs,
  type Brush,
  type TraceId,
  type TracePrefs,
} from "../data/telemetryView";
import { TRACE, teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { bindColumnSplitter, readSplitWidth, writeSplitWidth } from "../lib/splitter";
import { clamp, parseTs } from "../lib/time";
import { panel } from "../ui/panel";
import { isLiveLock } from "../data/errors";
import { applyFetchError, setPanelError, setTelemetrySlots, state } from "../state";

type Series = {
  driver: number;
  code: string;
  color: string;
  lap: number;
  dist: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  gear: number[];
  rpm: number[];
  drs: number[];
  time: number[];
  pts: [number, number][];
};

const cache = new Map<string, Series>();
let cursorFrac = 0.35;
let brush: Brush = resetBrush();
let prefs: TracePrefs = readTracePrefs();

const LANE: Record<TraceId, { key: "speed" | "throttle" | "brake" | "gear" | "rpm" | "drs" | "time"; label: string; min: number; max: number }> = {
  speed: { key: "speed", label: "SPEED km/h", min: 0, max: 360 },
  throttle: { key: "throttle", label: "THROTTLE %", min: 0, max: 100 },
  brake: { key: "brake", label: "BRAKE", min: 0, max: 100 },
  gear: { key: "gear", label: "GEAR", min: 0, max: 8 },
  rpm: { key: "rpm", label: "RPM", min: 0, max: 13000 },
  drs: { key: "drs", label: "DRS", min: 0, max: 14 },
  delta: { key: "time", label: "DELTA vs REF", min: -2, max: 2 },
};

async function loadSeries(driver: number, lapNo: number): Promise<Series | null> {
  const bundle = state.bundle;
  if (!bundle) return null;
  const key = `${bundle.session.session_key}:${driver}:${lapNo}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const lap = bundle.laps.find((l) => l.driver_number === driver && l.lap_number === lapNo);
  const d = bundle.drivers.find((x) => x.driver_number === driver);
  if (!lap || !d) return null;
  const win = lapWindow(lap);
  if (!win) return null;
  const [loc, car] = await Promise.all([
    apiGet<LocationSample[]>("location", {
      session_key: bundle.session.session_key,
      driver_number: driver,
      "date>": win.from,
      "date<": win.to,
    }),
    apiGet<CarSample[]>("car_data", {
      session_key: bundle.session.session_key,
      driver_number: driver,
      "date>": win.from,
      "date<": win.to,
    }),
  ]);
  const path = cumulativeDistance(loc);
  const joined: Series = {
    driver,
    code: d.name_acronym,
    color: teamColor(d.team_colour),
    lap: lapNo,
    dist: [],
    speed: [],
    throttle: [],
    brake: [],
    gear: [],
    rpm: [],
    drs: [],
    time: [],
    pts: loc.map((s) => [s.x, s.y]),
  };
  let pi = 0;
  const t0 = path[0]?.t ?? parseTs(lap.date_start);
  for (const sample of car) {
    const t = parseTs(sample.date);
    while (pi < path.length - 1 && path[pi + 1].t < t) pi += 1;
    const a = path[pi];
    const b = path[Math.min(pi + 1, path.length - 1)];
    const frac = b && b.t !== a.t ? (t - a.t) / (b.t - a.t) : 0;
    const dist = a ? a.dist + ((b?.dist ?? a.dist) - a.dist) * frac : 0;
    joined.dist.push(dist);
    joined.speed.push(sample.speed ?? 0);
    joined.throttle.push(sample.throttle ?? 0);
    joined.brake.push(sample.brake ?? 0);
    joined.gear.push(sample.n_gear ?? 0);
    joined.rpm.push(sample.rpm ?? 0);
    joined.drs.push(sample.drs ?? 0);
    joined.time.push((t - t0) / 1000);
  }
  cache.set(key, joined);
  return joined;
}

function nearest(series: Series, dist: number, key: keyof Series): number {
  if (!series.dist.length) return NaN;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < series.dist.length; i++) {
    const d = Math.abs(series.dist[i] - dist);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const val = series[key];
  return Array.isArray(val) ? Number(val[best]) : NaN;
}

function sampleAt(series: Series, index: number, id: TraceId, ref: Series | undefined): number {
  if (id === "delta") {
    if (!ref) return 0;
    return series.time[index] - nearest(ref, series.dist[index], "time");
  }
  return series[LANE[id].key][index];
}

function viewDistances(series: Series[], range: Brush): { maxDist: number; d0: number; d1: number } {
  const maxDist = Math.max(1, ...series.flatMap((s) => s.dist));
  return { maxDist, d0: range.start * maxDist, d1: range.end * maxDist };
}

function drawTraces(canvas: HTMLCanvasElement, series: Series[], range: Brush): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 640;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const shown = visibleTraces(prefs);
  if (!shown.length) {
    ctx.fillStyle = "#8b93a7";
    ctx.font = "13px Titillium Web";
    ctx.fillText("Select a trace above.", 16, 28);
    return;
  }
  const { d0, d1 } = viewDistances(series, range);
  const padL = 54;
  const padR = 12;
  const xOf = (dist: number) => padL + ((dist - d0) / Math.max(1e-6, d1 - d0)) * (w - padL - padR);
  const ref = series[0];
  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, 0, w - padL - padR, h);
  ctx.clip();

  if (prefs.overlay) {
    const span: Record<TraceId, { min: number; max: number }> = {
      speed: { min: Infinity, max: -Infinity },
      throttle: { min: Infinity, max: -Infinity },
      brake: { min: Infinity, max: -Infinity },
      gear: { min: Infinity, max: -Infinity },
      rpm: { min: Infinity, max: -Infinity },
      drs: { min: Infinity, max: -Infinity },
      delta: { min: Infinity, max: -Infinity },
    };
    for (const id of shown) {
      for (const s of series) {
        for (let i = 0; i < s.dist.length; i++) {
          if (s.dist[i] < d0 || s.dist[i] > d1) continue;
          const yv = sampleAt(s, i, id, ref);
          span[id].min = Math.min(span[id].min, yv);
          span[id].max = Math.max(span[id].max, yv);
        }
      }
    }
    for (const id of shown) {
      ctx.setLineDash(traceDash(id));
      ctx.lineWidth = id === "speed" ? 1.8 : 1.3;
      for (const s of series) {
        ctx.strokeStyle = s.color || TRACE[0];
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < s.dist.length; i++) {
          const yv = normalizeTrace(sampleAt(s, i, id, ref), span[id].min, span[id].max);
          const x = xOf(s.dist[i]);
          const y = 16 + (1 - yv) * (h - 32);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  } else {
    const laneH = laneHeight(h, shown.length);
    shown.forEach((id, li) => {
      const lane = LANE[id];
      const y0 = li * laneH;
      ctx.fillStyle = "#8b93a7";
      ctx.font = "11px Titillium Web";
      ctx.fillText(lane.label, 8, y0 + 14);
      ctx.strokeStyle = "#1c2230";
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(padL, y0 + laneH - 8);
      ctx.lineTo(w - padR, y0 + laneH - 8);
      ctx.stroke();
      for (const s of series) {
        ctx.strokeStyle = s.color || TRACE[0];
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < s.dist.length; i++) {
          const yv = sampleAt(s, i, id, ref);
          const x = xOf(s.dist[i]);
          const y = y0 + 8 + (1 - (yv - lane.min) / (lane.max - lane.min)) * (laneH - 18);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });
  }
  ctx.restore();
  const cx = padL + cursorFrac * (w - padL - padR);
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();
  if (prefs.overlay) drawOverlayLegend(ctx, series, shown, w);
}

function drawOverlayLegend(ctx: CanvasRenderingContext2D, series: Series[], shown: TraceId[], w: number): void {
  const rowH = 15;
  const boxW = 168;
  const boxH = 12 + series.length * rowH + shown.length * rowH;
  const x = w - boxW - 10;
  const y = 8;
  ctx.fillStyle = "rgba(8,10,16,0.88)";
  ctx.fillRect(x, y, boxW, boxH);
  ctx.font = "11px Titillium Web";
  let ly = y + 14;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(x + 8, ly - 8, 14, 3);
    ctx.fillStyle = "#e8edf7";
    ctx.fillText(s.code, x + 28, ly);
    ly += rowH;
  }
  for (const id of shown) {
    ctx.strokeStyle = "#e8edf7";
    ctx.lineWidth = 1.4;
    ctx.setLineDash(traceDash(id));
    ctx.beginPath();
    ctx.moveTo(x + 8, ly - 4);
    ctx.lineTo(x + 28, ly - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#c5d0e6";
    ctx.fillText(traceLabel(id), x + 34, ly);
    ly += rowH;
  }
}

function drawBrush(canvas: HTMLCanvasElement, series: Series[], range: Brush): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 64;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#10141e";
  ctx.fillRect(0, 0, w, h);
  const maxDist = Math.max(1, ...series.flatMap((s) => s.dist));
  for (const s of series) {
    ctx.strokeStyle = s.color || "#94a3b8";
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.dist.length; i++) {
      const x = (s.dist[i] / maxDist) * w;
      const y = 8 + (1 - s.speed[i] / 360) * (h - 16);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(8,10,16,0.55)";
  ctx.fillRect(0, 0, range.start * w, h);
  ctx.fillRect(range.end * w, 0, (1 - range.end) * w, h);
}

function drawMini(svg: SVGSVGElement, series: Series[], frac: number, range: Brush): void {
  svg.replaceChildren();
  const w = svg.clientWidth || 200;
  const h = svg.clientHeight || 160;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const pts = state.bundle?.track ?? series[0]?.pts ?? [];
  if (pts.length < 2) return;
  const { map } = project(pts, w, h, 10);
  const d = (points: [number, number][]) =>
    points
      .map((p, i) => {
        const [px, py] = map(p[0], p[1]);
        return `${i === 0 ? "M" : "L"}${px},${py}`;
      })
      .join(" ");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d(pts));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#3a4258");
  path.setAttribute("stroke-width", "1.6");
  svg.append(path);
  const slice = slicePolyline(pts, range.start, range.end);
  if (slice.length > 1) {
    const hi = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hi.setAttribute("d", d(slice));
    hi.setAttribute("fill", "none");
    hi.setAttribute("stroke", "#f4d20c");
    hi.setAttribute("stroke-width", "3");
    svg.append(hi);
  }
  for (const s of series) {
    const [x, y] = pointAt(pts, frac);
    const [px, py] = map(x, y);
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", String(px));
    c.setAttribute("cy", String(py));
    c.setAttribute("r", "4");
    c.setAttribute("fill", s.color);
    svg.append(c);
  }
}

export function mountTelemetry(parent: HTMLElement): { update: () => void } {
  const left = panel("Drivers  ·  max 4");
  const mid = panel("Telemetry comparison  ·  aligned by distance");
  const right = panel("Readout");
  const canvas = el("canvas", { class: "chart" }) as HTMLCanvasElement;
  const wrap = el("div", { class: "chart-wrap" });
  wrap.append(canvas);

  const tools = el("div", { class: "telem-tools" });
  const chipOf = new Map<TraceId, HTMLButtonElement>();
  for (const id of TRACE_IDS) {
    const chip = el("button", { class: "trace-chip", type: "button", text: traceLabel(id) }) as HTMLButtonElement;
    chip.onclick = () => {
      prefs.visible[id] = !prefs.visible[id];
      writeTracePrefs(prefs);
      syncTools();
      paint();
    };
    chipOf.set(id, chip);
    tools.append(chip);
  }
  const overlayBtn = el("button", { class: "trace-chip overlay", type: "button", text: "Overlay" }) as HTMLButtonElement;
  overlayBtn.title = "Draw the selected traces in one panel. Each channel has its own line style; each driver keeps a color.";
  overlayBtn.onclick = () => {
    prefs.overlay = !prefs.overlay;
    writeTracePrefs(prefs);
    syncTools();
    paint();
  };
  tools.append(overlayBtn);

  const cornerRow = el("div", { class: "corner-row" });
  const brushHost = el("div", { class: "brush" });
  const overview = el("canvas", { class: "brush-canvas" }) as HTMLCanvasElement;
  const windowEl = el("div", { class: "brush-window" });
  const startHandle = el("div", { class: "brush-handle start" });
  const endHandle = el("div", { class: "brush-handle end" });
  startHandle.title = "Drag to set the start of the zoom";
  endHandle.title = "Drag to set the end of the zoom";
  windowEl.title = "Drag to move the zoom. Double-click to show the full lap.";
  brushHost.append(overview, windowEl, startHandle, endHandle);
  const brushBlock = el("div", { class: "brush-block" }, [
    cornerRow,
    brushHost,
    el("div", { class: "brush-hint", text: "Drag the window or the handles to zoom every trace. Double-click the overview to reset." }),
  ]);
  const body = el("div", { class: "telem-body" }, [tools, wrap, brushBlock]);
  mid.body.append(body);

  const split = el("div", { class: "telem-split" });
  split.setAttribute("role", "separator");
  split.setAttribute("aria-orientation", "vertical");
  split.setAttribute("aria-label", "Resize drivers panel");
  split.tabIndex = 0;
  const page = el("div", { class: "page telemetry" }, [left.root, split, mid.root, right.root]);
  parent.append(page);
  const SIDE_KEY = "f1pitwall.telemetryDriversWidth";
  const SIDE_MIN = 280;
  const SIDE_MAX = 560;
  let sideWidth = readSplitWidth(SIDE_KEY, 352, SIDE_MIN, SIDE_MAX);
  const applySide = (px: number) => {
    sideWidth = px;
    page.style.setProperty("--telem-side", `${px}px`);
    split.setAttribute("aria-valuemin", String(SIDE_MIN));
    split.setAttribute("aria-valuemax", String(SIDE_MAX));
    split.setAttribute("aria-valuenow", String(Math.round(px)));
    writeSplitWidth(SIDE_KEY, px);
  };
  applySide(sideWidth);
  bindColumnSplitter(split, {
    width: () => sideWidth,
    onWidth: applySide,
    min: SIDE_MIN,
    max: SIDE_MAX,
  });
  let series: Series[] = [];
  let lastKey = "";
  let cornerKey = "*";
  let drag: { mode: "start" | "end" | "move"; origin: Brush; originFrac: number } | null = null;

  const syncTools = () => {
    for (const id of TRACE_IDS) {
      const chip = chipOf.get(id);
      if (!chip) continue;
      const on = prefs.visible[id];
      chip.classList.toggle("off", !on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    overlayBtn.classList.toggle("on", prefs.overlay);
    overlayBtn.setAttribute("aria-pressed", prefs.overlay ? "true" : "false");
  };

  const placeBrush = () => {
    windowEl.style.left = `${brush.start * 100}%`;
    windowEl.style.width = `${(brush.end - brush.start) * 100}%`;
    startHandle.style.left = `${brush.start * 100}%`;
    endHandle.style.left = `${brush.end * 100}%`;
  };

  const pointerFrac = (e: PointerEvent) => {
    const rect = brushHost.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  };

  const beginDrag = (mode: "start" | "end" | "move", e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag = { mode, origin: { start: brush.start, end: brush.end }, originFrac: pointerFrac(e) };
    brushHost.setPointerCapture(e.pointerId);
  };
  startHandle.addEventListener("pointerdown", (e) => beginDrag("start", e));
  endHandle.addEventListener("pointerdown", (e) => beginDrag("end", e));
  windowEl.addEventListener("pointerdown", (e) => beginDrag("move", e));
  brushHost.addEventListener("pointermove", (e) => {
    if (!drag) return;
    brush = brushFromPointer(drag.mode, drag.origin, drag.originFrac, pointerFrac(e));
    placeBrush();
    paint();
  });
  const endDrag = () => {
    drag = null;
  };
  brushHost.addEventListener("pointerup", endDrag);
  brushHost.addEventListener("pointercancel", endDrag);
  brushHost.addEventListener("dblclick", () => {
    brush = resetBrush();
    placeBrush();
    paint();
  });

  const renderCorners = () => {
    const fromBundle = state.bundle?.corners ?? [];
    const corners = fromBundle.length ? fromBundle : detectCorners(series[0]?.pts ?? []);
    const key = corners.map((corner) => `${corner.n}:${corner.dist.toFixed(4)}`).join("|");
    if (key === cornerKey) return;
    cornerKey = key;
    cornerRow.replaceChildren();
    if (!corners.length) {
      cornerRow.append(el("span", { class: "brush-hint", text: "Corner buttons show up with the lap outline." }));
      return;
    }
    for (const corner of corners) {
      const btn = el("button", { class: "trace-chip", type: "button", text: `T${corner.n}` }) as HTMLButtonElement;
      btn.title = `Zoom to corner ${corner.n}`;
      btn.onclick = () => {
        brush = cornerWindow(corner.dist);
        placeBrush();
        paint();
      };
      cornerRow.append(btn);
    }
  };

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    cursorFrac = Math.min(0.999, Math.max(0, (e.clientX - r.left - 54) / Math.max(1, r.width - 66)));
    paint();
  });

  const paint = () => {
    const maxDist = Math.max(1, ...series.flatMap((s) => s.dist));
    const abs = brush.start + cursorFrac * (brush.end - brush.start);
    const dist = abs * maxDist;
    drawTraces(canvas, series, brush);
    drawBrush(overview, series, brush);
    placeBrush();
    renderCorners();
    const mini = right.body.querySelector("svg");
    if (mini) drawMini(mini as SVGSVGElement, series, abs, brush);
    const box = right.body.querySelector(".readout");
    if (box) {
      const d0 = Math.round(brush.start * maxDist);
      const d1 = Math.round(brush.end * maxDist);
      box.replaceChildren();
      box.append(el("div", { class: "legend", text: `${d0}–${d1} m · cursor ${Math.round(dist)} m` }));
      for (const s of series) {
        box.append(
          el("div", { text: `${s.code}  ${nearest(s, dist, "speed").toFixed(0)} km/h  T ${nearest(s, dist, "throttle").toFixed(0)}  B ${nearest(s, dist, "brake").toFixed(0)}` }),
        );
      }
    }
  };
  syncTools();
  placeBrush();

  const commitSlots = (next: { driver: number; lap: number }[]) => {
    const capped = next.slice(0, 4);
    const same =
      capped.length === state.telemetry.length &&
      capped.every((slot, index) => slot.driver === state.telemetry[index].driver && slot.lap === state.telemetry[index].lap);
    if (same) return;
    lastKey = "";
    setTelemetrySlots(capped);
  };

  const renderPickers = () => {
    left.body.replaceChildren();
    const bundle = state.bundle;
    if (!bundle) return;
    const pits = bundle.pits ?? [];
    const slots = [...state.telemetry].slice(0, 4);
    slots.forEach((slot, i) => {
      const wrap = el("div", { class: "telem-slot" });
      const swatch = el("span", { class: "swatch" });
      swatch.style.background = TRACE[i % TRACE.length];
      const ds = el("select") as HTMLSelectElement;
      ds.setAttribute("aria-label", `Driver ${i + 1}`);
      for (const d of bundle.drivers) {
        const o = el("option", { value: String(d.driver_number), text: d.name_acronym }) as HTMLOptionElement;
        if (d.driver_number === slot.driver) o.selected = true;
        ds.append(o);
      }
      const ls = el("select") as HTMLSelectElement;
      ls.setAttribute("aria-label", `Lap for driver ${i + 1}`);
      const laps = bundle.laps.filter((l) => l.driver_number === slot.driver && l.lap_duration);
      for (const l of laps) {
        const o = el("option", { value: String(l.lap_number), text: `Lap ${l.lap_number}` }) as HTMLOptionElement;
        if (l.lap_number === slot.lap) o.selected = true;
        ls.append(o);
      }
      ds.onchange = () => {
        const driver = Number(ds.value);
        const keep = bundle.laps.some(
          (lap) => lap.driver_number === driver && lap.lap_number === slot.lap && lap.lap_duration,
        );
        const lap = keep ? slot.lap : defaultLapForDriver(bundle.laps, driver, pits);
        slots[i] = { driver, lap };
        commitSlots(slots);
      };
      ls.onchange = () => {
        slots[i] = { driver: Number(ds.value), lap: Number(ls.value) };
        commitSlots(slots);
      };
      const fastLap = fastestCompleteLap(bundle.laps, slot.driver, pits);
      const fast = el("button", { class: "telem-fast", type: "button", text: "Fastest" }) as HTMLButtonElement;
      if (fastLap == null) {
        fast.disabled = true;
        fast.title = "No complete lap with all three sectors";
      } else {
        fast.title = `Load lap ${fastLap}, the fastest complete lap`;
        fast.onclick = () => {
          slots[i] = { driver: slot.driver, lap: fastLap };
          commitSlots(slots);
        };
      }
      wrap.append(swatch, ds, ls, fast);
      if (slots.length > 2) {
        const rm = el("button", { class: "telem-remove", type: "button", text: "×" }) as HTMLButtonElement;
        rm.title = "Remove driver";
        rm.setAttribute("aria-label", "Remove driver");
        rm.onclick = () => {
          slots.splice(i, 1);
          commitSlots(slots);
        };
        wrap.append(rm);
      }
      left.body.append(wrap);
    });
    if (slots.length < 4) {
      const add = el("button", {
        class: "telem-add",
        type: "button",
        text: `Add driver (${slots.length}/4)`,
      }) as HTMLButtonElement;
      add.onclick = () => {
        const used = new Set(slots.map((s) => s.driver));
        const next = bundle.drivers.find((d) => !used.has(d.driver_number)) ?? bundle.drivers[0];
        if (!next) return;
        slots.push({ driver: next.driver_number, lap: defaultLapForDriver(bundle.laps, next.driver_number, pits) });
        commitSlots(slots);
      };
      left.body.append(add);
    }
    if (slots.length) {
      const bulk = el("div", { class: "telem-bulk" });
      const allFast = el("button", { class: "telem-bulk-btn", type: "button", text: "All to fastest" }) as HTMLButtonElement;
      allFast.onclick = () => commitSlots(slotsAtFastest(slots, bundle.laps, pits));
      const lapInput = el("input") as HTMLInputElement;
      lapInput.type = "number";
      lapInput.min = "1";
      lapInput.max = "120";
      lapInput.value = String(slots[0]?.lap ?? 1);
      lapInput.setAttribute("aria-label", "Lap number for every driver");
      const allLap = el("button", { class: "telem-bulk-btn", type: "button", text: "All to lap" }) as HTMLButtonElement;
      allLap.onclick = () => {
        const n = Math.round(Number(lapInput.value));
        commitSlots(slotsAtLap(slots, bundle.laps, n));
      };
      bulk.append(allFast, lapInput, allLap);
      left.body.append(bulk);
    }
    left.body.append(el("div", { class: "help", text: "Up to 4 drivers, each with a distinct trace color. New drivers open on their fastest complete lap. Traces join /car_data to /location by date, then plot against cumulative distance. First driver is the Δ vs REF lane. Drag the bar beside this list to widen it." }));
  };

  const reload = async () => {
    mid.setTitle("Loading lap telemetry…");
    mid.setError(null);
    const loaded: Series[] = [];
    const seen = new Set<string>();
    let lastErr = "";
    for (const slot of state.telemetry) {
      const id = `${slot.driver}:${slot.lap}`;
      if (seen.has(id)) continue;
      seen.add(id);
      try {
        const s = await loadSeries(slot.driver, slot.lap);
        if (s) loaded.push({ ...s, color: TRACE[loaded.length % TRACE.length] });
        else lastErr = `No telemetry samples for driver ${slot.driver} lap ${slot.lap}.`;
      } catch (err) {
        if (isLiveLock(err)) {
          applyFetchError(err);
          mid.setTitle("Telemetry comparison");
          mid.setError("OpenF1 is locked during the live session. Add a key in Settings or wait for the session to end.");
          return;
        }
        lastErr = err instanceof Error ? err.message : "Telemetry fetch failed.";
      }
    }
    series = loaded;
    mid.setTitle("Telemetry comparison  ·  aligned by distance");
    mid.setError(loaded.length ? null : lastErr || null);
    if (lastErr && !loaded.length) setPanelError("telemetry", lastErr);
    else setPanelError("telemetry", "");
    right.body.replaceChildren();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("mini");
    svg.style.height = "10rem";
    svg.style.position = "relative";
    right.body.append(svg, el("div", { class: "readout help" }));
    paint();
  };

  return {
    update: () => {
      const bundle = state.bundle;
      if (bundle) {
        const padded = ensureMinDrivers(state.telemetry, bundle.drivers, bundle.laps, bundle.pits ?? []);
        if (padded !== state.telemetry) state.telemetry = padded;
      }
      const key = `${state.sessionKey}:${state.telemetry.map((s) => `${s.driver}-${s.lap}`).join(",")}`;
      if (key !== lastKey && state.bundle) {
        lastKey = key;
        renderPickers();
        void reload();
      } else {
        paint();
      }
    },
  };
}
