import { apiGet } from "../data/client";
import { isLiveLock } from "../data/errors";
import { estimateSetsLeft, strategyBrief } from "../data/strategy";
import {
  COMPOUNDS,
  buildStopPlans,
  compoundLetter,
  crossoverMarks,
  cumulativeStintLoss,
  editTyreModel,
  fitLapsFromSession,
  fitTyreModel,
  formatCrossovers,
  predictedLapTime,
  readTyreStore,
  resetTyreStore,
  writeTyreStore,
  type ActualDot,
  type CompoundId,
  type TyreModel,
  type TyreStore,
} from "../data/tyres";
import type { Interval, Lap, Pit, RaceControl, Session, Stint } from "../data/types";
import { tyreColor } from "../lib/colors";
import { el } from "../lib/dom";
import { clamp, formatLap, formatSector, parseTs } from "../lib/time";
import { panel } from "../ui/panel";
import { state } from "../state";
import { project } from "../data/track";

const show: Record<CompoundId, boolean> = {
  SOFT: true,
  MEDIUM: true,
  HARD: true,
  INTERMEDIATE: false,
  WET: false,
};

type Field = {
  range: HTMLInputElement;
  num: HTMLInputElement;
  digits: number;
  read: (model: TyreModel) => number;
};

export function mountTyres(parent: HTMLElement): { update: () => void } {
  const fields: Field[] = [];
  const toggles = el("div", { class: "cmp-toggles" });
  for (const id of COMPOUNDS) {
    const btn = el("button", { type: "button", class: show[id] ? "on" : "", text: compoundLetter(id) });
    btn.style.color = tyreColor(id);
    btn.title = id;
    btn.onclick = () => {
      show[id] = !show[id];
      btn.classList.toggle("on", show[id]);
      paint();
    };
    toggles.append(btn);
  }

  const modelP = panel("Compound model", "tyre-model");
  const chartP = panel("Degradation", "tyre-charts", toggles);
  const feedP = panel("What this feeds", "tyre-feed");
  const controls = el("div", { class: "tyre-controls" });
  const fitSelect = el("select") as HTMLSelectElement;
  const fitSummary = el("div", { class: "tyre-summary" });
  const fitStatus = el("div", { class: "fit-status" });
  const pracBtn = el("button", { type: "button", class: "primary", text: "Fit from practice long runs" });
  const raceBtn = el("button", { type: "button", class: "race", text: "Fit from race so far" });
  const resetBtn = el("button", { type: "button", class: "ghost", text: "Reset to defaults" });

  const globals = el("div", { class: "tyre-globals" });
  globals.append(fitSummary);
  addSlider(globals, fields, "Base lap", "s", 60, 120, 0.01, 3, "#e8edf7", (m) => m.baseLap, (m, v) => {
    m.baseLap = v;
  });
  addSlider(globals, fields, "Fuel gain", "s/lap", 0, 0.08, 0.001, 3, "#7dd3fc", (m) => m.fuelPerLap, (m, v) => {
    m.fuelPerLap = v;
  });

  controls.append(
    el("div", { class: "fit-from" }, [el("label", { text: "Fit data from" }), fitSelect]),
    globals,
  );
  for (const id of COMPOUNDS) controls.append(compoundCard(id, fields));
  if (COMPOUNDS.indexOf("INTERMEDIATE") === 3) {
    const wet = el("div", { class: "wet-label", text: "Wet compounds" });
    controls.insertBefore(wet, controls.querySelector('[data-compound="INTERMEDIATE"]'));
  }
  const dock = el("div", { class: "tyre-dock" }, [
    el("div", { class: "tyre-actions" }, [pracBtn, raceBtn, resetBtn]),
    el("p", {
      class: "help formula",
      text: "Lap = base + offset + deg × age + cliff × laps past cliff − fuel × race lap. Linear ignores the cliff. Grip fades across the useful life.",
    }),
    fitStatus,
  ]);
  modelP.body.classList.add("tyre-model-body");
  modelP.body.append(controls, dock);

  const lapCanvas = el("canvas", { class: "tyre-canvas" }) as HTMLCanvasElement;
  const cumCanvas = el("canvas", { class: "tyre-canvas" }) as HTMLCanvasElement;
  const lapWrap = el("div", { class: "tyre-chart" }, [lapCanvas]);
  const cumWrap = el("div", { class: "tyre-chart" }, [cumCanvas]);
  chartP.body.classList.add("tyre-chart-body");
  chartP.body.append(lapWrap, cumWrap);

  const strip = el("div", { class: "tyre-strip" });
  const page = el("div", { class: "page tyres" }, [modelP.root, chartP.root, feedP.root, strip]);
  parent.append(page);
  requestAnimationFrame(() => paint());

  let sessionSig = "";
  let fitting = false;

  fitSelect.onchange = () => {
    syncFitButtons();
  };
  pracBtn.onclick = () => void runFit("practice");
  raceBtn.onclick = () => void runFit("race");
  resetBtn.onclick = () => {
    resetTyreStore();
    fitStatus.textContent = "Reset to the default Mexico-like model.";
    refresh();
  };

  function refresh() {
    syncFields();
    paint();
  }

  function syncFields() {
    const store = readTyreStore();
    for (const field of fields) {
      const value = field.read(store.model);
      if (document.activeElement !== field.range) field.range.value = String(value);
      if (document.activeElement !== field.num) field.num.value = value.toFixed(field.digits);
    }
    fitSummary.textContent = `base ${formatLap(store.model.baseLap)} · fuel −${store.model.fuelPerLap.toFixed(3)} s/lap`;
    for (const id of COMPOUNDS) {
      const card = controls.querySelector(`[data-compound="${id}"]`);
      if (!card) continue;
      const shape = store.model.compounds[id].shape;
      card.classList.toggle("is-linear", shape === "linear");
      for (const btn of card.querySelectorAll("button[data-shape]")) {
        btn.classList.toggle("on", btn.getAttribute("data-shape") === `${id}:${shape}`);
      }
      const q = card.querySelector(".fitq");
      if (q) q.textContent = qualityText(store, id);
    }
  }

  function paint() {
    const store = readTyreStore();
    const visible = COMPOUNDS.filter((id) => show[id]);
    drawLapChart(lapCanvas, store.model, visible, store.fit?.dots ?? []);
    drawLossChart(cumCanvas, store.model, visible);
    renderFeed(feedP.body, store);
    renderStrip(strip);
  }

  function syncSessions() {
    const sessions = state.bundle?.weekendSessions ?? [];
    const sig = sessions.map((s) => s.session_key).join(",");
    if (sig !== sessionSig) {
      sessionSig = sig;
      fitSelect.replaceChildren();
      for (const session of sessions) {
        fitSelect.append(el("option", { value: String(session.session_key), text: sessionLabel(session) }));
      }
      const fp2 =
        sessions.find((s) => /practice 2/i.test(s.session_name)) ??
        sessions.find((s) => /practice/i.test(s.session_name)) ??
        sessions[0];
      if (fp2) fitSelect.value = String(fp2.session_key);
    }
    syncFitButtons();
  }

  function syncFitButtons() {
    const selected = selectedSession();
    pracBtn.textContent = `Fit from ${selected?.session_name ?? "practice"} long runs`;
    const race = raceSession();
    raceBtn.disabled = !race;
    raceBtn.textContent = race ? "Fit from race so far" : "No race session";
  }

  function selectedSession(): Session | null {
    const key = Number(fitSelect.value);
    return state.bundle?.weekendSessions.find((s) => s.session_key === key) ?? null;
  }

  function raceSession(): Session | null {
    const sessions = state.bundle?.weekendSessions ?? [];
    return (
      sessions.find((s) => s.session_name === "Race") ??
      sessions.find((s) => /sprint/i.test(s.session_name) && !/qualifying/i.test(s.session_name)) ??
      null
    );
  }

  async function runFit(mode: "practice" | "race") {
    if (fitting) return;
    const bundle = state.bundle;
    if (!bundle) {
      fitStatus.textContent = "Load a session first, then fit.";
      return;
    }
    const session = mode === "race" ? raceSession() : selectedSession();
    if (!session) {
      fitStatus.textContent = mode === "race" ? "This weekend has no race session." : "Pick a session to fit.";
      return;
    }
    fitting = true;
    pracBtn.disabled = true;
    raceBtn.disabled = true;
    fitStatus.textContent = `Fitting ${session.session_name}…`;
    try {
      const rows = await loadFitRows(session);
      const until =
        mode === "race" && session.session_key === bundle.session.session_key ? state.t : undefined;
      const result = fitTyreModel(rows, readTyreStore().model, {
        mode,
        untilMs: until,
        label: session.session_name,
        sessionKey: session.session_key,
      });
      if (!Object.keys(result.fit.quality).length) {
        fitStatus.textContent =
          mode === "practice"
            ? "No long run found. A practice fit needs 6 clean laps on one compound, with in/out laps, SC/VSC, and traffic removed."
            : "Not enough clean laps to fit yet. In/out laps, SC/VSC, and traffic are removed.";
        return;
      }
      writeTyreStore({ model: result.model, fit: result.fit });
      for (const id of COMPOUNDS) {
        if (result.fit.quality[id]) show[id] = true;
      }
      for (const btn of toggles.querySelectorAll("button")) {
        const id = COMPOUNDS.find((compound) => compoundLetter(compound) === btn.textContent);
        if (id) btn.classList.toggle("on", show[id]);
      }
      const q = result.fit;
      fitStatus.textContent = `${q.label} · ${q.used} clean laps · excluded ${q.excludedInOut} in/out · ${q.excludedSc} SC/VSC · ${q.excludedTraffic} traffic`;
      refresh();
    } catch (err) {
      fitStatus.textContent = isLiveLock(err)
        ? "OpenF1 is locked during the live session. Sign in under Settings, or fit after the session."
        : err instanceof Error
          ? err.message
          : "Fit failed.";
    } finally {
      fitting = false;
      pracBtn.disabled = false;
      syncFitButtons();
    }
  }

  return {
    update: () => {
      const issue = !state.snap && !state.lock ? state.error || (state.loading ? null : null) : null;
      modelP.setError(issue);
      syncSessions();
      syncFields();
      paint();
    },
  };
}

function sessionLabel(session: Session): string {
  const place = session.country_name || session.location || "";
  return place ? `${session.year} ${place} · ${session.session_name}` : session.session_name;
}

function qualityText(store: TyreStore, id: CompoundId): string {
  const q = store.fit?.quality[id];
  if (q && !store.fit?.edited) return `R² ${q.r2.toFixed(2)} · ${q.n} laps`;
  if (store.fit?.edited) return "edited";
  return "default";
}

function addSlider(
  parent: HTMLElement,
  fields: Field[],
  label: string,
  unit: string,
  min: number,
  max: number,
  step: number,
  digits: number,
  color: string,
  read: (model: TyreModel) => number,
  write: (model: TyreModel, value: number) => void,
): void {
  const range = el("input", { type: "range", min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  range.style.accentColor = color;
  const num = el("input", { type: "number", min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  const push = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    editTyreModel((model) => write(model, clamp(raw, min, max)));
    syncAfterEdit();
  };
  range.addEventListener("input", () => push(Number(range.value)));
  num.addEventListener("change", () => push(Number(num.value)));
  fields.push({ range, num, digits, read });
  parent.append(
    el("div", { class: "slide-row" }, [
      el("span", { class: "slide-label", text: label }),
      range,
      num,
      el("span", { class: "slide-unit", text: unit }),
    ]),
  );

  function syncAfterEdit() {
    const root = parent.closest(".tyre-controls");
    const store = readTyreStore();
    for (const field of fields) {
      const value = field.read(store.model);
      if (document.activeElement !== field.range) field.range.value = String(value);
      if (document.activeElement !== field.num) field.num.value = value.toFixed(field.digits);
    }
    const summary = root?.querySelector(".tyre-summary");
    if (summary) summary.textContent = `base ${formatLap(store.model.baseLap)} · fuel −${store.model.fuelPerLap.toFixed(3)} s/lap`;
    for (const id of COMPOUNDS) {
      const card = root?.querySelector(`[data-compound="${id}"]`);
      const q = card?.querySelector(".fitq");
      if (q) q.textContent = qualityText(store, id);
      card?.classList.toggle("is-linear", store.model.compounds[id].shape === "linear");
    }
    const page = parent.closest(".page.tyres");
    const canvases = page?.querySelectorAll("canvas.tyre-canvas");
    if (canvases && canvases.length >= 2) {
      const visible = COMPOUNDS.filter((id) => show[id]);
      drawLapChart(canvases[0] as HTMLCanvasElement, store.model, visible, store.fit?.dots ?? []);
      drawLossChart(canvases[1] as HTMLCanvasElement, store.model, visible);
    }
    const feed = page?.querySelector(".tyre-feed .panel-b");
    if (feed instanceof HTMLElement) renderFeed(feed, store);
  }
}

function compoundCard(id: CompoundId, fields: Field[]): HTMLElement {
  const color = tyreColor(id);
  const card = el("section", { class: "cmp", "data-compound": id });
  card.style.borderLeftColor = color;
  const dot = el("span", { class: "tyre", text: compoundLetter(id) });
  dot.style.color = color;
  const linear = el("button", { type: "button", "data-shape": `${id}:linear`, text: "Linear fade" });
  const cliff = el("button", { type: "button", "data-shape": `${id}:cliff`, text: "Cliff" });
  const pick = (shape: "linear" | "cliff") => {
    editTyreModel((model) => {
      model.compounds[id].shape = shape;
    });
    card.classList.toggle("is-linear", shape === "linear");
    linear.classList.toggle("on", shape === "linear");
    cliff.classList.toggle("on", shape === "cliff");
    const page = card.closest(".page.tyres");
    const feed = page?.querySelector(".tyre-feed .panel-b");
    const store = readTyreStore();
    const q = card.querySelector(".fitq");
    if (q) q.textContent = qualityText(store, id);
    const canvases = page?.querySelectorAll("canvas.tyre-canvas");
    if (canvases && canvases.length >= 2) {
      const visible = COMPOUNDS.filter((compound) => show[compound]);
      drawLapChart(canvases[0] as HTMLCanvasElement, store.model, visible, store.fit?.dots ?? []);
      drawLossChart(canvases[1] as HTMLCanvasElement, store.model, visible);
    }
    if (feed instanceof HTMLElement) renderFeed(feed, store);
  };
  linear.onclick = () => pick("linear");
  cliff.onclick = () => pick("cliff");
  card.append(
    el("div", { class: "cmp-h" }, [
      dot,
      el("strong", { text: id }),
      el("span", { class: "fitq", text: "default" }),
    ]),
    el("div", { class: "shape-row" }, [linear, cliff]),
  );
  addSlider(card, fields, "Pace offset", "s vs Soft", -1, 20, 0.01, 2, color, (m) => m.compounds[id].offset, (m, v) => {
    m.compounds[id].offset = v;
  });
  addSlider(card, fields, "Deg per lap", "s/lap", 0, 0.5, 0.001, 3, color, (m) => m.compounds[id].degPerLap, (m, v) => {
    m.compounds[id].degPerLap = v;
  });
  const cliffLap = el("div", { class: "cliff-row" });
  const cliffDeg = el("div", { class: "cliff-row" });
  card.append(cliffLap, cliffDeg);
  addSlider(cliffLap, fields, "Cliff lap", "stint lap", 1, 60, 1, 0, color, (m) => m.compounds[id].cliffLap, (m, v) => {
    m.compounds[id].cliffLap = Math.round(v);
  });
  addSlider(cliffDeg, fields, "Cliff deg", "s/lap after", 0, 1.5, 0.01, 2, color, (m) => m.compounds[id].cliffDeg, (m, v) => {
    m.compounds[id].cliffDeg = v;
  });
  addSlider(card, fields, "Max useful stint", "laps", 4, 60, 1, 0, color, (m) => m.compounds[id].lifespan, (m, v) => {
    m.compounds[id].lifespan = Math.round(v);
  });
  return card;
}

async function loadFitRows(session: Session) {
  const bundle = state.bundle;
  if (bundle && bundle.session.session_key === session.session_key) {
    return fitLapsFromSession({
      laps: bundle.laps,
      stints: bundle.stints,
      pits: bundle.pits,
      raceControl: bundle.raceControl,
      intervals: bundle.intervals,
      sessionEnd: parseTs(session.date_end),
    });
  }
  const [laps, stints, pits, raceControl, intervals] = await Promise.all([
    apiGet<Lap[]>("laps", { session_key: session.session_key }),
    apiGet<Stint[]>("stints", { session_key: session.session_key }),
    apiGet<Pit[]>("pit", { session_key: session.session_key }),
    apiGet<RaceControl[]>("race_control", { session_key: session.session_key }),
    apiGet<Interval[]>("intervals", { session_key: session.session_key }).catch(() => [] as Interval[]),
  ]);
  return fitLapsFromSession({
    laps,
    stints,
    pits,
    raceControl,
    intervals,
    sessionEnd: parseTs(session.date_end),
  });
}

function renderFeed(host: HTMLElement, store: TyreStore): void {
  const bundle = state.bundle;
  const snap = state.snap;
  const loss = state.pitLoss[state.pitMode];
  const marks = crossoverMarks(store.model, ["SOFT", "MEDIUM", "HARD"]);
  host.replaceChildren();
  const head = el("div", { class: "feed-head" });
  head.append(el("div", { class: "legend", text: "Strategy page re-ranks pits from this model" }));

  let plans: { stops: number; finish: string; stints: { compound: string; laps: number }[] }[] = [];
  let windows = formatCrossovers(marks);
  let rule = "Dry race: each plan must use at least two different dry compounds.";
  let title = `Example · 71 laps · pit loss ${loss.toFixed(1)}s`;

  if (bundle && snap && snap.rows.length) {
    const dn = state.selectedDriver ?? snap.rows[0].driver.driver_number;
    const row = snap.rows.find((r) => r.driver.driver_number === dn) ?? snap.rows[0];
    const brief = strategyBrief(bundle, snap, row.driver.driver_number, loss);
    plans = brief.plans;
    windows = brief.windows;
    rule = brief.rule;
    const left = Math.max(0, snap.raceLaps - (row.currentLap ?? 1));
    title = `${row.driver.name_acronym} · ${left} laps left · pit loss ${loss.toFixed(1)}s · ${row.compound ?? "—"} age ${row.tyreAge ?? "—"}`;
  } else {
    const searched = buildStopPlans({
      model: store.model,
      remaining: 71,
      raceLap: 1,
      currentCompound: "MEDIUM",
      currentAge: 0,
      pitLoss: loss,
      setsLeft: { SOFT: 2, MEDIUM: 1, HARD: 1 },
      ruleActive: true,
      anchor: store.model.baseLap,
    });
    plans = searched.plans.map((plan) => ({
      stops: plan.stops,
      finish: plan.deltaToBest < 0.05 ? "best" : `+${plan.deltaToBest.toFixed(1)} vs best`,
      stints: plan.stints,
    }));
    windows = searched.windows.length ? searched.windows.map((w) => `${compoundLetter(w.from)}→${compoundLetter(w.to)} L${w.raceStart}–${w.raceEnd}`).join(" · ") : windows;
  }

  head.append(el("div", { class: "feed-title", text: title }));
  host.append(head);
  if (!plans.length) host.append(el("div", { class: "help", text: "No legal plan for this stint." }));
  for (const plan of plans) {
    const row = el("div", { class: `feed-plan ${plan.finish === "best" ? "best" : ""}` });
    const pills = el("div", { class: "feed-pills" });
    for (const stint of plan.stints) {
      const pill = el("span", { class: "pill", text: `${compoundLetter(stint.compound)}${stint.laps}` });
      pill.style.color = tyreColor(stint.compound);
      pill.style.borderColor = tyreColor(stint.compound);
      pills.append(pill);
    }
    const delta = plan.finish === "best" ? "+0.0s" : plan.finish.replace(" vs best", "s");
    const deltaEl = el("b", { text: delta });
    if (plan.finish === "best") deltaEl.className = "ok";
    row.append(el("span", { class: "feed-stop", text: `${plan.stops} STOP` }), pills, deltaEl);
    host.append(row);
  }
  host.append(el("div", { class: "feed-windows" }, [
    el("div", { class: "legend", text: "Pit windows" }),
    el("div", { text: windows }),
  ]));
  host.append(el("div", { class: "legend rule-line", text: rule }));
  host.append(el("div", { class: "legend", text: `Model crossovers · ${formatCrossovers(marks)}` }));

  host.append(el("div", { class: "sets-h", text: "Tyre sets remaining (est.)" }));
  const grid = el("div", { class: "sets" });
  if (bundle && snap) {
    for (const row of snap.rows) {
      const sets = estimateSetsLeft(bundle, row.driver.driver_number);
      const line = el("div", { class: "set-row" });
      const code = el("b", { text: row.driver.name_acronym });
      const dot = el("i");
      dot.style.background = `#${row.driver.team_colour}`;
      line.append(dot, code);
      for (const id of ["SOFT", "MEDIUM", "HARD"] as CompoundId[]) {
        const cell = el("span", { text: `${compoundLetter(id)} ${sets[id] ?? 0}` });
        cell.style.color = tyreColor(id);
        line.append(cell);
      }
      grid.append(line);
    }
  } else {
    grid.append(el("div", { class: "help", text: "Sets appear once a session is loaded." }));
  }
  host.append(grid);
  host.append(el("div", { class: "help", text: "Sets are the standard allocation minus weekend /stints. The pace table on Strategy still shows observed clean laps." }));
}

function renderStrip(strip: HTMLElement): void {
  const snap = state.snap;
  strip.replaceChildren();
  if (!snap) {
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  const best = snap.bestSectors;
  const sectors = el("div", {}, [
    el("div", { class: "legend", text: "Best sectors" }),
    el("div", { class: "sec-purple", text: `S1 ${best.s1 ? `${best.s1.code} ${formatSector(best.s1.time)}` : "—"}` }),
    el("div", { class: "sec-purple", text: `S2 ${best.s2 ? `${best.s2.code} ${formatSector(best.s2.time)}` : "—"}` }),
    el("div", { class: "sec-purple", text: `S3 ${best.s3 ? `${best.s3.code} ${formatSector(best.s3.time)}` : "—"}` }),
  ]);
  const pos = el("div", { class: "pos-row" });
  for (const row of snap.rows) {
    const item = el("span", { text: row.driver.name_acronym });
    const dot = el("i");
    dot.style.background = `#${row.driver.team_colour}`;
    item.prepend(dot);
    pos.append(item);
  }
  const track = el("div", {}, [el("div", { class: "legend", text: "Track position" }), pos]);
  const w = snap.weather;
  const rain = w?.rainfall ? "yes" : "0%";
  const wind = w?.wind_direction != null ? compass(w.wind_direction) : "";
  const wx = el("div", {}, [
    el("div", { class: "legend", text: "Weather" }),
    el("div", { text: w ? `Track ${w.track_temperature?.toFixed(0) ?? "—"}°C · air ${w.air_temperature?.toFixed(0) ?? "—"}°C` : "—" }),
    el("div", { text: w ? `Hum ${w.humidity?.toFixed(0) ?? "—"}% · rain ${rain}` : "—" }),
    el("div", { text: w ? `Wind ${w.wind_speed?.toFixed(1) ?? "—"} m/s ${wind}` : "—" }),
  ]);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("tyre-map");
  strip.append(sectors, track, wx, svg);
  drawMiniMap(svg);
}

function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const wrapped = ((deg % 360) + 360) % 360;
  return dirs[Math.round(wrapped / 45) % 8];
}

function drawMiniMap(svg: SVGSVGElement): void {
  const pts = state.bundle?.track ?? [];
  const w = 140;
  const h = 72;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  if (pts.length < 2) return;
  const { map } = project(pts, w, h, 8);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    pts
      .map((p, i) => {
        const [x, y] = map(p[0], p[1]);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" "),
  );
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#dbe3f2");
  path.setAttribute("stroke-width", "1.4");
  svg.append(path);
}

function drawLapChart(canvas: HTMLCanvasElement, model: TyreModel, ids: CompoundId[], dots: ActualDot[]): void {
  const ctx = setup(canvas);
  if (!ctx) return;
  const { w, h } = size(canvas);
  if (!ids.length) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#8b93a7";
    ctx.font = "12px Titillium Web, sans-serif";
    ctx.fillText("Turn a compound on to draw its curve.", 16, 28);
    return;
  }
  const compounds = ids;
  const maxAge = Math.max(20, ...compounds.map((id) => model.compounds[id].lifespan));
  const xMax = Math.ceil(maxAge / 5) * 5;
  let yMin = Infinity;
  let yMax = -Infinity;
  const sample = (id: CompoundId, age: number) => predictedLapTime(model, id, age, 0);
  const plotUntil = (id: CompoundId) => Math.min(xMax, model.compounds[id].lifespan);
  for (const id of compounds) {
    for (let age = 0; age <= plotUntil(id); age += 1) {
      const y = sample(id, age);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
  }
  for (const dot of dots) {
    if (!compounds.includes(dot.compound)) continue;
    if (dot.lapTime < yMin - 3 || dot.lapTime > yMax + 3) continue;
    yMin = Math.min(yMin, dot.lapTime);
    yMax = Math.max(yMax, dot.lapTime);
  }
  if (!Number.isFinite(yMin) || yMin === yMax) {
    yMin = model.baseLap - 0.5;
    yMax = model.baseLap + 3;
  }
  const padY = Math.max(0.15, (yMax - yMin) * 0.08);
  yMin -= padY;
  yMax += padY;
  const box = { l: 64, r: 14, t: 52, b: 36, w, h };
  frame(ctx, box, "Predicted lap time vs stint lap", "Stint lap", yMin, yMax, xMax, (v) => formatLap(v), "lines = model · dots = laps · dashed = max stint");
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.l, box.t, w - box.l - box.r, h - box.t - box.b);
  ctx.clip();
  for (const id of compounds) {
    const life = model.compounds[id].lifespan;
    const x = xOf(box, life, xMax);
    ctx.strokeStyle = tyreColor(id);
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, box.t);
    ctx.lineTo(x, h - box.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  for (const id of compounds) {
    ctx.strokeStyle = tyreColor(id);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const end = plotUntil(id);
    for (let age = 0; age <= end + 1e-6; age += 0.5) {
      const x = xOf(box, Math.min(age, end), xMax);
      const y = yOf(box, sample(id, Math.min(age, end)), yMin, yMax);
      if (age === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    const spec = model.compounds[id];
    if (spec.shape === "cliff" && spec.cliffLap > 0 && spec.cliffLap < xMax) {
      const x = xOf(box, spec.cliffLap, xMax);
      const y = yOf(box, sample(id, spec.cliffLap), yMin, yMax);
      ctx.fillStyle = tyreColor(id);
      ctx.font = "10px Titillium Web, sans-serif";
      ctx.fillText("cliff", x + 3, y - 4);
    }
  }
  for (const dot of dots) {
    if (!compounds.includes(dot.compound) || dot.age < 0 || dot.age > xMax) continue;
    if (dot.lapTime < yMin || dot.lapTime > yMax) continue;
    ctx.fillStyle = "#f8fafc";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(xOf(box, dot.age, xMax), yOf(box, dot.lapTime, yMin, yMax), 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  const marks = crossoverMarks(model, compounds).filter(
    (mark) => mark.age <= plotUntil(mark.from) && mark.age <= plotUntil(mark.to),
  );
  ctx.fillStyle = "#3dd68c";
  for (const mark of marks) {
    const yVal = sample(mark.from, mark.age);
    ctx.beginPath();
    ctx.arc(xOf(box, mark.age, xMax), yOf(box, yVal, yMin, yMax), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = "#3dd68c";
  ctx.font = "12px Barlow Condensed, sans-serif";
  ctx.fillText(marks.length ? formatCrossovers(marks) : "No crossover in these stints", box.l, 46);
}

function drawLossChart(canvas: HTMLCanvasElement, model: TyreModel, ids: CompoundId[]): void {
  const ctx = setup(canvas);
  if (!ctx) return;
  const { w, h } = size(canvas);
  if (!ids.length) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  const compounds = ids;
  const xMax = Math.ceil(Math.max(20, ...compounds.map((id) => model.compounds[id].lifespan)) / 5) * 5;
  let yMax = 1;
  for (const id of compounds) {
    yMax = Math.max(yMax, cumulativeStintLoss(model, id, model.compounds[id].lifespan));
  }
  const box = { l: 64, r: 14, t: 36, b: 36, w, h };
  frame(ctx, box, "Cumulative stint time lost", "Stint length (laps)", 0, yMax * 1.06, xMax, (v) => `+${v.toFixed(0)}s`, "Versus repeating the base lap. Fuel is applied on Strategy.");
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.l, box.t, w - box.l - box.r, h - box.t - box.b);
  ctx.clip();
  for (const id of compounds) {
    ctx.strokeStyle = tyreColor(id);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const end = Math.min(xMax, model.compounds[id].lifespan);
    for (let laps = 0; laps <= end; laps += 1) {
      const x = xOf(box, laps, xMax);
      const y = yOf(box, cumulativeStintLoss(model, id, laps), 0, yMax * 1.06);
      if (laps === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

type Box = { l: number; r: number; t: number; b: number; w: number; h: number };

function frame(
  ctx: CanvasRenderingContext2D,
  box: Box,
  title: string,
  xLabel: string,
  yMin: number,
  yMax: number,
  xMax: number,
  yText: (value: number) => string,
  caption: string,
): void {
  ctx.clearRect(0, 0, box.w, box.h);
  ctx.font = "600 14px Barlow Condensed, sans-serif";
  ctx.fillStyle = "#e8edf7";
  ctx.fillText(title.toUpperCase(), box.l, 16);
  ctx.font = "11px Titillium Web, sans-serif";
  ctx.fillStyle = "#8b93a7";
  ctx.fillText(caption, box.l, 30);
  const yTicks = tickValues(yMin, yMax, 4);
  ctx.textAlign = "right";
  for (const tick of yTicks) {
    const y = yOf(box, tick, yMin, yMax);
    ctx.strokeStyle = "#1c2230";
    ctx.beginPath();
    ctx.moveTo(box.l, y);
    ctx.lineTo(box.w - box.r, y);
    ctx.stroke();
    ctx.fillStyle = "#8b93a7";
    ctx.fillText(yText(tick), box.l - 6, y + 3);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#8b93a7";
  for (let age = 0; age <= xMax; age += xMax > 30 ? 10 : 5) {
    const x = xOf(box, age, xMax);
    ctx.fillText(String(age), x, box.h - box.b + 14);
  }
  ctx.font = "11px Titillium Web, sans-serif";
  ctx.fillText(xLabel, (box.l + box.w - box.r) / 2, box.h - 6);
  ctx.textAlign = "left";
}

function tickValues(min: number, max: number, count: number): number[] {
  const span = max - min || 1;
  const rough = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const err = rough / pow;
  const step = err >= 7 ? 10 * pow : err >= 3 ? 5 * pow : err >= 1.5 ? 2 * pow : pow;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let value = start; value <= max + step * 0.01; value += step) out.push(Number(value.toFixed(4)));
  return out;
}

function xOf(box: Box, age: number, xMax: number): number {
  return box.l + (age / xMax) * (box.w - box.l - box.r);
}

function yOf(box: Box, value: number, yMin: number, yMax: number): number {
  const t = (value - yMin) / (yMax - yMin || 1);
  return box.t + (1 - t) * (box.h - box.t - box.b);
}

function setup(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { w, h } = size(canvas);
  if (w < 30 || h < 30) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function size(canvas: HTMLCanvasElement): { w: number; h: number } {
  const rect = canvas.getBoundingClientRect();
  return { w: rect.width || canvas.clientWidth || 640, h: rect.height || canvas.clientHeight || 240 };
}
