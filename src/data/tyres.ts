import { median, linReg, parseTs, clamp } from "../lib/time";
import { safetyCarBands } from "./derive";
import type { Interval, Lap, Pit, RaceControl, Stint } from "./types";

export const COMPOUNDS = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as const;
export type CompoundId = (typeof COMPOUNDS)[number];
export type CurveShape = "linear" | "cliff";

export type CompoundModel = {
  /** Seconds versus a new Soft at age 0. */
  offset: number;
  /** Seconds lost per lap before the cliff (the whole life when shape is linear). */
  degPerLap: number;
  /** Max useful stint, in laps. Grip is interpolated across this span. */
  lifespan: number;
  shape: CurveShape;
  /** Stint lap where the drop starts. Ignored when shape is linear. */
  cliffLap: number;
  /** Extra seconds per lap after the cliff. */
  cliffDeg: number;
};

export type TyreModel = {
  /** Fresh-soft reference lap, seconds. */
  baseLap: number;
  /** Seconds gained per race lap as fuel burns off. */
  fuelPerLap: number;
  compounds: Record<CompoundId, CompoundModel>;
};

export type FitQuality = { r2: number; n: number; rmse: number };

export type ActualDot = { compound: CompoundId; age: number; lapTime: number };

export type TyreFitMeta = {
  source: "practice" | "race";
  label: string;
  sessionKey: number | null;
  quality: Partial<Record<CompoundId, FitQuality>>;
  used: number;
  excludedInOut: number;
  excludedSc: number;
  excludedTraffic: number;
  dots: ActualDot[];
  edited: boolean;
};

export type TyreStore = {
  model: TyreModel;
  fit: TyreFitMeta | null;
};

const STORAGE_KEY = "f1pitwall.tyreModel";

export function defaultTyreModel(): TyreModel {
  return {
    baseLap: 79,
    fuelPerLap: 0.03,
    compounds: {
      SOFT: { offset: 0, degPerLap: 0.085, lifespan: 18, shape: "cliff", cliffLap: 16, cliffDeg: 0.35 },
      MEDIUM: { offset: 0.6, degPerLap: 0.05, lifespan: 30, shape: "cliff", cliffLap: 26, cliffDeg: 0.15 },
      HARD: { offset: 0.8, degPerLap: 0.03, lifespan: 42, shape: "cliff", cliffLap: 38, cliffDeg: 0.1 },
      INTERMEDIATE: { offset: 8, degPerLap: 0.04, lifespan: 32, shape: "linear", cliffLap: 24, cliffDeg: 0.12 },
      WET: { offset: 14, degPerLap: 0.05, lifespan: 28, shape: "linear", cliffLap: 20, cliffDeg: 0.15 },
    },
  };
}

export function compoundLetter(compound: string): string {
  if (compound === "INTERMEDIATE") return "I";
  if (compound === "WET") return "W";
  return (compound || "?").slice(0, 1).toUpperCase();
}

export function asCompound(value: string | null | undefined): CompoundId | null {
  const u = (value ?? "").trim().toUpperCase();
  if (!u) return null;
  if (u === "S" || u.startsWith("SOFT")) return "SOFT";
  if (u === "M" || u.startsWith("MEDIUM")) return "MEDIUM";
  if (u === "H" || u.startsWith("HARD")) return "HARD";
  if (u === "I" || u.startsWith("INTER")) return "INTERMEDIATE";
  if (u === "W" || u.startsWith("WET")) return "WET";
  return null;
}

export function isDryCompound(compound: string): boolean {
  return compound === "SOFT" || compound === "MEDIUM" || compound === "HARD";
}

export function isWetCompound(compound: string): boolean {
  return compound === "INTERMEDIATE" || compound === "WET";
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeCompound(raw: Partial<CompoundModel> | undefined, fallback: CompoundModel): CompoundModel {
  const shape: CurveShape = raw?.shape === "linear" || raw?.shape === "cliff" ? raw.shape : fallback.shape;
  return {
    offset: clamp(num(raw?.offset, fallback.offset), -5, 40),
    degPerLap: clamp(num(raw?.degPerLap, fallback.degPerLap), 0, 1.5),
    lifespan: clamp(Math.round(num(raw?.lifespan, fallback.lifespan)), 4, 70),
    shape,
    cliffLap: clamp(Math.round(num(raw?.cliffLap, fallback.cliffLap)), 1, 70),
    cliffDeg: clamp(num(raw?.cliffDeg, fallback.cliffDeg), 0, 2),
  };
}

export function sanitizeModel(raw: Partial<TyreModel> | null | undefined): TyreModel {
  const base = defaultTyreModel();
  const compounds = {} as Record<CompoundId, CompoundModel>;
  for (const id of COMPOUNDS) {
    compounds[id] = sanitizeCompound(raw?.compounds?.[id], base.compounds[id]);
  }
  return {
    baseLap: clamp(num(raw?.baseLap, base.baseLap), 55, 140),
    fuelPerLap: clamp(num(raw?.fuelPerLap, base.fuelPerLap), 0, 0.12),
    compounds,
  };
}

export function cloneModel(model: TyreModel): TyreModel {
  return sanitizeModel(model);
}

/**
 * Lap-time loss at a fractional stint age.
 * Linear: loss = deg × age (interpolated across the life).
 * Cliff: same slope until cliffLap, then deg + cliffDeg. Fractional ages sit on that polyline.
 */
export function lapTimeLoss(compound: CompoundModel, ageLaps: number): number {
  const age = Math.max(0, ageLaps);
  const deg = Math.max(0, compound.degPerLap);
  if (compound.shape !== "cliff") return deg * age;
  const cliff = Math.max(0, compound.cliffLap);
  const extra = Math.max(0, compound.cliffDeg);
  if (age <= cliff) return deg * age;
  return deg * age + extra * (age - cliff);
}

/** 1 on a new tyre, 0 at the end of the useful life. Follows the loss curve. */
export function gripIndex(model: TyreModel, compound: CompoundId, age: number): number {
  const spec = model.compounds[compound];
  const endAge = Math.max(1, spec.lifespan);
  const endLoss = lapTimeLoss(spec, endAge);
  if (endLoss <= 1e-9) return 1;
  const loss = lapTimeLoss(spec, clamp(age, 0, endAge));
  return clamp(1 - loss / endLoss, 0, 1);
}

/** Predicted lap, seconds. Fuel lowers the time as the race lap rises. */
export function predictedLapTime(
  model: TyreModel,
  compound: CompoundId,
  stintAge: number,
  raceLap = 0,
): number {
  const spec = model.compounds[compound];
  return model.baseLap + spec.offset + lapTimeLoss(spec, stintAge) - model.fuelPerLap * Math.max(0, raceLap);
}

/**
 * Shift applied so the model's current-tyre prediction matches an observed lap.
 * Base lap cancels in plan deltas; offsets, deg, cliff, and fuel still move the ranking.
 */
export function anchorForPace(
  model: TyreModel,
  compound: CompoundId,
  age: number,
  raceLap: number,
  pace: number,
): number {
  const spec = model.compounds[compound];
  return pace - spec.offset - lapTimeLoss(spec, age) + model.fuelPerLap * Math.max(0, raceLap);
}

export function cumulativeStintLoss(
  model: TyreModel,
  compound: CompoundId,
  laps: number,
  opts: { raceLap0?: number; fuel?: boolean } = {},
): number {
  const spec = model.compounds[compound];
  const n = Math.max(0, Math.floor(laps));
  const race0 = opts.raceLap0 ?? 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const fuel = opts.fuel ? model.fuelPerLap * (race0 + i) : 0;
    sum += spec.offset + lapTimeLoss(spec, i) - fuel;
  }
  return sum;
}

/**
 * First stint age where `from` (faster at age 0) becomes slower than `to`.
 * Null when the lines do not cross inside the horizon.
 */
export function crossoverAge(
  model: TyreModel,
  from: CompoundId,
  to: CompoundId,
  horizon?: number,
): number | null {
  if (from === to) return null;
  const maxAge =
    horizon ??
    Math.max(model.compounds[from].lifespan, model.compounds[to].lifespan, 1);
  const delta = (age: number) =>
    predictedLapTime(model, from, age, 0) - predictedLapTime(model, to, age, 0);
  let prev = 0;
  let prevD = delta(0);
  if (prevD > 1e-6) return null;
  const step = 0.25;
  for (let age = step; age <= maxAge + 1e-6; age += step) {
    const d = delta(age);
    if (prevD < -1e-9 && d >= 0) {
      const span = d - prevD;
      const t = span === 0 ? 0 : -prevD / span;
      return prev + (age - prev) * t;
    }
    prev = age;
    prevD = d;
  }
  return null;
}

export type CrossoverMark = { from: CompoundId; to: CompoundId; age: number };

export function crossoverMarks(model: TyreModel, compounds: CompoundId[]): CrossoverMark[] {
  const marks: CrossoverMark[] = [];
  for (const from of compounds) {
    for (const to of compounds) {
      if (from === to) continue;
      const limit = Math.max(model.compounds[from].lifespan, model.compounds[to].lifespan);
      const age = crossoverAge(model, from, to, limit);
      if (age == null || age > limit) continue;
      marks.push({ from, to, age });
    }
  }
  return marks.sort((a, b) => a.age - b.age || a.from.localeCompare(b.from));
}

export type RuleStatus = {
  declaredWet: boolean;
  wetTyresUsed: boolean;
  ruleActive: boolean;
  reason: string;
};

const WET_RACE_MSG =
  /WET RACE|DECLARED WET|CHANGE TO (INTERMEDIATE|WET)|INTERMEDIATE TYRES|WET TYRES/i;

/** Dry races must use two different dry compounds. Wet races and inter/wet running lift it. */
export function compoundRuleStatus(input: {
  rainfall?: number | null;
  messages?: string[];
  compoundsSeen?: string[];
}): RuleStatus {
  const declaredWet =
    (input.rainfall ?? 0) > 0 || (input.messages ?? []).some((m) => WET_RACE_MSG.test(m));
  const wetTyresUsed = (input.compoundsSeen ?? []).some((c) => {
    const id = asCompound(c);
    return id === "INTERMEDIATE" || id === "WET";
  });
  if (declaredWet) {
    return {
      declaredWet: true,
      wetTyresUsed,
      ruleActive: false,
      reason: "Two-compound rule lifted: race declared wet.",
    };
  }
  if (wetTyresUsed) {
    return {
      declaredWet: false,
      wetTyresUsed: true,
      ruleActive: false,
      reason: "Two-compound rule lifted: inters or wets used.",
    };
  }
  return {
    declaredWet: false,
    wetTyresUsed: false,
    ruleActive: true,
    reason: "Dry race: each plan must use at least two different dry compounds.",
  };
}

export function planMeetsCompoundRule(compounds: string[], ruleActive: boolean): boolean {
  if (!ruleActive) return true;
  if (compounds.some((c) => isWetCompound(c))) return true;
  const dry = new Set(compounds.filter((c) => isDryCompound(c)));
  return dry.size >= 2;
}

export type FitLapInput = {
  driver: number;
  lapNumber: number;
  lapTime: number | null;
  isPitOut: boolean;
  dateStart: number;
  compound: string | null;
  stintStart: number | null;
  tyreAgeAtStart: number | null;
  isPitIn: boolean;
  inSc: boolean;
  /** Seconds to the car ahead. Null when the session has no intervals. */
  interval: number | null;
};

export type CleanTag = "ok" | "no-time" | "out-lap" | "in-lap" | "sc" | "traffic" | "unknown-compound";

const TRAFFIC_GAP_S = 1.2;
const TRAFFIC_SLOW_S = 1.5;

export function tagLap(lap: FitLapInput, stintMedian: number | null): CleanTag {
  const time = lap.lapTime;
  if (time == null || !Number.isFinite(time) || time < 50 || time > 200) return "no-time";
  if (lap.isPitOut) return "out-lap";
  if (lap.isPitIn) return "in-lap";
  if (lap.inSc) return "sc";
  if (!asCompound(lap.compound)) return "unknown-compound";
  if (lap.interval != null && lap.interval > 0 && lap.interval < TRAFFIC_GAP_S) return "traffic";
  if (
    (lap.interval == null || !Number.isFinite(lap.interval)) &&
    stintMedian != null &&
    Number.isFinite(stintMedian) &&
    time > stintMedian + TRAFFIC_SLOW_S
  ) {
    return "traffic";
  }
  return "ok";
}

export type PreparedLap = FitLapInput & { compoundId: CompoundId; age: number; raceLap: number };

export type CleanCounts = {
  used: number;
  inOut: number;
  sc: number;
  traffic: number;
  other: number;
};

function stintKey(lap: FitLapInput): string {
  return `${lap.driver}:${lap.stintStart ?? "x"}:${lap.compound ?? ""}`;
}

/** Drop in-laps, out-laps, SC/VSC, and traffic. Practice fits can require a long run. */
export function prepareFitLaps(
  laps: FitLapInput[],
  opts: { minLongRun?: number | null; untilMs?: number } = {},
): { clean: PreparedLap[]; counts: CleanCounts } {
  const until = opts.untilMs ?? Number.POSITIVE_INFINITY;
  const visible = laps.filter((lap) => !Number.isFinite(lap.dateStart) || lap.dateStart <= until);
  const groups = new Map<string, FitLapInput[]>();
  for (const lap of visible) {
    const key = stintKey(lap);
    const list = groups.get(key);
    if (list) list.push(lap);
    else groups.set(key, [lap]);
  }
  const medians = new Map<string, number>();
  for (const [key, list] of groups) {
    const times = list
      .filter(
        (lap) =>
          lap.lapTime != null &&
          lap.lapTime > 50 &&
          lap.lapTime < 200 &&
          !lap.isPitOut &&
          !lap.isPitIn &&
          !lap.inSc,
      )
      .map((lap) => lap.lapTime as number);
    medians.set(key, median(times));
  }

  const counts: CleanCounts = { used: 0, inOut: 0, sc: 0, traffic: 0, other: 0 };
  const clean: PreparedLap[] = [];
  for (const lap of visible) {
    const tag = tagLap(lap, medians.get(stintKey(lap)) ?? null);
    if (tag === "out-lap" || tag === "in-lap") counts.inOut += 1;
    else if (tag === "sc") counts.sc += 1;
    else if (tag === "traffic") counts.traffic += 1;
    else if (tag !== "ok") counts.other += 1;
    if (tag !== "ok") continue;
    const compoundId = asCompound(lap.compound);
    if (!compoundId) continue;
    const age =
      (lap.tyreAgeAtStart ?? 0) + (lap.stintStart != null ? lap.lapNumber - lap.stintStart : 0);
    clean.push({
      ...lap,
      compoundId,
      age: Math.max(0, age),
      raceLap: lap.lapNumber,
    });
  }

  let used = clean;
  const minLong = opts.minLongRun ?? 0;
  if (minLong > 1) {
    const byStint = new Map<string, PreparedLap[]>();
    for (const lap of clean) {
      const key = stintKey(lap);
      const list = byStint.get(key);
      if (list) list.push(lap);
      else byStint.set(key, [lap]);
    }
    used = [];
    for (const list of byStint.values()) {
      if (list.length >= minLong) used.push(...list);
    }
  }
  counts.used = used.length;
  return { clean: used, counts };
}

function qualityOf(actual: number[], pred: number[]): FitQuality {
  const n = Math.min(actual.length, pred.length);
  if (!n) return { r2: 0, n: 0, rmse: 0 };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += actual[i];
  mean /= n;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (actual[i] - mean) ** 2;
    ssRes += (actual[i] - pred[i]) ** 2;
  }
  const r2 = ssTot < 1e-9 ? 1 : 1 - ssRes / ssTot;
  return { r2, n, rmse: Math.sqrt(ssRes / n) };
}

function solve3(matrix: number[][], rhs: number[]): number[] | null {
  const A = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    }
    if (Math.abs(A[pivot][col]) < 1e-10) return null;
    const tmp = A[col];
    A[col] = A[pivot];
    A[pivot] = tmp;
    const div = A[col][col];
    for (let c = col; c < 4; c++) A[col][c] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = A[r][col];
      for (let c = col; c < 4; c++) A[r][c] -= factor * A[col][c];
    }
  }
  return [A[0][3], A[1][3], A[2][3]];
}

function multiReg(rows: { x1: number; x2: number; y: number }[]): { a: number; b1: number; b2: number } | null {
  if (rows.length < 4) return null;
  let n = 0;
  let s1 = 0;
  let s2 = 0;
  let sy = 0;
  let s11 = 0;
  let s22 = 0;
  let s12 = 0;
  let s1y = 0;
  let s2y = 0;
  for (const row of rows) {
    n += 1;
    s1 += row.x1;
    s2 += row.x2;
    sy += row.y;
    s11 += row.x1 * row.x1;
    s22 += row.x2 * row.x2;
    s12 += row.x1 * row.x2;
    s1y += row.x1 * row.y;
    s2y += row.x2 * row.y;
  }
  const solved = solve3(
    [
      [n, s1, s2],
      [s1, s11, s12],
      [s2, s12, s22],
    ],
    [sy, s1y, s2y],
  );
  if (!solved) return null;
  return { a: solved[0], b1: solved[1], b2: solved[2] };
}

/** Fuel from fresh-tyre laps spread through the race. Age and race lap are collinear inside one stint. */
function estimateFuel(laps: PreparedLap[]): number | null {
  const estimates: number[] = [];
  for (const compound of COMPOUNDS) {
    const fresh = laps.filter((lap) => lap.compoundId === compound && lap.age <= 1);
    if (fresh.length < 4) continue;
    const xs = fresh.map((lap) => lap.raceLap);
    const span = Math.max(...xs) - Math.min(...xs);
    if (span < 8) continue;
    const reg = linReg(xs, fresh.map((lap) => lap.lapTime as number));
    const fuel = -reg.slope;
    if (fuel >= -0.005 && fuel <= 0.1) estimates.push(clamp(fuel, 0, 0.08));
  }
  if (!estimates.length) return null;
  return median(estimates);
}

type Pt = { age: number; y: number; raw: number };

function fitCompoundCurve(
  pts: Pt[],
  baseLap: number,
): {
  offset: number;
  deg: number;
  shape: CurveShape;
  cliffLap: number;
  cliffDeg: number;
  quality: FitQuality;
} {
  const xs = pts.map((p) => p.age);
  const ys = pts.map((p) => p.y);
  const linear = linReg(xs, ys);
  const deg0 = Math.max(0, linear.slope);
  let best = {
    offset: linear.intercept - baseLap,
    deg: deg0,
    shape: "linear" as CurveShape,
    cliffLap: Math.max(8, Math.round(median(xs))),
    cliffDeg: 0,
    quality: qualityOf(ys, xs.map((age) => linear.intercept + deg0 * age)),
  };
  const maxAge = Math.max(...xs);
  if (pts.length >= 10 && maxAge >= 12) {
    for (let cliff = 8; cliff <= maxAge - 3; cliff += 1) {
      const reg = multiReg(
        pts.map((p) => ({
          x1: p.age,
          x2: Math.max(0, p.age - cliff),
          y: p.y,
        })),
      );
      if (!reg) continue;
      const deg = Math.max(0, reg.b1);
      const extra = reg.b2;
      if (extra < 0.04) continue;
      const pred = pts.map((p) => reg.a + deg * p.age + extra * Math.max(0, p.age - cliff));
      const quality = qualityOf(ys, pred);
      if (quality.r2 > best.quality.r2 + 0.02) {
        best = {
          offset: reg.a - baseLap,
          deg,
          shape: "cliff",
          cliffLap: cliff,
          cliffDeg: extra,
          quality,
        };
      }
    }
  }
  return best;
}

export function fitTyreModel(
  laps: FitLapInput[],
  base: TyreModel,
  opts: { mode: "practice" | "race"; untilMs?: number; label: string; sessionKey: number | null },
): { model: TyreModel; fit: TyreFitMeta } {
  const prepared = prepareFitLaps(laps, {
    minLongRun: opts.mode === "practice" ? 6 : null,
    untilMs: opts.untilMs,
  });
  const model = cloneModel(base);
  const fuel = estimateFuel(prepared.clean);
  if (fuel != null) model.fuelPerLap = fuel;

  const byCompound = new Map<CompoundId, Pt[]>();
  for (const lap of prepared.clean) {
    const y = (lap.lapTime as number) + model.fuelPerLap * lap.raceLap;
    const list = byCompound.get(lap.compoundId) ?? [];
    list.push({ age: lap.age, y, raw: lap.lapTime as number });
    byCompound.set(lap.compoundId, list);
  }

  const soft = byCompound.get("SOFT") ?? [];
  const softDefinesBase = soft.length >= 4;
  // Fit Soft against a zero base so `offset` is the chosen curve's intercept.
  // A cliff can beat the single linear regression and carry a different intercept;
  // that intercept is the Soft reference, not the discarded line.
  const softFit = softDefinesBase ? fitCompoundCurve(soft, 0) : null;
  if (softFit) model.baseLap = clamp(softFit.offset, 55, 140);

  const quality: TyreFitMeta["quality"] = {};
  const dots: ActualDot[] = [];
  for (const compound of COMPOUNDS) {
    const pts = byCompound.get(compound) ?? [];
    if (pts.length < 4) continue;
    const fitted = compound === "SOFT" && softFit ? softFit : fitCompoundCurve(pts, model.baseLap);
    const observedMax = Math.max(...pts.map((p) => p.age));
    // Soft was fitted at base 0, so rebase onto the (possibly clamped) reference.
    // Inside the clamp this is 0. Other compounds are already vs that reference.
    const offset = compound === "SOFT" && softFit ? softFit.offset - model.baseLap : fitted.offset;
    model.compounds[compound] = sanitizeCompound(
      {
        offset,
        degPerLap: fitted.deg,
        shape: fitted.shape,
        cliffLap: fitted.cliffLap,
        cliffDeg: fitted.shape === "cliff" ? fitted.cliffDeg : model.compounds[compound].cliffDeg,
        lifespan: Math.max(6, Math.round(observedMax)),
      },
      model.compounds[compound],
    );
    quality[compound] = fitted.quality;
    const step = Math.max(1, Math.ceil(pts.length / 70));
    pts.forEach((pt, index) => {
      if (index % step === 0) dots.push({ compound, age: pt.age, lapTime: pt.raw });
    });
  }

  return {
    model: sanitizeModel(model),
    fit: {
      source: opts.mode,
      label: opts.label,
      sessionKey: opts.sessionKey,
      quality,
      used: prepared.counts.used,
      excludedInOut: prepared.counts.inOut,
      excludedSc: prepared.counts.sc,
      excludedTraffic: prepared.counts.traffic,
      dots,
      edited: false,
    },
  };
}

function gapNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim() || /lap/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function latestGap(
  samples: { t: number; gap: number | null }[],
  start: number,
  end: number,
): number | null {
  let lo = 0;
  let hi = samples.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= end) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return null;
  for (let i = idx; i >= 0; i--) {
    if (samples[i].t < start - 2000) break;
    if (samples[i].gap != null && samples[i].t >= start) return samples[i].gap;
  }
  for (let i = idx; i >= 0; i--) {
    if (samples[i].t < start - 2000) break;
    if (samples[i].gap != null) return samples[i].gap;
  }
  return null;
}

/** Turn a session payload into fit rows. Exclusions are applied later by prepareFitLaps. */
export function fitLapsFromSession(data: {
  laps: Lap[];
  stints: Stint[];
  pits: Pit[];
  raceControl: RaceControl[];
  intervals: Interval[];
  sessionEnd: number;
}): FitLapInput[] {
  const stintsByDriver = new Map<number, Stint[]>();
  for (const stint of data.stints) {
    const list = stintsByDriver.get(stint.driver_number) ?? [];
    list.push(stint);
    stintsByDriver.set(stint.driver_number, list);
  }
  const pitLaps = new Set(data.pits.map((pit) => `${pit.driver_number}:${pit.lap_number}`));
  const bands = safetyCarBands(data.raceControl, data.sessionEnd);
  const gaps = new Map<number, { t: number; gap: number | null }[]>();
  for (const row of data.intervals) {
    const t = parseTs(row.date);
    if (!Number.isFinite(t)) continue;
    const list = gaps.get(row.driver_number) ?? [];
    list.push({ t, gap: gapNumber(row.interval) });
    gaps.set(row.driver_number, list);
  }
  for (const list of gaps.values()) list.sort((a, b) => a.t - b.t);

  const out: FitLapInput[] = [];
  for (const lap of data.laps) {
    const start = parseTs(lap.date_start);
    const stint =
      (stintsByDriver.get(lap.driver_number) ?? []).find(
        (s) => lap.lap_number >= (s.lap_start ?? 1) && lap.lap_number <= (s.lap_end ?? 9999),
      ) ?? null;
    const inSc =
      Number.isFinite(start) && bands.some((band) => start >= band.start && start <= band.end);
    out.push({
      driver: lap.driver_number,
      lapNumber: lap.lap_number,
      lapTime: lap.lap_duration,
      isPitOut: !!lap.is_pit_out_lap,
      dateStart: start,
      compound: stint?.compound ?? null,
      stintStart: stint?.lap_start ?? null,
      tyreAgeAtStart: stint?.tyre_age_at_start ?? null,
      isPitIn: pitLaps.has(`${lap.driver_number}:${lap.lap_number}`),
      inSc,
      interval:
        Number.isFinite(start) && lap.lap_duration
          ? latestGap(gaps.get(lap.driver_number) ?? [], start, start + lap.lap_duration * 1000)
          : null,
    });
  }
  return out;
}

export type PlanStint = {
  compound: CompoundId;
  laps: number;
  startAge: number;
  time: number;
};

export type RankedPlan = {
  stops: number;
  total: number;
  pitLoss: number;
  stints: PlanStint[];
  pitLaps: number[];
  deltaToBest: number;
};

export type DriverWindow = {
  from: CompoundId;
  to: CompoundId;
  raceStart: number;
  raceEnd: number;
  optimalLap: number;
};

export type StopSearchInput = {
  model: TyreModel;
  remaining: number;
  raceLap: number;
  currentCompound: CompoundId;
  currentAge: number;
  pitLoss: number;
  setsLeft: Partial<Record<CompoundId, number>>;
  ruleActive: boolean;
  anchor: number;
};

/** Extra time once a stint runs past its max useful life, so the lifespan slider moves the ranking. */
function overstay(age: number, lifespan: number): number {
  if (age < lifespan) return 0;
  return 0.25 * (age - lifespan + 1);
}

export function strategyLapTime(
  model: TyreModel,
  anchor: number,
  compound: CompoundId,
  age: number,
  raceLap: number,
): number {
  const spec = model.compounds[compound];
  return (
    anchor +
    spec.offset +
    lapTimeLoss(spec, age) -
    model.fuelPerLap * Math.max(0, raceLap) +
    overstay(age, spec.lifespan)
  );
}

function stintCost(
  model: TyreModel,
  anchor: number,
  compound: CompoundId,
  age0: number,
  laps: number,
  raceLap0: number,
): number {
  let total = 0;
  for (let i = 0; i < laps; i++) {
    total += strategyLapTime(model, anchor, compound, age0 + i, raceLap0 + i);
  }
  return total;
}

type WindowAcc = { best: number; bestLap: number; laps: { raceLap: number; total: number }[] };

export function buildStopPlans(input: StopSearchInput): {
  plans: RankedPlan[];
  excluded: number;
  windows: DriverWindow[];
} {
  const remaining = Math.max(2, Math.floor(input.remaining));
  const pool = COMPOUNDS.filter((compound) => {
    if (!input.ruleActive) {
      if (compound === input.currentCompound) return true;
      const left = input.setsLeft[compound];
      return left == null || left > 0;
    }
    if (!isDryCompound(compound) && compound !== input.currentCompound) return false;
    if (compound === input.currentCompound) return true;
    const left = input.setsLeft[compound];
    return left == null || left > 0;
  });

  let excluded = 0;
  const bestByStops = new Map<number, RankedPlan>();
  const windows = new Map<CompoundId, WindowAcc>();

  const consider = (stops: number, lengths: number[], seq: CompoundId[], trackWindow: boolean) => {
    if (seq.length !== lengths.length || seq[0] !== input.currentCompound) return;
    if (lengths.some((n) => n < 1) || lengths.reduce((a, b) => a + b, 0) !== remaining) return;
    const used: Partial<Record<CompoundId, number>> = {};
    for (let i = 1; i < seq.length; i++) {
      used[seq[i]] = (used[seq[i]] ?? 0) + 1;
      const left = input.setsLeft[seq[i]];
      if (left != null && (used[seq[i]] as number) > left) return;
    }
    const legal = planMeetsCompoundRule(seq, input.ruleActive);
    if (!legal) {
      excluded += 1;
      return;
    }
    let total = 0;
    let race = input.raceLap;
    const stints: PlanStint[] = [];
    const pitLaps: number[] = [];
    for (let i = 0; i < seq.length; i++) {
      const laps = lengths[i];
      const startAge = i === 0 ? input.currentAge : 0;
      const time = stintCost(input.model, input.anchor, seq[i], startAge, laps, race);
      stints.push({ compound: seq[i], laps, startAge, time });
      race += laps;
      if (i < seq.length - 1) pitLaps.push(input.raceLap + lengths.slice(0, i + 1).reduce((a, b) => a + b, 0));
      total += time;
    }
    total += input.pitLoss * stops;
    const prev = bestByStops.get(stops);
    if (!prev || total < prev.total - 1e-6) {
      bestByStops.set(stops, { stops, total, pitLoss: input.pitLoss * stops, stints, pitLaps, deltaToBest: 0 });
    }
    if (trackWindow && stops === 1) {
      const target = seq[1];
      const raceLap = input.raceLap + lengths[0];
      const acc = windows.get(target) ?? { best: Infinity, bestLap: raceLap, laps: [] };
      acc.laps.push({ raceLap, total });
      if (total < acc.best) {
        acc.best = total;
        acc.bestLap = raceLap;
      }
      windows.set(target, acc);
    }
  };

  const stepFor = (stops: number) => {
    if (stops === 1) return 1;
    const cells = stops === 2 ? 16 : 9;
    return Math.max(1, Math.round(remaining / cells));
  };

  for (const next of pool) {
    for (let a = 1; a < remaining; a += 1) {
      consider(1, [a, remaining - a], [input.currentCompound, next], true);
    }
    const cross = crossoverAge(input.model, input.currentCompound, next);
    if (cross != null) {
      const pitAfter = Math.round(cross - input.currentAge);
      if (pitAfter >= 1 && pitAfter < remaining) {
        consider(1, [pitAfter, remaining - pitAfter], [input.currentCompound, next], false);
      }
    }
  }

  const step2 = stepFor(2);
  for (let a = 1; a <= remaining - 2; a += step2) {
    for (let b = 1; b <= remaining - a - 1; b += step2) {
      const c = remaining - a - b;
      if (c < 1) continue;
      for (const n1 of pool) {
        for (const n2 of pool) {
          consider(2, [a, b, c], [input.currentCompound, n1, n2], false);
        }
      }
    }
  }

  const step3 = stepFor(3);
  for (let a = 1; a <= remaining - 3; a += step3) {
    for (let b = 1; b <= remaining - a - 2; b += step3) {
      for (let c = 1; c <= remaining - a - b - 1; c += step3) {
        const d = remaining - a - b - c;
        if (d < 1) continue;
        for (const n1 of pool) {
          for (const n2 of pool) {
            for (const n3 of pool) {
              consider(3, [a, b, c, d], [input.currentCompound, n1, n2, n3], false);
            }
          }
        }
      }
    }
  }

  const refine = (plan: RankedPlan) => {
    const seq = plan.stints.map((stint) => stint.compound);
    let lengths = plan.stints.map((stint) => stint.laps);
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let i = 0; i < lengths.length - 1; i++) {
        for (const delta of [-4, -2, -1, 1, 2, 4]) {
          const next = lengths.slice();
          next[i] += delta;
          next[next.length - 1] -= delta;
          if (next.some((n) => n < 1)) continue;
          const before = bestByStops.get(plan.stops)?.total ?? Infinity;
          consider(plan.stops, next, seq, false);
          const after = bestByStops.get(plan.stops)?.total ?? Infinity;
          if (after < before - 1e-6) {
            lengths = bestByStops.get(plan.stops)?.stints.map((stint) => stint.laps) ?? next;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
  };
  for (const plan of bestByStops.values()) refine(plan);

  const plans = [...bestByStops.values()].sort((a, b) => a.stops - b.stops);
  const bestTotal = plans.length ? Math.min(...plans.map((plan) => plan.total)) : 0;
  for (const plan of plans) plan.deltaToBest = plan.total - bestTotal;

  const driverWindows: DriverWindow[] = [];
  for (const [to, acc] of windows) {
    if (!Number.isFinite(acc.best)) continue;
    const near = new Set(
      acc.laps.filter((row) => row.total <= acc.best + 0.4).map((row) => row.raceLap),
    );
    if (!near.size) continue;
    let raceStart = acc.bestLap;
    let raceEnd = acc.bestLap;
    while (near.has(raceStart - 1)) raceStart -= 1;
    while (near.has(raceEnd + 1)) raceEnd += 1;
    driverWindows.push({
      from: input.currentCompound,
      to,
      raceStart,
      raceEnd,
      optimalLap: acc.bestLap,
    });
  }
  driverWindows.sort((a, b) => a.optimalLap - b.optimalLap);

  return { plans, excluded, windows: driverWindows };
}

export function formatPitWindows(windows: DriverWindow[]): string {
  if (!windows.length) return "No pit window inside the remaining distance.";
  return windows
    .map((window) => {
      const span =
        window.raceEnd !== window.raceStart ? `L${window.raceStart}–${window.raceEnd}` : `L${window.optimalLap}`;
      return `${compoundLetter(window.from)}→${compoundLetter(window.to)} ${span}`;
    })
    .join(" · ");
}

export function formatCrossovers(marks: CrossoverMark[]): string {
  if (!marks.length) return "No crossover inside the useful stints.";
  return marks
    .map((mark) => `${compoundLetter(mark.from)}→${compoundLetter(mark.to)} L${Math.round(mark.age)}`)
    .join(" · ");
}

function emptyStore(): TyreStore {
  return { model: defaultTyreModel(), fit: null };
}

export function readTyreStore(): TyreStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<TyreStore>;
    const fit = parsed.fit;
    return {
      model: sanitizeModel(parsed.model),
      fit: fit && (fit.source === "practice" || fit.source === "race")
        ? {
            source: fit.source,
            label: String(fit.label ?? ""),
            sessionKey: fit.sessionKey ?? null,
            quality: fit.quality ?? {},
            used: num(fit.used, 0),
            excludedInOut: num(fit.excludedInOut, 0),
            excludedSc: num(fit.excludedSc, 0),
            excludedTraffic: num(fit.excludedTraffic, 0),
            dots: Array.isArray(fit.dots)
              ? fit.dots
                  .map((dot) => ({
                    compound: asCompound(dot.compound) ?? "SOFT",
                    age: num(dot.age, 0),
                    lapTime: num(dot.lapTime, 0),
                  }))
                  .filter((dot) => dot.lapTime > 40)
                  .slice(0, 400)
              : [],
            edited: !!fit.edited,
          }
        : null,
    };
  } catch {
    return emptyStore();
  }
}

export function writeTyreStore(store: TyreStore): void {
  const clean: TyreStore = { model: sanitizeModel(store.model), fit: store.fit };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / quota */
  }
}

export function resetTyreStore(): TyreStore {
  const store = emptyStore();
  writeTyreStore(store);
  return store;
}

/** Mark the saved fit as edited so a stale R² is not shown after a slider move. */
export function editTyreModel(mutate: (model: TyreModel) => void): TyreStore {
  const store = readTyreStore();
  mutate(store.model);
  store.model = sanitizeModel(store.model);
  if (store.fit) store.fit = { ...store.fit, quality: {}, edited: true };
  writeTyreStore(store);
  return store;
}
