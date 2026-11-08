import { circuitCoord, hasIemRadar } from "../data/circuitCoords";
import { IEM_CREDIT, IEM_HOME, iemWmsUrl, roundToRadarStep } from "../data/iemRadar";
import {
  fetchArchive,
  fetchForecast,
  isoDateUtc,
  OPEN_METEO_CREDIT,
  OPEN_METEO_HOME,
  upcomingForecast,
  type ArchiveHour,
  type ForecastHour,
} from "../data/openMeteo";
import {
  fetchRainViewerCatalog,
  radarTileWindow,
  RAINVIEWER_CREDIT,
  RAINVIEWER_HOME,
  RAINVIEWER_ZOOM,
  rainViewerTileUrl,
  type RainViewerFrame,
} from "../data/rainViewer";
import { project, windArrowScreen } from "../data/track";
import { derivedStraightWinds, geoNorthScreen } from "../data/windRelative";
import { formatPressure } from "../data/weatherPressure";
import { rainObservedBuckets, weatherAt, weatherHistoryUpTo, windFromLabel } from "../data/weatherView";
import { el } from "../lib/dom";
import { appendSectorOutline } from "../lib/trackOutline";
import { formatClock, parseTs } from "../lib/time";
import { fitWindArrow } from "../lib/windFlow";
import { panel } from "../ui/panel";
import { state } from "../state";

const rvCache: { at: number; frames: RainViewerFrame[]; inflight: boolean } = { at: 0, frames: [], inflight: false };
const forecastCache = new Map<string, ForecastHour[]>();
const archiveCache = new Map<string, ArchiveHour[]>();

function isLive(): boolean {
  return state.mode === "live";
}

function compass(deg: number | null | undefined): string {
  const dir = windFromLabel(deg);
  return dir === "—" ? "—" : dir;
}

function card(label: string, value: string, tone: string, test: string): HTMLElement {
  const node = el("article", { class: `wx-card ${tone}`, "data-card": test }, [
    el("div", { class: "wx-card-k", text: label }),
    el("div", { class: "wx-card-v", text: value }),
  ]);
  return node;
}

function drawTrackWind(svg: SVGSVGElement): void {
  const w = svg.clientWidth || 640;
  const h = svg.clientHeight || 360;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren();
  const pts = state.bundle?.track ?? [];
  if (pts.length < 2) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(w / 2));
    t.setAttribute("y", String(h / 2));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", "#64748b");
    t.textContent = "No track outline";
    svg.append(t);
    return;
  }
  const grid = document.createElementNS("http://www.w3.org/2000/svg", "g");
  grid.setAttribute("class", "wx-gridlines");
  for (let i = 1; i < 8; i++) {
    const lineH = document.createElementNS("http://www.w3.org/2000/svg", "line");
    lineH.setAttribute("x1", "0");
    lineH.setAttribute("x2", String(w));
    lineH.setAttribute("y1", String((h * i) / 8));
    lineH.setAttribute("y2", String((h * i) / 8));
    const lineV = document.createElementNS("http://www.w3.org/2000/svg", "line");
    lineV.setAttribute("y1", "0");
    lineV.setAttribute("y2", String(h));
    lineV.setAttribute("x1", String((w * i) / 8));
    lineV.setAttribute("x2", String((w * i) / 8));
    grid.append(lineH, lineV);
  }
  svg.append(grid);
  const { map } = project(pts, w, h, 36);
  appendSectorOutline(svg, pts, map, state.bundle?.sectorFracs, { width: 3.2, className: "wx-outline" });
  const north = geoNorthScreen(pts, w, h);
  if (north) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", "text");
    n.setAttribute("x", String(north.to[0]));
    n.setAttribute("y", String(north.to[1]));
    n.setAttribute("class", "wx-n");
    n.setAttribute("text-anchor", "middle");
    n.textContent = "N";
    svg.append(n);
  }
  const dir = state.snap?.weather?.wind_direction;
  const arrow = dir != null ? windArrowScreen(pts, dir, w, h) : null;
  if (arrow) {
    const fitted = fitWindArrow(arrow.from[0], arrow.from[1], arrow.to[0], arrow.to[1], w, h, 72);
    const dx = fitted.x2 - fitted.x1;
    const dy = fitted.y2 - fitted.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "wx-wind-arrow");
    const hx = fitted.x2;
    const hy = fitted.y2;
    const backx = hx - ux * 16;
    const backy = hy - uy * 16;
    path.setAttribute(
      "d",
      `M${fitted.x1.toFixed(1)},${fitted.y1.toFixed(1)} L${backx.toFixed(1)},${backy.toFixed(1)} M${hx.toFixed(1)},${hy.toFixed(1)} L${(backx - uy * 7).toFixed(1)},${(backy + ux * 7).toFixed(1)} L${(backx + uy * 7).toFixed(1)},${(backy - ux * 7).toFixed(1)} Z`,
    );
    const lab = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lab.setAttribute("x", String((fitted.x1 + fitted.x2) / 2));
    lab.setAttribute("y", String((fitted.y1 + fitted.y2) / 2 - 8));
    lab.setAttribute("class", "wx-wind-lab");
    lab.setAttribute("text-anchor", "middle");
    lab.textContent = "WIND TRAVEL";
    svg.append(path, lab);
  }
  const sf = map(pts[0][0], pts[0][1]);
  const sfLab = document.createElementNS("http://www.w3.org/2000/svg", "text");
  sfLab.setAttribute("x", String(sf[0]));
  sfLab.setAttribute("y", String(Math.min(h - 8, sf[1] + 16)));
  sfLab.setAttribute("class", "wx-sf");
  sfLab.setAttribute("text-anchor", "middle");
  sfLab.textContent = "START / FINISH";
  svg.append(sfLab);
}

function drawHistory(canvas: HTMLCanvasElement, now: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const box = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width) || 640);
  const h = Math.max(1, Math.round(box.height) || 220);
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const start = state.start;
  const end = Math.max(state.end, start + 1);
  const hist = weatherHistoryUpTo(state.bundle?.weather, now);
  const pad = { l: 28, r: 12, t: 16, b: 36 };
  const x = (t: number) => pad.l + ((t - start) / (end - start)) * (w - pad.l - pad.r);
  const temps = hist.flatMap((row) => [row.air_temperature, row.track_temperature]).filter((n): n is number => n != null);
  const lo = Math.min(10, ...temps, 20);
  const hi = Math.max(40, ...temps, 30);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1, hi - lo)) * (h - pad.t - pad.b);
  const line = (key: "air_temperature" | "track_temperature", color: string) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    let started = false;
    for (const row of hist) {
      const v = row[key];
      if (v == null) continue;
      const px = x(parseTs(row.date));
      const py = y(v);
      if (!started) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      started = true;
    }
    if (started) ctx.stroke();
  };
  line("track_temperature", "#eab308");
  line("air_temperature", "#38bdf8");
  const cx = x(Math.min(now, end));
  ctx.strokeStyle = "#e8edf7";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, pad.t);
  ctx.lineTo(cx, h - pad.b);
  ctx.stroke();
  ctx.fillStyle = "#8b93a7";
  ctx.font = "600 11px Titillium Web, sans-serif";
  ctx.fillText(formatClock(0), pad.l, h - 8);
  ctx.textAlign = "right";
  ctx.fillText(formatClock(end - start), w - pad.r, h - 8);
  ctx.textAlign = "left";
}

function drawPrecip(canvas: HTMLCanvasElement, hours: ArchiveHour[], now: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const box = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width) || 640);
  const h = Math.max(1, Math.round(box.height) || 180);
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const start = state.start;
  const end = Math.max(state.end, start + 1);
  const inPlay = hours.filter((row) => row.t >= start - 60 * 60_000 && row.t <= end + 60 * 60_000);
  const max = Math.max(1, ...inPlay.map((row) => row.precipMm ?? 0));
  const bw = Math.max(4, (w - 24) / Math.max(1, inPlay.length) - 4);
  inPlay.forEach((row, i) => {
    const x = 12 + i * ((w - 24) / Math.max(1, inPlay.length));
    const hh = ((row.precipMm ?? 0) / max) * (h - 36);
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(x, h - 22 - hh, bw, hh);
  });
  const mark = (t: number, color: string) => {
    const x = 12 + ((t - start) / (end - start)) * (w - 24);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x, h - 18);
    ctx.stroke();
  };
  mark(start, "#64748b");
  mark(Math.min(now, end), "#e8edf7");
  mark(end, "#64748b");
}

function creditLink(href: string, text: string): HTMLAnchorElement {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", text }) as HTMLAnchorElement;
}

function paintRadar(host: HTMLElement, frames: RainViewerFrame[], frameIndex: number, lat: number, lon: number): void {
  const frame = frames[Math.max(0, Math.min(frames.length - 1, frameIndex))];
  host.replaceChildren();
  if (!frame) {
    host.append(el("div", { class: "wx-empty", text: "No RainViewer frames." }));
    return;
  }
  const win = radarTileWindow(lat, lon, RAINVIEWER_ZOOM, 3);
  const mosaic = el("div", { class: "wx-mosaic", "data-radar": "rainviewer" });
  mosaic.style.gridTemplateColumns = `repeat(${win.size}, 1fr)`;
  for (let dy = 0; dy < win.size; dy++) {
    for (let dx = 0; dx < win.size; dx++) {
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.src = rainViewerTileUrl(frame, win.z, win.x0 + dx, win.y0 + dy);
      mosaic.append(img);
    }
  }
  const map = el("div", { class: "wx-radar-map" });
  const pin = el("div", { class: "wx-pin", title: "Circuit" });
  pin.style.left = `${(win.pinX / win.size) * 100}%`;
  pin.style.top = `${(win.pinY / win.size) * 100}%`;
  map.append(mosaic, pin);
  const ageMin = Math.max(0, Math.round((Date.now() / 1000 - frame.time) / 60));
  host.append(
    map,
    el("div", { class: "wx-radar-meta" }, [
      el("span", { text: `Frame age: ${ageMin} min · regional scale, not sector rain` }),
      creditLink(RAINVIEWER_HOME, RAINVIEWER_CREDIT),
    ]),
  );
}

export function mountWeather(parent: HTMLElement): { update: () => void } {
  const page = el("div", { class: "page weather" });
  const title = el("h2", { class: "wx-title", text: "Weather" });
  const sub = el("p", { class: "wx-sub", text: "" });
  const head = el("div", { class: "wx-head" }, [el("div", {}, [title, sub])]);
  const cards = el("div", { class: "wx-cards" });
  const trackPanel = panel("Track and wind");
  trackPanel.root.classList.add("wx-track-panel");
  const trackSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  trackSvg.classList.add("wx-track");
  trackPanel.body.append(el("p", { class: "wx-note", text: "Wind arrow uses the same circuit transform as the Track Map." }), trackSvg);
  const sidePanel = panel("Regional rain radar");
  const sideBody = el("div", { class: "wx-side" });
  sidePanel.body.append(sideBody);
  const lowLeft = panel("Wind relative to the circuit");
  const lowRight = panel("Forecast rain probability");
  const credits = el("p", { class: "wx-credits" }, [
    document.createTextNode("Sources: OpenF1 circuit weather · "),
    creditLink(RAINVIEWER_HOME, RAINVIEWER_CREDIT),
    document.createTextNode(" · "),
    creditLink(OPEN_METEO_HOME, OPEN_METEO_CREDIT),
    document.createTextNode(" · "),
    creditLink(IEM_HOME, `${IEM_CREDIT} NEXRAD`),
    document.createTextNode(" (US replays only)"),
  ]);
  const main = el("div", { class: "wx-main" }, [trackPanel.root, sidePanel.root, lowLeft.root, lowRight.root]);
  page.append(head, cards, main, credits);
  parent.append(page);

  let rvIndex = -1;
  let lastKey = "";
  let lastLayout = "";
  let histCanvas: HTMLCanvasElement | null = null;
  let precipCanvas: HTMLCanvasElement | null = null;

  const loadRemote = () => {
    const coord = circuitCoord(state.bundle?.session, state.bundle?.meeting);
    if (!coord) return;
    const live = isLive();
    if (live && !rvCache.inflight && Date.now() - rvCache.at > 60_000) {
      rvCache.inflight = true;
      void fetchRainViewerCatalog()
        .then((frames) => {
          rvCache.at = Date.now();
          rvCache.frames = frames;
          if (page.isConnected) update();
        })
        .catch(() => {
          rvCache.at = Date.now();
          if (page.isConnected) update();
        })
        .finally(() => {
          rvCache.inflight = false;
        });
    }
    if (live) {
      const key = `${coord.lat},${coord.lon}`;
      if (!forecastCache.has(key)) {
        forecastCache.set(key, []);
        void fetchForecast(coord.lat, coord.lon)
          .then((hours) => {
            forecastCache.set(key, hours);
            if (page.isConnected) update();
          })
          .catch(() => undefined);
      }
    } else {
      const key = `${coord.lat},${coord.lon},${isoDateUtc(state.start)}`;
      if (!archiveCache.has(key)) {
        archiveCache.set(key, []);
        void fetchArchive(coord.lat, coord.lon, state.start, state.end)
          .then((hours) => {
            archiveCache.set(key, hours);
            if (page.isConnected) update();
          })
          .catch(() => undefined);
      }
    }
  };

  const update = () => {
    const live = isLive();
    const snap = state.snap;
    const now = snap?.now ?? state.t;
    const wx = snap?.weather ?? weatherAt(state.bundle?.weather, now);
    page.dataset.mode = live ? "live" : "replay";
    title.textContent = live ? "Weather  /  Radar focus" : "Weather  /  Replay analysis";
    sub.textContent = live
      ? "OpenF1 circuit readings with regional radar. Radar is nearby precipitation, not track wetness."
      : "OpenF1 session history plus model archive. No live radar in replay.";
    const rain = wx?.rainfall && wx.rainfall > 0;
    cards.replaceChildren(
      card("Air", wx?.air_temperature != null ? `${wx.air_temperature.toFixed(1)}°C` : "—", "air", "air"),
      card("Track", wx?.track_temperature != null ? `${wx.track_temperature.toFixed(1)}°C` : "—", "track", "track"),
      card("Rain at circuit", wx ? (rain ? "YES" : "NO") : "—", rain ? "rain-yes" : "rain-no", "rain"),
      card(
        `Wind from ${compass(wx?.wind_direction)}`,
        wx?.wind_speed != null ? `${wx.wind_speed.toFixed(1)} m/s` : "—",
        "wind",
        "wind",
      ),
      card("Humidity", wx?.humidity != null ? `${wx.humidity.toFixed(0)}%` : "—", "hum", "humidity"),
      card("Pressure", formatPressure(wx?.pressure ?? null), "press", "pressure"),
    );
    drawTrackWind(trackSvg);

    const coord = circuitCoord(state.bundle?.session, state.bundle?.meeting);
    const pts = state.bundle?.track ?? [];
    const derived =
      wx?.wind_direction != null && wx.wind_speed != null
        ? derivedStraightWinds(pts, wx.wind_direction, wx.wind_speed, state.bundle?.sectorFracs)
        : [];

    const key = `${live ? "L" : "R"}:${state.bundle?.session.session_key ?? 0}:${coord?.name ?? ""}`;
    if (key !== lastKey) {
      lastKey = key;
      loadRemote();
    }

    const frames = rvCache.frames;
    if (rvIndex < 0 && frames.length) rvIndex = frames.length - 1;
    const hours = coord ? upcomingForecast(forecastCache.get(`${coord.lat},${coord.lon}`) ?? [], Date.now()) : [];
    const us = hasIemRadar(state.bundle?.session, state.bundle?.meeting);
    const archiveKey = coord ? `${coord.lat},${coord.lon},${isoDateUtc(state.start)}` : "";
    const archive = archiveCache.get(archiveKey) ?? [];
    const frameTime = frames[rvIndex]?.time ?? 0;
    const layout = live
      ? `L:${coord?.name ?? ""}:${frames.length}:${frameTime}:${hours.length}`
      : `R:${coord?.name ?? ""}:${us ? 1 : 0}:${roundToRadarStep(now)}:${archive.length}`;

    if (layout !== lastLayout) {
      lastLayout = layout;
      histCanvas = null;
      precipCanvas = null;
      if (live) {
        sidePanel.setTitle("Regional rain radar");
        lowLeft.setTitle("Wind relative to the circuit");
        lowRight.setTitle("Forecast rain probability");
        const frameWrap = el("div", { class: "wx-radar" });
        if (!coord) {
          frameWrap.append(el("div", { class: "wx-empty", text: "Circuit location unknown — radar needs lat/lon." }));
        } else if (!frames.length) {
          frameWrap.append(el("div", { class: "wx-empty", text: "Loading RainViewer frames…" }));
        } else {
          paintRadar(frameWrap, frames, rvIndex, coord.lat, coord.lon);
          const scrub = el("input", {
            type: "range",
            min: "0",
            max: String(frames.length - 1),
            value: String(rvIndex),
            class: "wx-scrub",
          }) as HTMLInputElement;
          scrub.oninput = () => {
            rvIndex = Number(scrub.value);
            lastLayout = "";
            update();
          };
          frameWrap.append(
            el("div", { class: "wx-scrub-row" }, [
              el("span", { text: "2 hours ago" }),
              scrub,
              el("span", { text: "Latest" }),
            ]),
            el("div", { class: "wx-scale" }, [
              el("span", { text: "Light" }),
              el("i", { class: "wx-scale-bar" }),
              el("span", { text: "Heavy" }),
            ]),
          );
        }
        sideBody.replaceChildren(frameWrap);
        const maxP = Math.max(1, ...hours.map((h) => h.prob ?? 0));
        lowRight.body.replaceChildren(
          el("p", { class: "wx-note", text: "Open-Meteo model · Upcoming hours · Not an observation" }),
          el(
            "div",
            { class: "wx-bars", "data-forecast": String(hours.length) },
            hours.map((h) => {
              const bar = el("div", { class: "wx-bar" });
              const fill = el("i");
              fill.style.height = `${((h.prob ?? 0) / maxP) * 100}%`;
              bar.append(fill, el("span", { text: `${h.prob ?? 0}%` }));
              return bar;
            }),
          ),
        );
      } else {
        sidePanel.setTitle("Session weather history");
        lowLeft.setTitle("Regional history");
        lowRight.setTitle("Precipitation history");
        histCanvas = el("canvas", { class: "wx-hist" }) as HTMLCanvasElement;
        const histWrap = el("div", { class: "wx-hist-wrap" }, [histCanvas]);
        const strip = el("div", { class: "wx-rain-strip" });
        const buckets = rainObservedBuckets(state.bundle?.weather, state.start, state.end, now);
        for (const on of buckets) strip.append(el("i", { class: on ? "on" : "" }));
        sideBody.replaceChildren(
          el("p", { class: "wx-note", text: "OpenF1 observations · Replay cursor follows the session clock" }),
          el("div", { class: "wx-legend" }, [
            el("span", { class: "track", text: "Track temperature" }),
            el("span", { class: "air", text: "Air temperature" }),
          ]),
          histWrap,
          el("div", { class: "wx-rain-label", text: "Rain observed" }),
          strip,
          el("p", { class: "wx-note", text: "Last recorded sample is held until the next observation. No future leakage." }),
        );
        if (us && coord) {
          const wrap = el("div", { class: "wx-iem-wrap" });
          const img = document.createElement("img");
          img.className = "wx-iem";
          img.alt = "IEM NEXRAD replay radar";
          img.src = iemWmsUrl(coord.lat, coord.lon, now);
          const pin = el("div", { class: "wx-pin", title: "Circuit" });
          pin.style.left = "50%";
          pin.style.top = "50%";
          wrap.append(img, pin);
          lowLeft.body.replaceChildren(
            el("p", { class: "wx-note" }, [
              document.createTextNode("NEXRAD ~5 min frames · US circuits only · "),
              creditLink(IEM_HOME, IEM_CREDIT),
            ]),
            wrap,
          );
          lowLeft.root.dataset.radar = "iem";
        } else {
          lowLeft.body.replaceChildren(
            el("div", { class: "wx-empty", "data-radar": "none", text: "Radar archive unavailable for this session" }),
            el("p", { class: "wx-note", text: "Open-Meteo hourly regional model is still shown. No live radar in replay." }),
          );
          lowLeft.root.dataset.radar = "none";
        }
        precipCanvas = el("canvas", { class: "wx-precip" }) as HTMLCanvasElement;
        lowRight.body.replaceChildren(
          el("p", { class: "wx-note", text: "Open-Meteo · Hourly totals in mm · Regional model, not measured track rainfall" }),
          el("div", { class: "wx-precip-wrap" }, [precipCanvas]),
          el("p", { class: "wx-axis", text: "Session start · Replay cursor · Session end" }),
        );
      }
    }

    if (live) {
      lowLeft.body.replaceChildren(
        el("p", { class: "wx-note", text: "One circuit weather station · Derived components" }),
        ...derived.map((row) =>
          el("div", { class: "wx-derived", "data-kind": row.kind }, [
            el("span", { text: row.label }),
            el("strong", { text: `${row.kind} ${row.speed.toFixed(1)} m/s` }),
          ]),
        ),
        el("div", { class: "wx-confidence" }, [
          el("h3", { text: "Data confidence" }),
          el("p", { text: "Circuit readings: OpenF1" }),
          el("p", { text: "Radar: nearby precipitation, not track wetness" }),
          el("p", { text: "No automatic rain arrival claim" }),
        ]),
      );
    } else {
      if (histCanvas) drawHistory(histCanvas, now);
      if (precipCanvas) drawPrecip(precipCanvas, archive, now);
      const strip = sideBody.querySelector(".wx-rain-strip");
      if (strip) {
        const buckets = rainObservedBuckets(state.bundle?.weather, state.start, state.end, now);
        strip.replaceChildren(...buckets.map((on) => el("i", { class: on ? "on" : "" })));
      }
    }
  };

  return { update };
}
