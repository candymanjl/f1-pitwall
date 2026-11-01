import { TYRE_ALLOCATION } from "../config";
import { linReg, median, parseTs } from "../lib/time";
import type { SessionBundle, TimingSnapshot, TowerRow } from "./types";
import {
  anchorForPace,
  asCompound,
  buildStopPlans,
  compoundLetter,
  compoundRuleStatus,
  formatPitWindows,
  readTyreStore,
  strategyLapTime,
  type CompoundId,
  type TyreModel,
} from "./tyres";

export type DriverStrategy = {
  row: TowerRow;
  pace: number | null;
  deg: number | null;
  setsLeft: Record<string, number>;
  heldUp: boolean;
  holdDelta: number | null;
};

export type StopPlan = {
  stops: number;
  total: number;
  pitLoss: number;
  finish: string;
  note: string;
  stints: { compound: string; laps: number; time: number }[];
};

export type CutCard = {
  name: string;
  fresh: string;
  gap: string;
  verdict: string;
  kind: "undercut" | "overcut";
};

export type CutView = {
  vsAhead: CutCard | null;
  vsBehind: CutCard | null;
  overcut: CutCard | null;
};

export type StrategyBrief = {
  plans: StopPlan[];
  windows: string;
  rule: string;
  cuts: CutView;
};

function cleanStintLaps(bundle: SessionBundle, snap: TimingSnapshot, driverNumber: number): number[] {
  const row = snap.rows.find((r) => r.driver.driver_number === driverNumber);
  if (!row) return [];
  const sc = snap.scBands;
  const times: number[] = [];
  for (const lap of bundle.laps) {
    if (lap.driver_number !== driverNumber) continue;
    if (!lap.lap_duration || lap.is_pit_out_lap) continue;
    const start = parseTs(lap.date_start);
    if (start + lap.lap_duration * 1000 > snap.now) continue;
    if (sc.some((b) => start >= b.start && start <= b.end)) continue;
    const pit = bundle.pits.some(
      (p) => p.driver_number === driverNumber && p.lap_number === lap.lap_number,
    );
    if (pit) continue;
    times.push(lap.lap_duration);
  }
  return times;
}

function currentStintTimes(bundle: SessionBundle, snap: TimingSnapshot, driverNumber: number): { xs: number[]; ys: number[] } {
  const stints = bundle.stints
    .filter((s) => s.driver_number === driverNumber)
    .sort((a, b) => (a.lap_start ?? 0) - (b.lap_start ?? 0));
  const row = snap.rows.find((r) => r.driver.driver_number === driverNumber);
  const lapNo = row?.currentLap ?? 1;
  const stint = [...stints].reverse().find((s) => lapNo >= (s.lap_start ?? 1) && lapNo <= (s.lap_end ?? 999)) ?? stints[stints.length - 1];
  const xs: number[] = [];
  const ys: number[] = [];
  if (!stint) return { xs, ys };
  for (const lap of bundle.laps) {
    if (lap.driver_number !== driverNumber) continue;
    if (lap.lap_number < (stint.lap_start ?? 1)) continue;
    if (stint.lap_end && lap.lap_number > stint.lap_end) continue;
    if (!lap.lap_duration || lap.is_pit_out_lap) continue;
    const start = parseTs(lap.date_start);
    if (start + lap.lap_duration * 1000 > snap.now) continue;
    if (snap.scBands.some((b) => start >= b.start && start <= b.end)) continue;
    xs.push(lap.lap_number - (stint.lap_start ?? 1) + 1);
    ys.push(lap.lap_duration);
  }
  return { xs, ys };
}

export function estimateSetsLeft(bundle: SessionBundle, driverNumber: number): Record<string, number> {
  const used: Record<string, number> = {};
  for (const stint of bundle.weekendStints) {
    if (stint.driver_number !== driverNumber) continue;
    const c = (stint.compound ?? "UNKNOWN").toUpperCase();
    used[c] = (used[c] ?? 0) + 1;
  }
  const left: Record<string, number> = {};
  for (const [compound, alloc] of Object.entries(TYRE_ALLOCATION)) {
    left[compound] = Math.max(0, alloc - (used[compound] ?? 0));
  }
  return left;
}

export function driverStrategy(bundle: SessionBundle, snap: TimingSnapshot, row: TowerRow): DriverStrategy {
  const times = currentStintTimes(bundle, snap, row.driver.driver_number);
  const recent = times.ys.slice(-5);
  const pace = recent.length ? median(recent) : median(cleanStintLaps(bundle, snap, row.driver.driver_number));
  const { slope } = linReg(times.xs, times.ys);
  const deg = times.ys.length >= 4 ? slope : null;

  const idx = snap.rows.findIndex((r) => r.driver.driver_number === row.driver.driver_number);
  const ahead = idx > 0 ? snap.rows[idx - 1] : null;
  const intervalNum = typeof row.interval === "number" ? row.interval : null;
  const aheadSlower =
    ahead &&
    ahead.lastLap != null &&
    row.lastLap != null &&
    ahead.lastLap > row.lastLap + 0.05;
  const heldUp = intervalNum != null && intervalNum < 1 && !!aheadSlower;
  const holdDelta =
    heldUp && ahead?.lastLap != null && row.lastLap != null ? ahead.lastLap - row.lastLap : null;

  return {
    row,
    pace: Number.isFinite(pace) ? pace : null,
    deg,
    setsLeft: estimateSetsLeft(bundle, row.driver.driver_number),
    heldUp,
    holdDelta,
  };
}

const EMPTY_CUTS: CutView = { vsAhead: null, vsBehind: null, overcut: null };

let briefCache: { key: string; value: StrategyBrief } | null = null;

function compoundsInPlay(bundle: SessionBundle, snap: TimingSnapshot): string[] {
  const lap = snap.leaderLap;
  return bundle.stints
    .filter((stint) => (stint.lap_start ?? 1) <= lap)
    .map((stint) => stint.compound ?? "");
}

function bestNextCompound(
  model: TyreModel,
  current: CompoundId,
  sets: Record<string, number>,
  ruleActive: boolean,
  anchor: number,
  raceLap: number,
): CompoundId {
  let best: CompoundId = current === "HARD" ? "MEDIUM" : "HARD";
  let bestTime = Infinity;
  for (const compound of ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as CompoundId[]) {
    if (compound === current) continue;
    if (ruleActive && compound !== "SOFT" && compound !== "MEDIUM" && compound !== "HARD") continue;
    if ((sets[compound] ?? 0) <= 0) continue;
    const time = strategyLapTime(model, anchor, compound, 0, raceLap);
    if (time < bestTime) {
      bestTime = time;
      best = compound;
    }
  }
  return best;
}

function paceGain(
  model: TyreModel,
  myAnchor: number,
  myCompound: CompoundId,
  myAge: number,
  theirAnchor: number,
  theirCompound: CompoundId,
  theirAge: number,
  raceLap: number,
): number {
  let gain = 0;
  for (let i = 0; i < 6; i++) {
    const mine = strategyLapTime(model, myAnchor, myCompound, myAge + i, raceLap + i);
    const theirs = strategyLapTime(model, theirAnchor, theirCompound, theirAge + i, raceLap + i);
    gain += theirs - mine;
  }
  return gain;
}

const DRY: CompoundId[] = ["SOFT", "MEDIUM", "HARD"];

function stintSeconds(
  model: TyreModel,
  anchor: number,
  compound: CompoundId,
  age0: number,
  laps: number,
  raceLap0: number,
): number {
  let total = 0;
  for (let i = 0; i < laps; i++) total += strategyLapTime(model, anchor, compound, age0 + i, raceLap0 + i);
  return total;
}

/**
 * When the legal search has nothing (no sets left, or only the compound already fitted),
 * still offer a pit-now stop and one later alternative. A compound with no sets left is
 * marked as assumed so the row is never blank.
 */
function fallbackPitPlans(input: {
  model: TyreModel;
  remaining: number;
  raceLap: number;
  current: CompoundId;
  age: number;
  pitLoss: number;
  sets: Record<string, number>;
  anchor: number;
}): { plans: StopPlan[]; windows: string } {
  const remaining = Math.max(2, Math.floor(input.remaining));
  const others = DRY.filter((compound) => compound !== input.current);
  const available = others.filter((compound) => (input.sets[compound] ?? 0) > 0);
  const pool = available.length ? available : others;

  const shapes: Array<{ lengths: [number, number]; label: "pit now" | "best alternative" }> = [
    { lengths: [1, remaining - 1], label: "pit now" },
  ];
  const later = Math.min(remaining - 1, Math.max(2, Math.round(remaining * 0.4)));
  if (later !== 1) shapes.push({ lengths: [later, remaining - later], label: "best alternative" });

  type Draft = {
    lengths: [number, number];
    next: CompoundId;
    total: number;
    first: number;
    second: number;
    assumed: boolean;
    label: "pit now" | "best alternative";
  };

  const costOf = (lengths: [number, number], next: CompoundId): Pick<Draft, "total" | "first" | "second" | "assumed"> => {
    const first = stintSeconds(input.model, input.anchor, input.current, input.age, lengths[0], input.raceLap);
    const second = stintSeconds(
      input.model,
      input.anchor,
      next,
      0,
      lengths[1],
      input.raceLap + lengths[0],
    );
    return {
      first,
      second,
      total: first + second + input.pitLoss,
      assumed: (input.sets[next] ?? 0) <= 0,
    };
  };

  const pick = (lengths: [number, number], label: Draft["label"]): Draft | null => {
    let best: Draft | null = null;
    for (const next of pool) {
      const cost = costOf(lengths, next);
      if (!best || cost.total < best.total) best = { lengths, next, label, ...cost };
    }
    return best;
  };

  const now = pick(shapes[0].lengths, "pit now");
  if (!now) return { plans: [], windows: formatPitWindows([]) };

  let alt = shapes[1] ? pick(shapes[1].lengths, "best alternative") : null;
  if (!alt) {
    const other = pool.find((compound) => compound !== now.next) ?? DRY.find((compound) => compound !== input.current && compound !== now.next);
    if (other) {
      alt = { lengths: now.lengths, next: other, label: "best alternative", ...costOf(now.lengths, other) };
    }
  }
  const drafts = alt ? [now, alt] : [now];
  const bestTotal = Math.min(...drafts.map((draft) => draft.total));
  const plans: StopPlan[] = drafts.map((draft) => ({
    stops: 1,
    total: draft.total,
    pitLoss: input.pitLoss,
    finish: draft.total - bestTotal < 0.05 ? "best" : `+${(draft.total - bestTotal).toFixed(1)} vs best`,
    note: draft.assumed ? `${draft.label} · assumed set` : draft.label,
    stints: [
      { compound: input.current, laps: draft.lengths[0], time: draft.first },
      { compound: draft.next, laps: draft.lengths[1], time: draft.second },
    ],
  }));
  const windows = drafts
    .map((draft) => `${compoundLetter(input.current)}→${compoundLetter(draft.next)} L${input.raceLap + draft.lengths[0]}`)
    .join(" · ");
  return { plans, windows };
}

export function strategyBrief(
  bundle: SessionBundle,
  snap: TimingSnapshot,
  driverNumber: number,
  pitLoss: number,
): StrategyBrief {
  const store = readTyreStore();
  const row = snap.rows.find((r) => r.driver.driver_number === driverNumber) ?? null;
  const model = store.model;
  const current = asCompound(row?.compound) ?? "MEDIUM";
  const age = Math.max(0, row?.tyreAge ?? 0);
  const raceLap = Math.max(1, row?.currentLap ?? snap.leaderLap ?? 1);
  const remaining = Math.max(2, snap.raceLaps - raceLap);
  const strat = row ? driverStrategy(bundle, snap, row) : null;
  const pace = strat?.pace ?? snap.medianGreenLap;
  const anchor = Number.isFinite(pace)
    ? anchorForPace(model, current, age, raceLap, pace)
    : model.baseLap;
  const sets = row ? estimateSetsLeft(bundle, row.driver.driver_number) : { ...TYRE_ALLOCATION };
  const key = [
    bundle.session.session_key,
    driverNumber,
    row?.currentLap ?? 0,
    row?.compound ?? "",
    row?.tyreAge ?? 0,
    pitLoss,
    snap.leaderLap,
    snap.weather?.rainfall ?? 0,
    snap.medianGreenLap,
    JSON.stringify(store.model),
    JSON.stringify(sets),
  ].join("|");
  if (briefCache?.key === key) return briefCache.value;

  const rule = compoundRuleStatus({
    rainfall: snap.weather?.rainfall,
    messages: bundle.raceControl
      .filter((ev) => parseTs(ev.date) <= snap.now)
      .map((ev) => ev.message ?? ""),
    compoundsSeen: compoundsInPlay(bundle, snap),
  });
  const searched = buildStopPlans({
    model,
    remaining,
    raceLap,
    currentCompound: current,
    currentAge: age,
    pitLoss,
    setsLeft: sets,
    ruleActive: rule.ruleActive,
    anchor,
  });
  const plans: StopPlan[] = searched.plans.map((plan) => ({
    stops: plan.stops,
    total: plan.total,
    pitLoss: plan.pitLoss,
    finish: plan.deltaToBest < 0.05 ? "best" : `+${plan.deltaToBest.toFixed(1)} vs best`,
    note: plan.stops === 1 ? "1 stop" : `${plan.stops} stop`,
    stints: plan.stints.map((stint) => ({ compound: stint.compound, laps: stint.laps, time: stint.time })),
  }));
  let windows = formatPitWindows(searched.windows);
  if (!plans.length) {
    const fallback = fallbackPitPlans({
      model,
      remaining,
      raceLap,
      current,
      age,
      pitLoss,
      sets,
      anchor,
    });
    plans.push(...fallback.plans);
    windows = fallback.windows;
  }

  const idx = row ? snap.rows.findIndex((r) => r.driver.driver_number === driverNumber) : -1;
  const cuts = row ? cutsFor(bundle, snap, row, idx, model, pitLoss, rule.ruleActive) : EMPTY_CUTS;
  const value: StrategyBrief = {
    plans,
    windows,
    rule: rule.reason,
    cuts,
  };
  briefCache = { key, value };
  return value;
}

function cutsFor(
  bundle: SessionBundle,
  snap: TimingSnapshot,
  me: TowerRow,
  idx: number,
  model: TyreModel,
  pitLoss: number,
  ruleActive: boolean,
): CutView {
  const myCompound = asCompound(me.compound) ?? "MEDIUM";
  const myAge = Math.max(0, me.tyreAge ?? 0);
  const raceLap = Math.max(1, me.currentLap ?? 1);
  const mine = driverStrategy(bundle, snap, me);
  const myPace = mine.pace ?? snap.medianGreenLap;
  const myAnchor = Number.isFinite(myPace)
    ? anchorForPace(model, myCompound, myAge, raceLap, myPace)
    : model.baseLap;
  const mySets = estimateSetsLeft(bundle, me.driver.driver_number);
  const myNext = bestNextCompound(model, myCompound, mySets, ruleActive, myAnchor, raceLap);

  const versus = (other: TowerRow, kind: "ahead" | "behind"): CutCard => {
    const theirCompound = asCompound(other.compound) ?? "MEDIUM";
    const theirAge = Math.max(0, other.tyreAge ?? 0);
    const theirs = driverStrategy(bundle, snap, other);
    const theirPace = theirs.pace ?? snap.medianGreenLap;
    const theirAnchor = Number.isFinite(theirPace)
      ? anchorForPace(model, theirCompound, theirAge, raceLap, theirPace)
      : model.baseLap;
    const theirSets = estimateSetsLeft(bundle, other.driver.driver_number);
    const theirNext = bestNextCompound(model, theirCompound, theirSets, ruleActive, theirAnchor, raceLap);
    const gap = kind === "ahead"
      ? typeof me.interval === "number" ? me.interval : 0
      : typeof other.interval === "number" ? other.interval : 0;
    if (kind === "behind") {
      const threat = paceGain(model, theirAnchor, theirNext, 0, myAnchor, myCompound, myAge, raceLap);
      return {
        name: other.driver.name_acronym,
        fresh: `${strategyLapTime(model, theirAnchor, theirNext, 0, raceLap).toFixed(3)} vs ${strategyLapTime(model, myAnchor, myCompound, myAge, raceLap).toFixed(3)}`,
        gap: `gap ${gap.toFixed(3)} · pit ${pitLoss.toFixed(1)}s`,
        verdict: threat > gap ? "DEFEND" : "LOW RISK",
        kind: "overcut",
      };
    }
    const under = paceGain(model, myAnchor, myNext, 0, theirAnchor, theirCompound, theirAge, raceLap);
    const fresh = strategyLapTime(model, myAnchor, myNext, 0, raceLap);
    const theirNow = strategyLapTime(model, theirAnchor, theirCompound, theirAge, raceLap);
    return {
      name: other.driver.name_acronym,
      fresh: `${fresh.toFixed(3)} vs ${theirNow.toFixed(3)}`,
      gap: `gap ${gap.toFixed(3)} · pit ${pitLoss.toFixed(1)}s`,
      verdict: under > gap + 0.15 ? "UNDERCUT VIABLE" : under > 0 ? "STAY OUT" : "UNDERCUT WEAK",
      kind: under > gap + 0.15 ? "undercut" : "overcut",
    };
  };

  const ahead = idx > 0 ? snap.rows[idx - 1] : null;
  let overcut: CutCard | null = null;
  if (ahead) {
    const theirCompound = asCompound(ahead.compound) ?? "MEDIUM";
    const theirAge = Math.max(0, ahead.tyreAge ?? 0);
    const theirs = driverStrategy(bundle, snap, ahead);
    const theirPace = theirs.pace ?? snap.medianGreenLap;
    const theirAnchor = Number.isFinite(theirPace)
      ? anchorForPace(model, theirCompound, theirAge, raceLap, theirPace)
      : model.baseLap;
    const theirNext = bestNextCompound(
      model,
      theirCompound,
      estimateSetsLeft(bundle, ahead.driver.driver_number),
      ruleActive,
      theirAnchor,
      raceLap,
    );
    const gap = typeof me.interval === "number" ? me.interval : 0;
    const theirGain = paceGain(model, theirAnchor, theirNext, 0, myAnchor, myCompound, myAge, raceLap);
    overcut = {
      name: ahead.driver.name_acronym,
      fresh: `stay ${strategyLapTime(model, myAnchor, myCompound, myAge, raceLap).toFixed(3)}`,
      gap: `their fresh gain ${theirGain.toFixed(2)}s / 6 laps`,
      verdict: theirGain < gap ? "OVERCUT OPTION" : "OVERCUT WEAK",
      kind: "overcut",
    };
  }

  return {
    vsAhead: ahead ? versus(ahead, "ahead") : null,
    vsBehind: idx >= 0 && idx < snap.rows.length - 1 ? versus(snap.rows[idx + 1], "behind") : null,
    overcut,
  };
}

export function stopPlans(
  bundle: SessionBundle,
  snap: TimingSnapshot,
  driverNumber: number,
  pitLoss: number,
): StopPlan[] {
  return strategyBrief(bundle, snap, driverNumber, pitLoss).plans;
}

export function cutPanel(
  bundle: SessionBundle,
  snap: TimingSnapshot,
  driverNumber: number,
  pitLoss: number,
): CutView {
  return strategyBrief(bundle, snap, driverNumber, pitLoss).cuts;
}
