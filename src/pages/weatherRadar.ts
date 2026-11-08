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
  radarTileWindow,
  RAINVIEWER_CREDIT,
  RAINVIEWER_HOME,
  RAINVIEWER_ZOOM,
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
  const map = el("div", { class: "wx-radar-map" }, [stack, pin]);
  const playBtn = el("button", { type: "button", class: "wx-radar-btn", "data-radar-play": "play", text: "Play" });
  const speed1 = el("button", { type: "button", class: "wx-radar-btn on", "data-radar-speed": "1", "aria-pressed": "true", text: "1x" });
  const speed2 = el("button", { type: "button", class: "wx-radar-btn", "data-radar-speed": "2", "aria-pressed": "false", text: "2x" });
  const timeEl = el("span", { class: "wx-radar-time", "data-radar-time": "", text: "—" });
  const ctrl = el("div", { class: "wx-radar-ctrl" }, [playBtn, speed1, speed2, timeEl]);
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
  root.append(map, ctrl, meta, scrubRow, scale);

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

  return {
    root,
    setRainViewer(frames, lat, lon) {
      const times = frames.map((f) => f.time * 1000);
      const id = `rv:${lat},${lon}:${times.join(",")}`;
      creditHref = RAINVIEWER_HOME;
      creditText = RAINVIEWER_CREDIT;
      ageKind = "rv";
      startLab.textContent = "2 hours ago";
      endLab.textContent = "Latest";
      ctrl.hidden = false;
      scrubRow.hidden = false;
      scale.hidden = false;
      map.hidden = false;
      pin.hidden = false;
      if (id === identity) return;
      const keep = frameTimes[index] ?? null;
      const win = radarTileWindow(lat, lon, RAINVIEWER_ZOOM, 3);
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
    setIem(times, lat, lon) {
      const id = `iem:${lat},${lon}:${times.join(",")}`;
      creditHref = IEM_HOME;
      creditText = IEM_CREDIT;
      ageKind = "iem";
      startLab.textContent = "−60 min";
      endLab.textContent = "Playhead";
      ctrl.hidden = false;
      scrubRow.hidden = false;
      scale.hidden = false;
      map.hidden = false;
      pin.hidden = false;
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
    },
  };
}
