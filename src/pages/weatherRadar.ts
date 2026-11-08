import { IEM_CREDIT, IEM_HOME, iemWmsUrl } from "../data/iemRadar";
import {
  formatRadarTimestamp,
  frameDelayMs,
  nearestRadarIndex,
  nextRadarIndex,
  playStartIndex,
  type RadarSpeed,
} from "../data/radarLoop";
import { F1_CIRCUITS_CREDIT, F1_CIRCUITS_HOME, lngLatToMosaicPct, type TileWindow } from "../data/geoCircuit";
import type { RadarOverlay } from "../data/radarOverlay";
import {
  radarTileWindow,
  RAINVIEWER_CREDIT,
  RAINVIEWER_HOME,
  RAINVIEWER_ZOOM,
  rainViewerTileUrl,
  type RainViewerFrame,
} from "../data/rainViewer";
import { el } from "../lib/dom";

export const RAINVIEWER_TRACK_ZOOM = 7;

export type RadarView = "wide" | "track";
export type { RadarCar, RadarOverlay } from "../data/radarOverlay";

function creditLink(href: string, text: string): HTMLAnchorElement {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", text }) as HTMLAnchorElement;
}

export type RadarPlayer = {
  root: HTMLElement;
  setRainViewer: (frames: RainViewerFrame[], lat: number, lon: number) => void;
  setIem: (times: number[], lat: number, lon: number) => void;
  setOverlay: (overlay: RadarOverlay | null, note?: string | null) => void;
  setEmpty: (message: string, kind?: "none" | "loading") => void;
  pause: () => void;
  destroy: () => void;
};

export function mountRadarPlayer(): RadarPlayer {
  const root = el("div", { class: "wx-radar", "data-radar-playing": "false" });
  const stack = el("div", { class: "wx-radar-stack" });
  const pin = el("div", { class: "wx-pin", title: "Circuit" });
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.classList.add("wx-radar-overlay");
  overlay.setAttribute("viewBox", "0 0 100 100");
  overlay.setAttribute("preserveAspectRatio", "none");
  overlay.setAttribute("aria-hidden", "true");
  const scene = el("div", { class: "wx-radar-scene" }, [stack, overlay, pin]);
  const map = el("div", { class: "wx-radar-map" }, [scene]);
  const playBtn = el("button", { type: "button", class: "wx-radar-btn", "data-radar-play": "play", text: "Play" });
  const speed1 = el("button", { type: "button", class: "wx-radar-btn on", "data-radar-speed": "1", "aria-pressed": "true", text: "1x" });
  const speed2 = el("button", { type: "button", class: "wx-radar-btn", "data-radar-speed": "2", "aria-pressed": "false", text: "2x" });
  const wideBtn = el("button", { type: "button", class: "wx-radar-btn on", "data-radar-view": "wide", "aria-pressed": "true", text: "Wide" });
  const trackBtn = el("button", { type: "button", class: "wx-radar-btn", "data-radar-view": "track", "aria-pressed": "false", text: "Track" });
  const timeEl = el("span", { class: "wx-radar-time", "data-radar-time": "", text: "—" });
  const ctrl = el("div", { class: "wx-radar-ctrl" }, [playBtn, speed1, speed2, wideBtn, trackBtn, timeEl]);
  const overlayNote = el("p", { class: "wx-overlay-note", hidden: "" });
  const meta = el("div", { class: "wx-radar-meta" });
  const scrub = el("input", { type: "range", min: "0", max: "0", value: "0", class: "wx-scrub", "data-radar-scrub": "" }) as HTMLInputElement;
  const startLab = el("span", { "data-radar-start": "", text: "" });
  const endLab = el("span", { "data-radar-end": "", text: "" });
  const scrubRow = el("div", { class: "wx-scrub-row" }, [startLab, scrub, endLab]);
  const scale = el("div", { class: "wx-scale" }, [
    el("span", { text: "Light" }),
    el("i", { class: "wx-scale-bar" }),
    el("span", { text: "Heavy" }),
  ]);
  root.append(map, ctrl, overlayNote, meta, scrubRow, scale);

  let playing = false;
  let speed: RadarSpeed = 1;
  let index = 0;
  let timer: number | null = null;
  let frameTimes: number[] = [];
  let identity = "";
  let layers: HTMLElement[] = [];
  let creditHref = RAINVIEWER_HOME;
  let creditText = RAINVIEWER_CREDIT;
  let ageKind: "rv" | "iem" | "none" = "none";
  let view: RadarView = "wide";
  let lastWin: TileWindow | null = null;
  let lastFrames: RainViewerFrame[] = [];
  let lastLat = 0;
  let lastLon = 0;
  let lastOverlay: RadarOverlay | null = null;
  let lastOverlayNote: string | null = null;

  const rvZoom = () => (view === "track" ? RAINVIEWER_TRACK_ZOOM : RAINVIEWER_ZOOM);

  const setViewButtons = () => {
    wideBtn.classList.toggle("on", view === "wide");
    trackBtn.classList.toggle("on", view === "track");
    wideBtn.setAttribute("aria-pressed", view === "wide" ? "true" : "false");
    trackBtn.setAttribute("aria-pressed", view === "track" ? "true" : "false");
    root.dataset.radarView = view;
  };

  const sceneTransform = (pts: Array<{ x: number; y: number }>) => {
    if (view !== "track" || pts.length < 2) {
      scene.style.transform = "";
      return;
    }
    const box = map.getBoundingClientRect();
    const w = box.width || 1;
    const h = box.height || 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const x = (p.x / 100) * w;
      const y = (p.y / 100) * h;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const bw = Math.max(0.25, maxX - minX);
    const bh = Math.max(0.25, maxY - minY);
    const pad = Math.max(bw, bh) * 0.2;
    const scale = Math.min(w / (bw + pad * 2), h / (bh + pad * 2)) * 0.92;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    scene.style.transform = `translate(${w / 2 - cx * scale}px, ${h / 2 - cy * scale}px) scale(${scale})`;
  };

  const paintOverlay = (data: RadarOverlay | null, note: string | null) => {
    lastOverlay = data;
    lastOverlayNote = note;
    overlay.replaceChildren();
    overlay.removeAttribute("title");
    delete overlay.dataset.fit;
    if (!data || !lastWin) {
      root.dataset.radarOverlay = "off";
      overlayNote.textContent = note ?? "";
      overlayNote.hidden = !note;
      scene.style.transform = "";
      return;
    }
    root.dataset.radarOverlay = "on";
    overlayNote.textContent = note ?? "";
    overlayNote.hidden = !note;
    overlay.dataset.fit = data.fitLabel;
    overlay.setAttribute("title", data.fitLabel);
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tip.textContent = data.fitLabel;
    overlay.append(tip);
    const pts = data.outline.map(([lon, lat]) => lngLatToMosaicPct(lat, lon, lastWin!));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const span = Math.max(0.04, Math.min(maxX - minX, maxY - minY));
    const strokeW = span * 0.035;
    const carR = span * 0.045;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "wx-radar-outline");
    path.setAttribute("data-radar-outline", "");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", strokeW.toFixed(4));
    path.setAttribute(
      "d",
      pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(" ") + " Z",
    );
    overlay.append(path);
    for (const car of data.cars) {
      const p = lngLatToMosaicPct(car.lat, car.lon, lastWin);
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("data-radar-car", String(car.n));
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", p.x.toFixed(3));
      c.setAttribute("cy", p.y.toFixed(3));
      c.setAttribute("r", carR.toFixed(4));
      c.setAttribute("fill", car.color);
      c.setAttribute("stroke", "#f8fafc");
      c.setAttribute("stroke-width", (carR * 0.35).toFixed(4));
      g.append(c);
      if (view === "track") {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", (p.x + carR * 1.6).toFixed(3));
        t.setAttribute("y", (p.y - carR * 1.1).toFixed(3));
        t.setAttribute("class", "wx-radar-car-lab");
        t.setAttribute("font-size", (span * 0.07).toFixed(3));
        t.textContent = car.code;
        g.append(t);
      }
      overlay.append(g);
    }
    sceneTransform(pts);
  };

  const clearTimer = () => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const show = (i: number) => {
    if (!frameTimes.length) {
      index = 0;
      root.dataset.radarIndex = "0";
      root.dataset.radarPlaying = playing ? "true" : "false";
      timeEl.textContent = "—";
      timeEl.dataset.radarTime = "";
      return;
    }
    index = Math.max(0, Math.min(frameTimes.length - 1, i));
    layers.forEach((node, li) => node.classList.toggle("on", li === index));
    scrub.max = String(frameTimes.length - 1);
    scrub.value = String(index);
    const ms = frameTimes[index];
    const stamp = formatRadarTimestamp(ms);
    timeEl.textContent = stamp;
    timeEl.dataset.radarTime = stamp;
    root.dataset.radarIndex = String(index);
    root.dataset.radarPlaying = playing ? "true" : "false";
    playBtn.textContent = playing ? "Pause" : "Play";
    playBtn.dataset.radarPlay = playing ? "pause" : "play";
    playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
    const kids: Array<Node | string> = [];
    if (ageKind === "rv") {
      const ageMin = Math.max(0, Math.round((Date.now() - ms) / 60_000));
      kids.push(`Frame age: ${ageMin} min · regional scale, not sector rain`);
    } else if (ageKind === "iem") {
      kids.push("NEXRAD ~5 min frames · US circuits only · loop stays at or before the playhead");
    }
    kids.push(creditLink(creditHref, creditText));
    if (lastOverlay) kids.push(creditLink(F1_CIRCUITS_HOME, F1_CIRCUITS_CREDIT));
    meta.replaceChildren(...kids.map((c) => (typeof c === "string" ? el("span", { text: c }) : c)));
  };

  const schedule = () => {
    clearTimer();
    if (!playing || !root.isConnected || frameTimes.length < 2) return;
    timer = window.setTimeout(() => {
      if (!playing || !root.isConnected) return;
      show(nextRadarIndex(index, frameTimes.length));
      schedule();
    }, frameDelayMs(index, frameTimes.length, speed));
  };

  const pause = () => {
    playing = false;
    clearTimer();
    show(index);
  };

  const play = () => {
    if (frameTimes.length < 2) return;
    playing = true;
    show(playStartIndex(index, frameTimes.length));
    schedule();
  };

  playBtn.addEventListener("click", () => {
    if (playing) pause();
    else play();
  });
  speed1.addEventListener("click", () => {
    speed = 1;
    speed1.classList.add("on");
    speed2.classList.remove("on");
    speed1.setAttribute("aria-pressed", "true");
    speed2.setAttribute("aria-pressed", "false");
    if (playing) schedule();
  });
  speed2.addEventListener("click", () => {
    speed = 2;
    speed2.classList.add("on");
    speed1.classList.remove("on");
    speed2.setAttribute("aria-pressed", "true");
    speed1.setAttribute("aria-pressed", "false");
    if (playing) schedule();
  });
  scrub.addEventListener("input", () => {
    const next = Number(scrub.value);
    playing = false;
    clearTimer();
    show(next);
  });

  const setPin = (leftPct: number, topPct: number) => {
    pin.style.left = `${leftPct}%`;
    pin.style.top = `${topPct}%`;
    pin.hidden = false;
  };

  const applyFrames = (id: string, times: number[], nodes: HTMLElement[], keepMs: number | null) => {
    const first = !identity;
    identity = id;
    frameTimes = times;
    layers = nodes;
    stack.replaceChildren(...nodes);
    if (!times.length) {
      index = 0;
      pause();
      return;
    }
    if (first || keepMs == null) index = times.length - 1;
    else index = nearestRadarIndex(times, keepMs);
    if (playing && times.length > 1) {
      show(index);
      schedule();
    } else {
      pause();
    }
  };

  const api: RadarPlayer = {
    root,
    setRainViewer(frames, lat, lon) {
      lastFrames = frames;
      lastLat = lat;
      lastLon = lon;
      const times = frames.map((f) => f.time * 1000);
      const z = rvZoom();
      const id = `rv:${lat},${lon}:${z}:${times.join(",")}`;
      creditHref = RAINVIEWER_HOME;
      creditText = RAINVIEWER_CREDIT;
      ageKind = "rv";
      startLab.textContent = "2 hours ago";
      endLab.textContent = "Latest";
      wideBtn.hidden = false;
      trackBtn.hidden = false;
      ctrl.hidden = false;
      scrubRow.hidden = false;
      scale.hidden = false;
      map.hidden = false;
      pin.hidden = false;
      setViewButtons();
      if (id === identity) return;
      const keep = frameTimes[index] ?? null;
      const win = radarTileWindow(lat, lon, z, 3);
      lastWin = win;
      const nodes = frames.map((frame) => {
        const mosaic = el("div", { class: "wx-mosaic wx-radar-layer", "data-radar": "rainviewer" });
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
        return mosaic;
      });
      setPin((win.pinX / win.size) * 100, (win.pinY / win.size) * 100);
      applyFrames(id, times, nodes, keep);
    },
    setOverlay(data, note = null) {
      paintOverlay(data, note ?? data?.note ?? null);
    },
    setIem(times, lat, lon) {
      const id = `iem:${lat},${lon}:${times.join(",")}`;
      creditHref = IEM_HOME;
      creditText = IEM_CREDIT;
      ageKind = "iem";
      startLab.textContent = "−60 min";
      endLab.textContent = "Playhead";
      wideBtn.hidden = true;
      trackBtn.hidden = true;
      ctrl.hidden = false;
      scrubRow.hidden = false;
      scale.hidden = false;
      map.hidden = false;
      pin.hidden = false;
      paintOverlay(null, null);
      if (id === identity) return;
      const keep = frameTimes[index] ?? null;
      const nodes = times.map((t) => {
        const img = document.createElement("img");
        img.className = "wx-iem wx-radar-layer";
        img.alt = "IEM NEXRAD replay radar";
        img.decoding = "async";
        img.src = iemWmsUrl(lat, lon, t);
        return img;
      });
      setPin(50, 50);
      applyFrames(id, times, nodes, keep);
    },
    setEmpty(message, kind: "none" | "loading" = "loading") {
      identity = `empty:${kind}:${message}`;
      frameTimes = [];
      layers = [];
      ageKind = "none";
      playing = false;
      clearTimer();
      stack.replaceChildren(el("div", { class: "wx-empty", "data-radar": kind, text: message }));
      pin.hidden = true;
      ctrl.hidden = true;
      scrubRow.hidden = true;
      scale.hidden = true;
      paintOverlay(null, null);
      meta.replaceChildren();
      timeEl.textContent = "—";
      root.dataset.radarPlaying = "false";
      root.dataset.radarIndex = "0";
    },
    pause,
    destroy() {
      playing = false;
      clearTimer();
      identity = "";
      frameTimes = [];
      layers = [];
      lastFrames = [];
      lastOverlay = null;
    },
  };
  const applyView = (next: RadarView) => {
    if (view === next) return;
    view = next;
    setViewButtons();
    if (ageKind === "rv" && lastFrames.length) {
      identity = "";
      api.setRainViewer(lastFrames, lastLat, lastLon);
      paintOverlay(lastOverlay, lastOverlayNote);
    }
  };
  wideBtn.addEventListener("click", () => applyView("wide"));
  trackBtn.addEventListener("click", () => applyView("track"));
  return api;
}
