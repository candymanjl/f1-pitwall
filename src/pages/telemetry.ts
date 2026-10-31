import { apiGet } from "../data/client";
import { cumulativeDistance, lapWindow, pointAt, project } from "../data/track";
import type { CarSample, LocationSample } from "../data/types";
import { TRACE, teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { parseTs } from "../lib/time";
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

function drawTraces(canvas: HTMLCanvasElement, series: Series[], cursorDist: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 640;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const lanes = [
    { key: "speed" as const, label: "SPEED km/h", min: 0, max: 360 },
    { key: "throttle" as const, label: "THROTTLE %", min: 0, max: 100 },
    { key: "brake" as const, label: "BRAKE", min: 0, max: 100 },
    { key: "gear" as const, label: "GEAR", min: 0, max: 8 },
    { key: "rpm" as const, label: "RPM", min: 0, max: 13000 },
    { key: "drs" as const, label: "DRS", min: 0, max: 14 },
    { key: "time" as const, label: "DELTA vs REF", min: -2, max: 2 },
  ];
  const maxDist = Math.max(1, ...series.flatMap((s) => s.dist));
  const padL = 54;
  const padR = 12;
  const laneH = h / lanes.length;
  const ref = series[0];

  lanes.forEach((lane, li) => {
    const y0 = li * laneH;
    ctx.fillStyle = "#8b93a7";
    ctx.font = "11px Titillium Web";
    ctx.fillText(lane.label, 8, y0 + 14);
    ctx.strokeStyle = "#1c2230";
    ctx.beginPath();
    ctx.moveTo(padL, y0 + laneH - 8);
    ctx.lineTo(w - padR, y0 + laneH - 8);
    ctx.stroke();
    for (const s of series) {
      ctx.strokeStyle = s.color || TRACE[series.indexOf(s) % TRACE.length];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.dist.length; i++) {
        let yv = s[lane.key][i];
        if (lane.key === "time" && ref) {
          const rt = nearest(ref, s.dist[i], "time");
          yv = s.time[i] - rt;
        }
        const x = padL + (s.dist[i] / maxDist) * (w - padL - padR);
        const y = y0 + 8 + (1 - (yv - lane.min) / (lane.max - lane.min)) * (laneH - 18);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  const cx = padL + cursorFrac * (w - padL - padR);
  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();
  void cursorDist;
}

function drawMini(svg: SVGSVGElement, series: Series[], frac: number): void {
  svg.replaceChildren();
  const w = svg.clientWidth || 200;
  const h = svg.clientHeight || 160;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const pts = state.bundle?.track ?? series[0]?.pts ?? [];
  if (pts.length < 2) return;
  const { map } = project(pts, w, h, 10);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pts.map((p, i) => {
    const [px, py] = map(p[0], p[1]);
    return `${i === 0 ? "M" : "L"}${px},${py}`;
  }).join(" "));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#e8edf7");
  path.setAttribute("stroke-width", "1.5");
  svg.append(path);
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
  mid.body.append(wrap);
  const page = el("div", { class: "page telemetry" }, [left.root, mid.root, right.root]);
  parent.append(page);
  let series: Series[] = [];
  let lastKey = "";

  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    cursorFrac = Math.min(0.999, Math.max(0, (e.clientX - r.left - 54) / Math.max(1, r.width - 66)));
    paint();
  });

  const paint = () => {
    const maxDist = Math.max(1, ...series.flatMap((s) => s.dist));
    const dist = cursorFrac * maxDist;
    drawTraces(canvas, series, dist);
    const mini = right.body.querySelector("svg");
    if (mini) drawMini(mini as SVGSVGElement, series, cursorFrac);
    const box = right.body.querySelector(".readout");
    if (box) {
      box.replaceChildren();
      box.append(el("div", { class: "legend", text: `${Math.round(dist)} m` }));
      for (const s of series) {
        box.append(
          el("div", { text: `${s.code}  ${nearest(s, dist, "speed").toFixed(0)} km/h  T ${nearest(s, dist, "throttle").toFixed(0)}  B ${nearest(s, dist, "brake").toFixed(0)}` }),
        );
      }
    }
  };

  const renderPickers = () => {
    left.body.replaceChildren();
    const bundle = state.bundle;
    if (!bundle) return;
    const slots = [...state.telemetry].slice(0, 4);
    while (slots.length < 2 && bundle.drivers.length) {
      const d = bundle.drivers[slots.length] ?? bundle.drivers[0];
      slots.push({ driver: d.driver_number, lap: 5 });
    }
    slots.forEach((slot, i) => {
      const wrap = el("div", { class: "chip" });
      const swatch = el("span", { class: "swatch" });
      swatch.style.background = TRACE[i % TRACE.length];
      const ds = el("select") as HTMLSelectElement;
      for (const d of bundle.drivers) {
        const o = el("option", { value: String(d.driver_number), text: d.name_acronym }) as HTMLOptionElement;
        if (d.driver_number === slot.driver) o.selected = true;
        ds.append(o);
      }
      const ls = el("select") as HTMLSelectElement;
      const laps = bundle.laps.filter((l) => l.driver_number === slot.driver && l.lap_duration);
      for (const l of laps) {
        const o = el("option", { value: String(l.lap_number), text: `Lap ${l.lap_number}` }) as HTMLOptionElement;
        if (l.lap_number === slot.lap) o.selected = true;
        ls.append(o);
      }
      const apply = () => {
        slots[i] = { driver: Number(ds.value), lap: Number(ls.value) };
        lastKey = "";
        setTelemetrySlots(slots.slice(0, 4));
      };
      ds.onchange = apply;
      ls.onchange = apply;
      wrap.append(swatch, ds, ls);
      if (slots.length > 2) {
        const rm = el("button", { class: "ghost", text: "×" });
        rm.title = "Remove driver";
        rm.onclick = () => {
          slots.splice(i, 1);
          lastKey = "";
          setTelemetrySlots(slots);
        };
        wrap.append(rm);
      }
      left.body.append(wrap);
    });
    if (slots.length < 4) {
      const add = el("button", { class: "ghost", text: `Add driver (${slots.length}/4)` });
      add.onclick = () => {
        const used = new Set(slots.map((s) => s.driver));
        const next = bundle.drivers.find((d) => !used.has(d.driver_number)) ?? bundle.drivers[0];
        if (!next) return;
        const laps = bundle.laps.filter((l) => l.driver_number === next.driver_number && l.lap_duration);
        slots.push({ driver: next.driver_number, lap: laps[0]?.lap_number ?? 5 });
        lastKey = "";
        setTelemetrySlots(slots);
      };
      left.body.append(add);
    }
    left.body.append(el("div", { class: "help", text: "Up to 4 drivers, each with a distinct trace color. Traces join /car_data to /location by date, then plot against cumulative distance. First driver is the Δ vs REF lane." }));
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
    svg.style.height = "160px";
    svg.style.position = "relative";
    right.body.append(svg, el("div", { class: "readout help" }));
    paint();
  };

  return {
    update: () => {
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
