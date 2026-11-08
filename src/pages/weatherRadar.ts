import { IEM_CREDIT, IEM_HOME, iemWmsUrl } from "../data/iemRadar";
import {
  formatRadarTimestamp,
  frameDelayMs,
  nearestRadarIndex,
  nextRadarIndex,
  playStartIndex,
  type RadarSpeed,
} from "../data/radarLoop";
import {
  RADAR_RANGE_15,
  RADAR_RANGE_50,
  RAINVIEWER_MAX_ZOOM,
  radarMosaicFor,
  radarZoomTransform,
  rangeScale,
  readRadarRange,
  scaleBarMiles,
  writeRadarRange,
  type RadarMosaic,
  type RadarRangeMi,
} from "../data/radarRange";
import {
  RAINVIEWER_CREDIT,
  RAINVIEWER_HOME,
  rainViewerTileUrl,
  type RainViewerFrame,
} from "../data/rainViewer";
import { el } from "../lib/dom";

function creditLink(href: string, text: string): HTMLAnchorElement {
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", text }) as HTMLAnchorElement;
}

export type RadarPlayer = {
  root: HTMLElement;
  setRainViewer: (frames: RainViewerFrame[], lat: number, lon: number) => void;
  setIem: (times: number[], lat: number, lon: number) => void;
  setEmpty: (message: string, kind?: "none" | "loading") => void;
  pause: () => void;
  destroy: () => void;
};

export function mountRadarPlayer(): RadarPlayer {
  const root = el("div", { class: "wx-radar", "data-radar-playing": "false" });
  const stack = el("div", { class: "wx-radar-stack" });
  const pin = el("div", { class: "wx-pin", title: "Circuit" });
  const scene = el("div", { class: "wx-radar-scene" }, [stack]);
  const rangeBarTick = el("i");
  const rangeBarLab = el("span", { "data-radar-scalebar-label": "", text: "" });
  const rangeBar = el("div", { class: "wx-range-bar", "data-radar-scalebar": "", hidden: "" }, [rangeBarTick, rangeBarLab]);
  const map = el("div", { class: "wx-radar-map" }, [scene, pin, rangeBar]);
  const playBtn = el("button", { type: "button", class: "wx-radar-btn", "data-radar-play": "play", text: "Play" });
  const speed1 = el("button", { type: "button", class: "wx-radar-btn on", "data-radar-speed": "1", "aria-pressed": "true", text: "1x" });
  const speed2 = el("button", { type: "button", class: "wx-radar-btn", "data-radar-speed": "2", "aria-pressed": "false", text: "2x" });
  const mi50 = el("button", {
    type: "button",
    class: "wx-radar-btn wx-range-btn",
    "data-radar-view": "50",
    text: "50 mi",
  });
  const mi15 = el("button", {
    type: "button",
    class: "wx-radar-btn wx-range-btn",
    "data-radar-view": "15",
    text: "15 mi",
  });
  const timeEl = el("span", { class: "wx-radar-time", "data-radar-time": "", text: "—" });
  const ctrl = el("div", { class: "wx-radar-ctrl" }, [playBtn, speed1, speed2, mi50, mi15, timeEl]);
  const meta = el("div", { class: "wx-radar-meta" });
  const scrub = el("input", { type: "range", min: "0", max: "0", value: "0", class: "wx-scrub", "data-radar-scrub": "" }) as HTMLInputElement;
  const startLab = el("span", { "data-radar-start": "", text: "" });
  const endLab = el("span", { "data-radar-end": "", text: "" });
  const scrubRow = el("div", { class: "wx-scrub-row" }, [startLab, scrub, endLab]);
  const legend = el("div", { class: "wx-scale" }, [
    el("span", { text: "Light" }),
    el("i", { class: "wx-scale-bar" }),
    el("span", { text: "Heavy" }),
  ]);
  root.append(map, ctrl, meta, scrubRow, legend);

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
  let range: RadarRangeMi = readRadarRange();
  let lastWin: RadarMosaic | null = null;
  let lastLat = 0;

  const setRangeButtons = () => {
    mi50.classList.toggle("on", range === RADAR_RANGE_50);
    mi15.classList.toggle("on", range === RADAR_RANGE_15);
    mi50.setAttribute("aria-pressed", range === RADAR_RANGE_50 ? "true" : "false");
    mi15.setAttribute("aria-pressed", range === RADAR_RANGE_15 ? "true" : "false");
    root.dataset.radarView = String(range);
    root.dataset.radarSmooth = range === RADAR_RANGE_15 ? "on" : "off";
  };

  const applyRangeTransform = () => {
    if (ageKind !== "rv" || !lastWin) {
      scene.style.transform = "";
      rangeBar.hidden = true;
      return;
    }
    const box = map.getBoundingClientRect();
    const w = box.width || 1;
    const h = box.height || 1;
    const s = rangeScale(lastLat, range, lastWin.z, lastWin.cols);
    const zoom = radarZoomTransform(w, h, lastWin, s);
    scene.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
    root.dataset.radarScale = s.toFixed(3);
    const barMi = scaleBarMiles(range);
    rangeBarLab.textContent = `${barMi} mi`;
    rangeBarTick.style.width = `${(barMi / range) * 100}%`;
    rangeBar.hidden = false;
    pin.style.left = "50%";
    pin.style.top = "50%";
    pin.hidden = false;
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

  const applyRangeTransformSafe = () => applyRangeTransform();
  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(applyRangeTransformSafe)
      : { observe: () => undefined, disconnect: () => undefined };

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
      lastLat = lat;
      const times = frames.map((f) => f.time * 1000);
      const z = RAINVIEWER_MAX_ZOOM;
      const id = `rv:${lat},${lon}:${z}:${times.join(",")}`;
      creditHref = RAINVIEWER_HOME;
      creditText = RAINVIEWER_CREDIT;
      ageKind = "rv";
      startLab.textContent = "2 hours ago";
      endLab.textContent = "Latest";
      mi50.hidden = false;
      mi15.hidden = false;
      ctrl.hidden = false;
      scrubRow.hidden = false;
      legend.hidden = false;
      map.hidden = false;
      pin.hidden = false;
      setRangeButtons();
      if (id !== identity) {
        const keep = frameTimes[index] ?? null;
        const win = radarMosaicFor(lat, lon, RADAR_RANGE_50, z);
        lastWin = win;
        const n = 2 ** win.z;
        const nodes = frames.map((frame) => {
          const mosaic = el("div", { class: "wx-mosaic wx-radar-layer", "data-radar": "rainviewer" });
          mosaic.style.gridTemplateColumns = `repeat(${win.cols}, minmax(0, 1fr))`;
          mosaic.style.gridTemplateRows = `repeat(${win.rows}, minmax(0, 1fr))`;
          for (let dy = 0; dy < win.rows; dy++) {
            for (let dx = 0; dx < win.cols; dx++) {
              const img = document.createElement("img");
              img.alt = "";
              img.decoding = "async";
              const x = win.x0 + dx;
              img.src = rainViewerTileUrl(frame, win.z, ((x % n) + n) % n, win.y0 + dy);
              mosaic.append(img);
            }
          }
          return mosaic;
        });
        applyFrames(id, times, nodes, keep);
      }
      applyRangeTransform();
    },
    setIem(times, lat, lon) {
      const id = `iem:${lat},${lon}:${times.join(",")}`;
      creditHref = IEM_HOME;
      creditText = IEM_CREDIT;
      ageKind = "iem";
      startLab.textContent = "−60 min";
      endLab.textContent = "Playhead";
      mi50.hidden = true;
      mi15.hidden = true;
      ctrl.hidden = false;
      scrubRow.hidden = false;
      legend.hidden = false;
      map.hidden = false;
      pin.hidden = false;
      lastWin = null;
      scene.style.transform = "";
      rangeBar.hidden = true;
      root.dataset.radarSmooth = "off";
      delete root.dataset.radarView;
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
      pin.style.left = "50%";
      pin.style.top = "50%";
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
      legend.hidden = true;
      rangeBar.hidden = true;
      scene.style.transform = "";
      meta.replaceChildren();
      timeEl.textContent = "—";
      root.dataset.radarPlaying = "false";
      root.dataset.radarIndex = "0";
      root.dataset.radarSmooth = "off";
    },
    pause,
    destroy() {
      playing = false;
      clearTimer();
      identity = "";
      frameTimes = [];
      layers = [];
      ro.disconnect();
    },
  };

  const applyRange = (next: RadarRangeMi) => {
    if (range === next) {
      applyRangeTransform();
      return;
    }
    range = next;
    writeRadarRange(range);
    setRangeButtons();
    applyRangeTransform();
  };
  mi50.addEventListener("click", () => applyRange(RADAR_RANGE_50));
  mi15.addEventListener("click", () => applyRange(RADAR_RANGE_15));

  ro.observe(map);
  setRangeButtons();
  return api;
}
