import { formatDelta, parseTs } from "../lib/time";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { panel } from "../ui/panel";
import { hasDriverSelection, isDriverSelected, selectDriver, setTraceMode, state } from "../state";
import {
  fieldSize,
  playheadLap,
  readRaceTraceYAxis,
  traceSeries,
  traceXMax,
  writeRaceTraceYAxis,
  type GapMode,
  type RaceTraceYAxis,
  type TraceSeries,
} from "../data/raceTrace";

type Layout = {
  series: TraceSeries[];
  xOf: (lap: number) => number;
  yOf: (y: number) => number;
  axis: RaceTraceYAxis;
  w: number;
  h: number;
};

function draw(
  canvas: HTMLCanvasElement,
  axis: RaceTraceYAxis,
  mode: GapMode,
): Layout | null {
  const ctx = canvas.getContext("2d");
  if (!ctx || !state.bundle || !state.snap) return null;
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 560;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const now = state.snap.now ?? state.t;
  const series = traceSeries(state.bundle, {
    axis,
    gapMode: mode,
    refDriver: state.traceDriver,
    hidden: state.hiddenDrivers,
    now,
  });
  const maxLap = traceXMax(state.bundle.session, state.bundle.laps, now);
  const pad = { l: 44, r: 16, t: 22, b: 28 };
  const xOf = (lap: number) => pad.l + (lap / maxLap) * (w - pad.l - pad.r);
  let yOf: (y: number) => number;
  if (axis === "position") {
    const n = fieldSize(series, state.bundle.drivers.length);
    yOf = (p: number) => pad.t + ((p - 1) / Math.max(1, n - 1)) * (h - pad.t - pad.b);
    ctx.strokeStyle = "#1c2436";
    ctx.fillStyle = "#8b93a7";
    ctx.font = "600 11px Titillium Web, sans-serif";
    ctx.textAlign = "right";
    const step = n > 16 ? 2 : 1;
    for (let p = 1; p <= n; p += step) {
      const y = yOf(p);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(`P${p}`, pad.l - 6, y + 4);
    }
    ctx.textAlign = "left";
    ctx.fillText("Position", 8, 14);
  } else {
    const ys = series.flatMap((s) => s.pts.map((p) => p.y));
    const minY = Math.min(-2, ...ys);
    const maxY = Math.max(2, ...ys);
    yOf = (y: number) => pad.t + ((y - minY) / (maxY - minY)) * (h - pad.t - pad.b);
    ctx.strokeStyle = "#2a3144";
    ctx.beginPath();
    ctx.moveTo(pad.l, yOf(0));
    ctx.lineTo(w - pad.r, yOf(0));
    ctx.stroke();
    ctx.fillStyle = "#8b93a7";
    ctx.font = "11px Titillium Web, sans-serif";
    ctx.fillText(mode === "average" ? "Δ to average (s)" : mode === "driver" ? "Δ to driver (s)" : "Gap to leader (s)", 8, 14);
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "600 11px Titillium Web, sans-serif";
  ctx.textAlign = "center";
  const xStep = maxLap > 40 ? 10 : maxLap > 20 ? 5 : 2;
  for (let lap = 0; lap <= maxLap; lap += xStep) {
    ctx.fillText(String(lap), xOf(lap), h - 8);
  }
  ctx.textAlign = "left";

  for (const band of state.snap.scBands) {
    const lapStart = state.bundle.laps.find((l) => Math.abs(parseTs(l.date_start) - band.start) < 20000)?.lap_number ?? 1;
    const lapEnd = state.bundle.laps.find((l) => Math.abs(parseTs(l.date_start) - band.end) < 20000)?.lap_number ?? lapStart + 1;
    ctx.fillStyle = band.kind === "VSC" ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.22)";
    ctx.fillRect(xOf(lapStart), pad.t, Math.max(2, xOf(lapEnd) - xOf(lapStart)), h - pad.t - pad.b);
    ctx.fillStyle = "#eab308";
    ctx.font = "11px Titillium Web, sans-serif";
    ctx.fillText(band.kind, xOf(lapStart) + 4, pad.t + 12);
  }

  const dim = hasDriverSelection();
  for (const s of series) {
    const on = isDriverSelected(s.driver);
    ctx.globalAlpha = dim && !on ? 0.18 : 1;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = on ? 2.6 : 1.4;
    ctx.beginPath();
    s.pts.forEach((p, i) => {
      const x = xOf(p.lap);
      const y = yOf(p.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    for (const p of s.pts.filter((p) => p.pit)) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(xOf(p.lap), yOf(p.y), on ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const head = playheadLap(state.bundle.laps, now);
  if (head > 0) {
    const cx = xOf(head);
    ctx.strokeStyle = "#e8edf7";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, pad.t);
    ctx.lineTo(cx, h - pad.b);
    ctx.stroke();
  }

  return { series, xOf, yOf, axis, w, h };
}

export function mountRaceTrace(parent: HTMLElement): { update: () => void } {
  const chart = panel("Race trace  ·  pit markers  ·  SC / VSC bands");
  const side = panel("Projection");
  const canvas = el("canvas", { class: "chart", "data-trace-chart": "1" }) as HTMLCanvasElement;
  canvas.setAttribute("aria-hidden", "true");
  const wrap = el("div", { class: "chart-wrap" });
  const tip = el("div", { class: "trace-tip", hidden: "" });
  wrap.append(canvas, tip);
  chart.body.append(wrap);

  let axis: RaceTraceYAxis = readRaceTraceYAxis();
  let layout: Layout | null = null;

  const kind = el("div", { class: "drivers y-axis-kind" });
  const kindBtns = new Map<RaceTraceYAxis, HTMLButtonElement>();
  for (const [id, label] of [
    ["gap", "Gap"],
    ["position", "Position"],
  ] as const) {
    const b = el("button", { type: "button", text: label, "data-y-axis": id }) as HTMLButtonElement;
    b.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      axis = id;
      writeRaceTraceYAxis(id);
      update();
    });
    kind.append(b);
    kindBtns.set(id, b);
  }

  const modes = el("div", { class: "drivers y-axis" });
  const modeBtns = new Map<GapMode, HTMLButtonElement>();
  for (const [id, label] of [
    ["leader", "Gap to leader"],
    ["average", "Delta to average"],
    ["driver", "Delta to driver"],
  ] as const) {
    const b = el("button", {
      type: "button",
      class: "",
      text: label,
      "data-trace-mode": id,
    }) as HTMLButtonElement;
    b.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setTraceMode(id);
    });
    modes.append(b);
    modeBtns.set(id, b);
  }
  const refWrap = el("div", { class: "trace-ref" });
  refWrap.hidden = true;
  const refBtn = el("button", {
    type: "button",
    class: "trace-ref-btn",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-label": "Reference driver",
  }) as HTMLButtonElement;
  const refList = el("div", { class: "trace-ref-list", role: "listbox", "aria-label": "Reference driver" });
  refList.hidden = true;
  refWrap.append(refBtn, refList);

  let refOpen = false;
  const setRefOpen = (open: boolean) => {
    refOpen = open && !refWrap.hidden;
    refList.hidden = !refOpen;
    refBtn.setAttribute("aria-expanded", refOpen ? "true" : "false");
    refWrap.classList.toggle("open", refOpen);
  };
  refBtn.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setRefOpen(!refOpen);
  });
  document.addEventListener("pointerdown", (ev) => {
    if (!refOpen) return;
    if (refWrap.contains(ev.target as Node)) return;
    setRefOpen(false);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && refOpen) setRefOpen(false);
  });

  const toggles = el("div", { class: "drivers trace-drivers" });
  let driverKey = "";
  let refKey = "";

  const syncDrivers = () => {
    const list = state.bundle?.drivers ?? [];
    const key = list.map((d) => d.driver_number).join(",");
    if (key !== driverKey) {
      driverKey = key;
      toggles.replaceChildren();
      for (const d of list) {
        const b = el("button", {
          type: "button",
          class: "on",
          text: d.name_acronym,
          "data-driver": String(d.driver_number),
        }) as HTMLButtonElement;
        b.style.borderColor = teamColor(d.team_colour);
        b.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.altKey) {
            const i = state.hiddenDrivers.indexOf(d.driver_number);
            if (i >= 0) state.hiddenDrivers.splice(i, 1);
            else state.hiddenDrivers.push(d.driver_number);
            syncDriverLooks();
            requestAnimationFrame(() => {
              layout = draw(canvas, axis, state.traceMode);
            });
            return;
          }
          selectDriver(d.driver_number, ev);
        });
        toggles.append(b);
      }
    }
    syncDriverLooks();
  };

  const syncDriverLooks = () => {
    const hidden = new Set(state.hiddenDrivers);
    for (const b of toggles.querySelectorAll<HTMLButtonElement>("button[data-driver]")) {
      const n = Number(b.getAttribute("data-driver"));
      const on = !hidden.has(n);
      const sel = isDriverSelected(n);
      b.classList.toggle("on", on);
      b.classList.toggle("sel", sel);
      b.style.outline = sel ? "1px solid #fde68a" : "";
    }
    const drivers = state.bundle?.drivers ?? [];
    const nextRef = drivers.map((d) => d.driver_number).join(",");
    const refId = state.traceDriver ?? drivers[0]?.driver_number ?? null;
    if (nextRef !== refKey) {
      refKey = nextRef;
      refList.replaceChildren();
      for (const d of drivers) {
        const sw = el("span", { class: "swatch" });
        sw.style.background = teamColor(d.team_colour);
        const code = el("span", { class: "trace-ref-code", text: d.name_acronym });
        code.style.color = teamColor(d.team_colour);
        const opt = el("button", {
          type: "button",
          class: "trace-ref-opt",
          role: "option",
          "data-driver": String(d.driver_number),
        }) as HTMLButtonElement;
        opt.append(sw, code);
        opt.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setTraceMode("driver", d.driver_number);
          setRefOpen(false);
        });
        refList.append(opt);
      }
    }
    const chosen = drivers.find((d) => d.driver_number === refId);
    refBtn.replaceChildren();
    if (chosen) {
      const sw = el("span", { class: "swatch" });
      sw.style.background = teamColor(chosen.team_colour);
      const code = el("span", { class: "trace-ref-code", text: chosen.name_acronym });
      code.style.color = teamColor(chosen.team_colour);
      refBtn.append(sw, code, el("span", { class: "trace-ref-caret", text: "▾" }));
    } else {
      refBtn.append(el("span", { class: "trace-ref-code", text: "—" }));
    }
    for (const opt of refList.querySelectorAll<HTMLButtonElement>(".trace-ref-opt")) {
      const on = Number(opt.getAttribute("data-driver")) === refId;
      opt.classList.toggle("sel", on);
      opt.setAttribute("aria-selected", on ? "true" : "false");
    }
    refWrap.hidden = axis !== "gap" || state.traceMode !== "driver";
    if (refWrap.hidden) setRefOpen(false);
  };

  const syncModes = () => {
    for (const [id, b] of kindBtns) b.classList.toggle("on", axis === id);
    for (const [id, b] of modeBtns) b.classList.toggle("on", state.traceMode === id);
    modes.hidden = axis !== "gap";
    page.dataset.yAxis = axis;
  };

  const help = el("div", {
    class: "help",
    text: "Click a driver to select (shift-click for several). Alt-click hides a line. Circles mark pit laps. Yellow bands are SC / VSC.",
  });

  side.body.append(
    el("h3", { text: "Y axis" }),
    kind,
    modes,
    refWrap,
    el("h3", { text: "Drivers" }),
    toggles,
    help,
  );
  side.root.classList.add("racetrace-side");
  const page = el("div", { class: "page racetrace", "data-y-axis": axis });
  page.append(chart.root, side.root);
  parent.append(page);

  wrap.addEventListener("pointermove", (ev) => {
    if (!layout) return;
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    let best: { s: TraceSeries; lap: number; y: number; pit: boolean; dist: number } | null = null;
    for (const s of layout.series) {
      if (hasDriverSelection() && !isDriverSelected(s.driver)) continue;
      for (const p of s.pts) {
        const dx = layout.xOf(p.lap) - mx;
        const dy = layout.yOf(p.y) - my;
        const dist = Math.hypot(dx, dy);
        if (!best || dist < best.dist) best = { s, lap: p.lap, y: p.y, pit: p.pit, dist };
      }
    }
    if (!best || best.dist > 16) {
      tip.hidden = true;
      return;
    }
    const value = layout.axis === "position" ? `P${best.y}` : formatDelta(best.y, best.y === 0);
    tip.hidden = false;
    tip.textContent = `${best.s.code}  L${best.lap}  ${value}${best.pit ? "  PIT" : ""}`;
    tip.style.left = `${Math.min(layout.w - 8, Math.max(8, mx + 12))}px`;
    tip.style.top = `${Math.max(8, my - 28)}px`;
  });
  wrap.addEventListener("pointerleave", () => {
    tip.hidden = true;
  });

  const update = () => {
    const issue = !state.snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null;
    chart.setError(issue);
    side.setError(issue);
    help.textContent =
      axis === "position"
        ? "Position at the end of each lap. Lines stop on a retirement. Circles mark pit laps. Cursor follows the playhead."
        : "Click a driver to select (shift-click for several). Alt-click hides a line. Circles mark pit laps. Yellow bands are SC / VSC.";
    syncModes();
    syncDrivers();
    requestAnimationFrame(() => {
      layout = draw(canvas, axis, state.traceMode);
    });
  };
  return { update };
}
