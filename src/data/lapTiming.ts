import { latestBefore, parseTs } from "../lib/time";
import { safetyCarBands, visibleLapTiming } from "./derive";
import type {
  Driver,
  Interval,
  Lap,
  Pit,
  Position,
  RaceControl,
  SectorKind,
  SessionBundle,
  Stint,
  TimingSnapshot,
  TowerRow,
} from "./types";

export const LAP_TIMING_VIEW_KEY = "f1pitwall.lapTimingView";
export const LAP_TIMING_MAX = 4;
export const LAP_CLIP_S = 4;

export type LapTimingView = "both" | "chart" | "table";

export function readLapTimingView(): LapTimingView {
  try {
    const raw = localStorage.getItem(LAP_TIMING_VIEW_KEY);
    if (raw === "chart" || raw === "table" || raw === "both") return raw;
  } catch {
    /* node tests */
  }
  return "both";
}

export function writeLapTimingView(view: LapTimingView): void {
  try {
    localStorage.setItem(LAP_TIMING_VIEW_KEY, view);
  } catch {
    /* quota */
  }
}

export function clampLapTimingDrivers(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= LAP_TIMING_MAX) break;
  }
  return out;
}

export function toggleLapTimingId(current: number[], id: number): number[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= LAP_TIMING_MAX) return current;
  return [...current, id];
}

/** Second selected driver of the same team is striped everywhere. */
export function stripedTeammates(drivers: Driver[]): Set<number> {
  const seen = new Set<string>();
  const striped = new Set<number>();
  for (const d of drivers) {
    const team = (d.team_name || "").trim().toLowerCase();
    if (!team) continue;
    if (seen.has(team)) striped.add(d.driver_number);
    else seen.add(team);
  }
  return striped;
}

function classify(time: number | null, personal: number | null, overall: number | null): SectorKind {
  if (time == null || !Number.isFinite(time)) return "none";
  if (overall != null && Math.abs(time - overall) < 0.0006) return "overall";
  if (personal != null && Math.abs(time - personal) < 0.0006) return "personal";
  return "yellow";
}

function minOf(values: Array<number | null | undefined>): number | null {
  let m = Infinity;
  for (const v of values) {
    if (v != null && Number.isFinite(v) && v > 0 && v < m) m = v;
  }
  return Number.isFinite(m) && m < Infinity ? m : null;
}

export function lapEndMs(lap: Lap): number {
  const start = parseTs(lap.date_start);
  if (!Number.isFinite(start)) return NaN;
  if (lap.lap_duration != null && Number.isFinite(lap.lap_duration) && lap.lap_duration > 0) {
    return start + lap.lap_duration * 1000;
  }
  return start;
}

function completed(lap: Lap, until: number): boolean {
  if (lap.lap_duration == null || !Number.isFinite(lap.lap_duration) || lap.lap_duration <= 0) return false;
  const end = lapEndMs(lap);
  return Number.isFinite(end) && end <= until;
}

export function yellowFlagLaps(events: RaceControl[]): Set<number> {
  const out = new Set<number>();
  for (const ev of events) {
    const flag = (ev.flag ?? "").toUpperCase();
    const msg = (ev.message ?? "").toUpperCase();
    const yellow = flag.includes("YELLOW") || msg.includes("YELLOW FLAG") || msg.includes("DOUBLE YELLOW");
    if (!yellow || ev.lap_number == null) continue;
    out.add(ev.lap_number);
  }
  return out;
}

export function scLapsFor(
  laps: Lap[],
  bands: TimingSnapshot["scBands"],
): { sc: Set<number>; vsc: Set<number> } {
  const sc = new Set<number>();
  const vsc = new Set<number>();
  if (!bands.length) return { sc, vsc };
  for (const lap of laps) {
    const start = parseTs(lap.date_start);
    const end = lapEndMs(lap);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (const band of bands) {
      if (end < band.start || start > band.end) continue;
      if (band.kind === "VSC") vsc.add(lap.lap_number);
      else sc.add(lap.lap_number);
    }
  }
  return { sc, vsc };
}

export type StintSpan = { compound: string; start: number; end: number; ageStart: number | null };

export function stintsForDriver(stints: Stint[], driver: number): StintSpan[] {
  return stints
    .filter((s) => s.driver_number === driver && s.lap_start != null)
    .sort((a, b) => (a.lap_start ?? 0) - (b.lap_start ?? 0))
    .map((s) => ({
      compound: (s.compound ?? "UNKNOWN").toUpperCase(),
      start: s.lap_start ?? 0,
      end: s.lap_end ?? s.lap_start ?? 0,
      ageStart: s.tyre_age_at_start,
    }));
}

export function tyreAtLap(stints: StintSpan[], lap: number): { compound: string | null; age: number | null } {
  const hit = [...stints].reverse().find((s) => lap >= s.start && (s.end <= 0 || lap <= s.end));
  if (!hit) return { compound: null, age: null };
  const age = hit.ageStart != null ? hit.ageStart + (lap - hit.start) : lap - hit.start + 1;
  return { compound: hit.compound, age };
}

export type DriverLapCell = {
  lap: number;
  time: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  timeKind: SectorKind;
  s1Kind: SectorKind;
  s2Kind: SectorKind;
  s3Kind: SectorKind;
  tyre: string | null;
  tyreAge: number | null;
  pos: number | null;
  i1: number | null;
  i2: number | null;
  st: number | null;
  gap: number | string | null;
  interval: number | string | null;
  deltaBest: number | null;
  deltaFirst: number | null;
  pitIn: boolean;
  pitOut: boolean;
  sc: boolean;
  vsc: boolean;
  yellow: boolean;
  inProgress: boolean;
};

export type DriverSummary = {
  driver: Driver;
  striped: boolean;
  bestLap: number | null;
  bestIsOverall: boolean;
  avgClean: number | null;
  cleanCount: number;
  stints: StintSpan[];
  topSpeed: number | null;
  topSpeedLap: number | null;
};

export type ListRow = {
  pos: number;
  driver: Driver;
  gap: number | string | null;
  selected: boolean;
  striped: boolean;
};

export type LapTimingModel = {
  list: ListRow[];
  selected: DriverSummary[];
  striped: Set<number>;
  laps: number[];
  cells: Map<number, Map<number, DriverLapCell>>;
  scLaps: Set<number>;
  vscLaps: Set<number>;
  yellowLaps: Set<number>;
  pitLaps: Map<number, { inn: boolean; out: boolean }>;
  bestTime: number | null;
  inProgressLap: number | null;
  live: boolean;
};

function pitSets(pits: Pit[], driver: number): { inn: Set<number>; out: Set<number> } {
  const inn = new Set<number>();
  const out = new Set<number>();
  for (const pit of pits) {
    if (pit.driver_number !== driver || pit.lap_number == null) continue;
    inn.add(pit.lap_number);
  }
  return { inn, out };
}

export function buildLapTimingModel(opts: {
  bundle: SessionBundle | null;
  snap: TimingSnapshot | null;
  selected: number[];
  now: number;
  live: boolean;
}): LapTimingModel {
  const empty: LapTimingModel = {
    list: [],
    selected: [],
    striped: new Set(),
    laps: [],
    cells: new Map(),
    scLaps: new Set(),
    vscLaps: new Set(),
    yellowLaps: new Set(),
    pitLaps: new Map(),
    bestTime: null,
    inProgressLap: null,
    live: opts.live,
  };
  const bundle = opts.bundle;
  if (!bundle) return empty;

  const rows = opts.snap?.rows ?? [];
  const byId = new Map(bundle.drivers.map((d) => [d.driver_number, d]));
  const ordered = rows.length
    ? rows.map((r) => r.driver)
    : [...bundle.drivers].sort((a, b) => a.driver_number - b.driver_number);

  const selectedIds = clampLapTimingDrivers(opts.selected.filter((id) => byId.has(id)));
  const selectedDrivers = selectedIds.map((id) => byId.get(id)!);
  const striped = stripedTeammates(selectedDrivers);

  const list: ListRow[] = ordered.map((d, i) => {
    const row = rows.find((r) => r.driver.driver_number === d.driver_number);
    return {
      pos: row?.pos ?? i + 1,
      driver: d,
      gap: row?.gap ?? null,
      selected: selectedIds.includes(d.driver_number),
      striped: striped.has(d.driver_number),
    };
  });

  const until = opts.now;
  const bands = opts.snap?.scBands ?? safetyCarBands(bundle.raceControl, parseTs(bundle.session.date_end));
  const flags = yellowFlagLaps(bundle.raceControl);
  const scMap = scLapsFor(bundle.laps, bands);

  const positions = [...bundle.positions].sort((a, b) => parseTs(a.date) - parseTs(b.date));
  const intervals = [...bundle.intervals].sort((a, b) => parseTs(a.date) - parseTs(b.date));

  const driverLaps = new Map<number, Lap[]>();
  for (const lap of bundle.laps) {
    const listL = driverLaps.get(lap.driver_number) ?? [];
    listL.push(lap);
    driverLaps.set(lap.driver_number, listL);
  }
  for (const listL of driverLaps.values()) listL.sort((a, b) => a.lap_number - b.lap_number);

  const cells = new Map<number, Map<number, DriverLapCell>>();
  const summaries: DriverSummary[] = [];
  let maxLap = 0;
  let inProgressLap: number | null = null;
  const pitLaps = new Map<number, { inn: boolean; out: boolean }>();

  const personal: Map<number, { lap: number | null; s1: number | null; s2: number | null; s3: number | null }> = new Map();

  for (const id of selectedIds) {
    const laps = driverLaps.get(id) ?? [];
    const revealed = laps
      .filter((l) => {
        const start = parseTs(l.date_start);
        return Number.isFinite(start) && start <= until;
      })
      .map((l) => visibleLapTiming(l, until));
    personal.set(id, {
      lap: minOf(revealed.map((v) => v.time)),
      s1: minOf(revealed.map((v) => v.s1)),
      s2: minOf(revealed.map((v) => v.s2)),
      s3: minOf(revealed.map((v) => v.s3)),
    });
  }
  const overall = {
    lap: minOf([...personal.values()].map((p) => p.lap)),
    s1: minOf([...personal.values()].map((p) => p.s1)),
    s2: minOf([...personal.values()].map((p) => p.s2)),
    s3: minOf([...personal.values()].map((p) => p.s3)),
  };

  for (const id of selectedIds) {
    const driver = byId.get(id)!;
    const laps = driverLaps.get(id) ?? [];
    const pits = pitSets(bundle.pits, id);
    const stintSpans = stintsForDriver(bundle.stints, id);
    const pb = personal.get(id)!;
    const byLap = new Map<number, DriverLapCell>();
    const cleanTimes: number[] = [];
    let topSpeed: number | null = null;
    let topSpeedLap: number | null = null;

    for (const lap of laps) {
      const isDone = completed(lap, until);
      const start = parseTs(lap.date_start);
      const inProgress = !isDone && Number.isFinite(start) && start <= until;
      if (!isDone && !inProgress) continue;
      maxLap = Math.max(maxLap, lap.lap_number);
      if (inProgress) inProgressLap = Math.max(inProgressLap ?? 0, lap.lap_number);

      const pitOut = !!lap.is_pit_out_lap;
      const pitIn = pits.inn.has(lap.lap_number);
      const sc = scMap.sc.has(lap.lap_number);
      const vsc = scMap.vsc.has(lap.lap_number);
      const yellow = flags.has(lap.lap_number);
      const end = isDone ? lapEndMs(lap) : until;
      const posEvt = Number.isFinite(end)
        ? latestBefore(
            positions.filter((p) => p.driver_number === id),
            end,
            (p: Position) => parseTs(p.date),
          )
        : null;
      const intEvt = Number.isFinite(end)
        ? latestBefore(
            intervals.filter((p) => p.driver_number === id),
            end,
            (p: Interval) => parseTs(p.date),
          )
        : null;
      const tyre = tyreAtLap(stintSpans, lap.lap_number);
      const vis = visibleLapTiming(lap, until);
      const time = vis.time;
      const s1 = vis.s1;
      const s2 = vis.s2;
      const s3 = vis.s3;
      if (isDone && time != null && !pitIn && !pitOut && !sc && !vsc) cleanTimes.push(time);
      const st = vis.st;
      if (st != null && (topSpeed == null || st > topSpeed)) {
        topSpeed = st;
        topSpeedLap = lap.lap_number;
      }
      const prev = pitLaps.get(lap.lap_number) ?? { inn: false, out: false };
      pitLaps.set(lap.lap_number, { inn: prev.inn || pitIn, out: prev.out || pitOut });

      byLap.set(lap.lap_number, {
        lap: lap.lap_number,
        time,
        s1,
        s2,
        s3,
        timeKind: classify(time, pb.lap, overall.lap),
        s1Kind: classify(s1, pb.s1, overall.s1),
        s2Kind: classify(s2, pb.s2, overall.s2),
        s3Kind: classify(s3, pb.s3, overall.s3),
        tyre: tyre.compound,
        tyreAge: tyre.age,
        pos: posEvt?.position ?? null,
        i1: vis.i1,
        i2: vis.i2,
        st,
        gap: intEvt?.gap_to_leader ?? null,
        interval: intEvt?.interval ?? null,
        deltaBest: time != null && pb.lap != null ? time - pb.lap : null,
        deltaFirst: null,
        pitIn,
        pitOut,
        sc,
        vsc,
        yellow,
        inProgress,
      });
    }

    cells.set(id, byLap);
    summaries.push({
      driver,
      striped: striped.has(id),
      bestLap: pb.lap,
      bestIsOverall: pb.lap != null && overall.lap != null && Math.abs(pb.lap - overall.lap) < 0.0006,
      avgClean: cleanTimes.length ? cleanTimes.reduce((a, b) => a + b, 0) / cleanTimes.length : null,
      cleanCount: cleanTimes.length,
      stints: stintSpans,
      topSpeed,
      topSpeedLap,
    });
  }

  const firstId = selectedIds[0];
  if (firstId != null) {
    const firstCells = cells.get(firstId);
    for (const id of selectedIds.slice(1)) {
      const map = cells.get(id);
      if (!map) continue;
      for (const [lapNo, cell] of map) {
        const other = firstCells?.get(lapNo);
        cell.deltaFirst = cell.time != null && other?.time != null ? cell.time - other.time : null;
      }
    }
  }

  const lapSet = new Set<number>();
  for (const map of cells.values()) for (const n of map.keys()) lapSet.add(n);
  const laps = [...lapSet].sort((a, b) => a - b);

  return {
    list,
    selected: summaries,
    striped,
    laps,
    cells,
    scLaps: scMap.sc,
    vscLaps: scMap.vsc,
    yellowLaps: flags,
    pitLaps,
    bestTime: overall.lap,
    inProgressLap,
    live: opts.live,
  };
}

export function defaultLapTimingDrivers(snap: TimingSnapshot | null, fallback: number[]): number[] {
  if (fallback.length) return clampLapTimingDrivers(fallback);
  const leader = snap?.rows[0]?.driver.driver_number;
  return leader != null ? [leader] : [];
}

export function barHeightFrac(time: number | null, best: number | null, clip = LAP_CLIP_S): number {
  if (time == null || best == null || time <= 0) return 0;
  return Math.min(1, Math.max(0.04, (time - best) / clip));
}

export function seedFromTower(rows: TowerRow[] | undefined, current: number[]): number[] {
  if (current.length) return clampLapTimingDrivers(current);
  const first = rows?.[0]?.driver.driver_number;
  return first != null ? [first] : [];
}
