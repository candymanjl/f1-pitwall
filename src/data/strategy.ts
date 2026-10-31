import { TYRE_ALLOCATION } from "../config";
import { linReg, median, parseTs } from "../lib/time";
import type { SessionBundle, TimingSnapshot, TowerRow } from "./types";

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

export type CutView = {
  vsAhead: { name: string; fresh: string; gap: string; verdict: string; kind: "undercut" | "overcut" } | null;
  vsBehind: { name: string; fresh: string; gap: string; verdict: string; kind: "undercut" | "overcut" } | null;
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

export function stopPlans(
  bundle: SessionBundle,
  snap: TimingSnapshot,
  driverNumber: number,
  pitLoss: number,
): StopPlan[] {
  const row = snap.rows.find((r) => r.driver.driver_number === driverNumber);
  const strat = row ? driverStrategy(bundle, snap, row) : null;
  const remaining = Math.max(1, snap.raceLaps - (row?.currentLap ?? 1));
  const pace = strat?.pace ?? snap.medianGreenLap;
  const deg = Math.max(0.01, strat?.deg ?? 0.045);
  const fresh = pace - deg * Math.max(0, (row?.tyreAge ?? 8) * 0.45);
  const currentAge = row?.tyreAge ?? 6;
  const compound = row?.compound ?? "MEDIUM";

  const predict = (stintLaps: number[], extraStops: number): { total: number; stints: StopPlan["stints"] } => {
    let total = 0;
    const out: StopPlan["stints"] = [];
    stintLaps.forEach((n, i) => {
      let t = 0;
      const age0 = i === 0 ? currentAge : 0;
      const c = i === 0 ? compound : i === 1 ? "HARD" : "SOFT";
      for (let k = 0; k < n; k++) t += fresh + deg * (age0 + k);
      out.push({ compound: c, laps: n, time: t });
      total += t;
    });
    total += pitLoss * extraStops;
    return { total, stints: out };
  };

  const split = (stops: number): number[] => {
    const pieces = stops + 1;
    const base = Math.floor(remaining / pieces);
    const arr = Array.from({ length: pieces }, () => Math.max(1, base));
    let used = arr.reduce((a, b) => a + b, 0);
    arr[arr.length - 1] += remaining - used;
    if (arr[arr.length - 1] < 1) arr[arr.length - 1] = 1;
    return arr;
  };

  return [1, 2, 3].map((stops) => {
    const parts = split(stops);
    const { total, stints } = predict(parts, stops);
    const vsOne = stops === 1 ? 0 : 0;
    return {
      stops,
      total,
      pitLoss: pitLoss * stops,
      finish: `P?`,
      note: stops === 1 ? "best" : "",
      stints,
      _vs: vsOne,
    };
  }).map((p, _, all) => {
    const best = Math.min(...all.map((x) => x.total));
    const delta = p.total - best;
    return {
      stops: p.stops,
      total: p.total,
      pitLoss: p.pitLoss,
      finish: delta < 0.05 ? "best" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} vs best`,
      note: p.stops === 1 ? "1 stop" : `${p.stops} stop`,
      stints: p.stints,
    };
  });
}

export function cutPanel(bundle: SessionBundle, snap: TimingSnapshot, driverNumber: number, pitLoss: number): CutView {
  const idx = snap.rows.findIndex((r) => r.driver.driver_number === driverNumber);
  const me = snap.rows[idx];
  if (!me) return { vsAhead: null, vsBehind: null };

  const evalVs = (other: TowerRow, kind: "ahead" | "behind") => {
    const mine = driverStrategy(bundle, snap, me);
    const theirs = driverStrategy(bundle, snap, other);
    const myPace = mine.pace ?? snap.medianGreenLap;
    const theirPace = theirs.pace ?? snap.medianGreenLap;
    const myDeg = Math.max(0.01, mine.deg ?? 0.04);
    const theirDeg = Math.max(0.01, theirs.deg ?? 0.04);
    const myFresh = myPace - myDeg * Math.max(0, (me.tyreAge ?? 6) * 0.5);
    const theirFresh = theirPace - theirDeg * Math.max(0, (other.tyreAge ?? 6) * 0.5);
    const n = 6;
    let undercut = 0;
    for (let i = 0; i < n; i++) undercut += myFresh + myDeg * i - (theirPace + theirDeg * i);
    undercut += 0;
    const recover = undercut;
    const gap = typeof me.interval === "number" ? me.interval : 0;
    const viable = recover < -0.15;
    if (kind === "ahead") {
      return {
        name: other.driver.name_acronym,
        fresh: `${myFresh.toFixed(3)} vs ${theirPace.toFixed(3)}`,
        gap: `gap ${gap.toFixed(3)} · pit ${pitLoss.toFixed(1)}s`,
        verdict: viable ? "UNDERCUT VIABLE" : recover < 0.4 ? "STAY OUT" : "OVERCUT WEAK",
        kind: viable ? ("undercut" as const) : ("overcut" as const),
      };
    }
    return {
      name: other.driver.name_acronym,
      fresh: `${theirFresh.toFixed(3)} vs ${myPace.toFixed(3)}`,
      gap: `gap ${typeof other.interval === "number" ? other.interval.toFixed(3) : "—"}`,
      verdict: theirPace + 0.2 < myPace ? "DEFEND" : "LOW RISK",
      kind: "overcut" as const,
    };
  };

  return {
    vsAhead: idx > 0 ? evalVs(snap.rows[idx - 1], "ahead") : null,
    vsBehind: idx < snap.rows.length - 1 ? evalVs(snap.rows[idx + 1], "behind") : null,
  };
}
