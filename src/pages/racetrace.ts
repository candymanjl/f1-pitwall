import { parseTs } from "../lib/time";
import { teamColor } from "../lib/colors";
import { el } from "../lib/dom";
import { panel } from "../ui/panel";
import { hasDriverSelection, isDriverSelected, selectDriver, setTraceMode, state } from "../state";

type Mode = "leader" | "average" | "driver";

function seriesFor(mode: Mode): { driver: number; code: string; color: string; pts: { lap: number; y: number; pit: boolean }[] }[] {
  const bundle = state.bundle;
  if (!bundle) return [];
  const hidden = new Set(state.hiddenDrivers);
  const byDriver = new Map<number, { lap: number; dur: number; start: number; pit: boolean }[]>();
  for (const lap of bundle.laps) {
    if (!lap.lap_duration || !lap.date_start) continue;
    const list = byDriver.get(lap.driver_number) ?? [];
    const pit = bundle.pits.some((p) => p.driver_number === lap.driver_number && p.lap_number === lap.lap_number);
    list.push({ lap: lap.lap_number, dur: lap.lap_duration, start: parseTs(lap.date_start), pit: pit || !!lap.is_pit_out_lap });
    byDriver.set(lap.driver_number, list);
  }
  const maxLap = Math.max(1, ...bundle.laps.map((l) => l.lap_number));
  const cum = new Map<number, number[]>();
  for (const [dn, laps] of byDriver) {
    laps.sort((a, b) => a.lap - b.lap);
    const arr: number[] = [];
    let t = 0;
    for (let i = 1; i <= maxLap; i++) {
      const hit = laps.find((l) => l.lap === i);
      if (hit) {
        t += hit.dur;
        arr[i] = t;
      } else {
        arr[i] = 0;
      }
    }
    cum.set(dn, arr);
  }
  const avg: number[] = [];
  for (let i = 1; i <= maxLap; i++) {
    const vals = [...cum.values()].map((a) => a[i]).filter((v) => v > 0);
    avg[i] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  const refDriver = state.traceDriver ?? bundle.drivers[0]?.driver_number;
  const out = [];
  for (const d of bundle.drivers) {
    if (hidden.has(d.driver_number)) continue;
    const laps = byDriver.get(d.driver_number) ?? [];
    const c = cum.get(d.driver_number) ?? [];
    const pts = laps
      .filter((l) => (c[l.lap] ?? 0) > 0)
      .map((l) => {
        const mine = c[l.lap];
        let y = 0;
        if (mode === "average") y = mine - (avg[l.lap] ?? 0);
        else if (mode === "driver") {
          const ref = cum.get(refDriver)?.[l.lap] ?? 0;
          y = ref ? mine - ref : 0;
        } else {
          const leaderCum = Math.min(...[...cum.values()].map((a) => a[l.lap] || Infinity));
          y = mine - leaderCum;
        }
        return { lap: l.lap, y, pit: l.pit };
      });
    out.push({ driver: d.driver_number, code: d.name_acronym, color: teamColor(d.team_colour), pts });
  }
  return out;
}

function draw(canvas: HTMLCanvasElement, mode: Mode): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !state.bundle || !state.snap) return;
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 560;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const data = seriesFor(mode);
  const maxLap = Math.max(10, ...data.flatMap((s) => s.pts.map((p) => p.lap)));
  const ys = data.flatMap((s) => s.pts.map((p) => p.y));
  const minY = Math.min(-2, ...ys);
  const maxY = Math.max(2, ...ys);
  const pad = { l: 48, r: 16, t: 16, b: 28 };
  const xOf = (lap: number) => pad.l + (lap / maxLap) * (w - pad.l - pad.r);
  const yOf = (y: number) => pad.t + ((y - minY) / (maxY - minY)) * (h - pad.t - pad.b);

  const start = parseTs(state.bundle.session.date_start);
  for (const band of state.snap.scBands) {
    const lapStart = state.bundle.laps.find((l) => Math.abs(parseTs(l.date_start) - band.start) < 20000)?.lap_number ?? 1;
    const lapEnd = state.bundle.laps.find((l) => Math.abs(parseTs(l.date_start) - band.end) < 20000)?.lap_number ?? lapStart + 1;
    ctx.fillStyle = band.kind === "VSC" ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.22)";
    ctx.fillRect(xOf(lapStart), pad.t, xOf(lapEnd) - xOf(lapStart), h - pad.t - pad.b);
    ctx.fillStyle = "#eab308";
    ctx.font = "11px Titillium Web";
    ctx.fillText(band.kind, xOf(lapStart) + 4, pad.t + 12);
  }
  void start;

  ctx.strokeStyle = "#2a3144";
  ctx.beginPath();
  ctx.moveTo(pad.l, yOf(0));
  ctx.lineTo(w - pad.r, yOf(0));
  ctx.stroke();
  ctx.fillStyle = "#8b93a7";
  ctx.font = "11px Titillium Web";
  ctx.fillText(mode === "average" ? "Δ to average (s)" : mode === "driver" ? "Δ to driver (s)" : "Gap to leader (s)", 8, 14);

  const dim = hasDriverSelection();
  for (const s of data) {
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
}

export function mountRaceTrace(parent: HTMLElement): { update: () => void } {
  const chart = panel("Race trace  ·  pit markers  ·  SC / VSC bands");
  const side = panel("Projection");
  const canvas = el("canvas", { class: "chart" }) as HTMLCanvasElement;
  const wrap = el("div", { class: "chart-wrap" });
  wrap.append(canvas);
  chart.body.append(wrap);
  const page = el("div", { class: "page racetrace" }, [chart.root, side.root]);
  parent.append(page);

  const update = () => {
    const issue = !state.snap && !state.lock ? state.error || (state.loading ? null : "No session data loaded.") : null;
    chart.setError(issue);
    side.setError(issue);
    const modes = el("div", { class: "drivers" });
    for (const [id, label] of [
      ["leader", "Gap to leader"],
      ["average", "Delta to average"],
      ["driver", "Delta to driver"],
    ] as const) {
      const b = el("button", { class: state.traceMode === id ? "on" : "", text: label });
      b.onclick = () => {
        setTraceMode(id);
        update();
      };
      modes.append(b);
    }
    if (state.traceMode === "driver" && state.bundle) {
      const sel = el("select") as HTMLSelectElement;
      for (const d of state.bundle.drivers) {
        const o = el("option", { value: String(d.driver_number), text: d.name_acronym }) as HTMLOptionElement;
        if (d.driver_number === state.traceDriver) o.selected = true;
        sel.append(o);
      }
      sel.onchange = () => {
        setTraceMode("driver", Number(sel.value));
        update();
      };
      modes.append(sel);
    }
    const toggles = el("div", { class: "drivers" });
    const hidden = state.hiddenDrivers;
    for (const d of state.bundle?.drivers ?? []) {
      const on = !hidden.includes(d.driver_number);
      const sel = isDriverSelected(d.driver_number);
      const b = el("button", { class: `${on ? "on" : ""} ${sel ? "sel" : ""}`.trim(), text: d.name_acronym });
      b.style.borderColor = teamColor(d.team_colour);
      if (sel) b.style.outline = "1px solid #fde68a";
      b.onclick = (ev) => {
        if (ev.altKey) {
          const i = hidden.indexOf(d.driver_number);
          if (i >= 0) hidden.splice(i, 1);
          else hidden.push(d.driver_number);
          update();
          return;
        }
        selectDriver(d.driver_number, ev);
      };
      toggles.append(b);
    }
    side.body.replaceChildren(
      el("h3", { text: "Y axis" }),
      modes,
      el("h3", { text: "Drivers" }),
      toggles,
      el("div", { class: "help", text: "Click a driver to select (shift-click for several). Alt-click hides a line. Circles mark pit laps. Yellow bands are SC / VSC." }),
    );
    requestAnimationFrame(() => draw(canvas, state.traceMode));
  };
  return { update };
}

