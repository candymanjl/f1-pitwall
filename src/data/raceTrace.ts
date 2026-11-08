import { latestBefore, parseTs } from "../lib/time";
import { teamColor } from "../lib/colors";
import { scheduledRaceLaps } from "./raceDistance";
import type { Driver, Lap, Pit, Position, Session, SessionBundle } from "./types";

export const RACE_TRACE_Y_KEY = "f1pitwall.raceTraceYAxis";
export type RaceTraceYAxis = "gap" | "position";
export type GapMode = "leader" | "average" | "driver";

export type TracePt = { lap: number; y: number; pit: boolean; endMs: number };
export type TraceSeries = { driver: number; code: string; color: string; pts: TracePt[] };

export function readRaceTraceYAxis(): RaceTraceYAxis {
  try {
    const raw = localStorage.getItem(RACE_TRACE_Y_KEY);
    if (raw === "position" || raw === "gap") return raw;
  } catch {
    /* node tests */
  }
  return "gap";
}

export function writeRaceTraceYAxis(axis: RaceTraceYAxis): void {
  try {
    localStorage.setItem(RACE_TRACE_Y_KEY, axis);
  } catch {
    /* quota */
  }
}

export function lapEndMs(lap: Pick<Lap, "date_start" | "lap_duration">): number {
  const start = parseTs(lap.date_start);
  if (!Number.isFinite(start) || lap.lap_duration == null || lap.lap_duration <= 0) return NaN;
  return start + lap.lap_duration * 1000;
}

export function isPitLap(pits: Pit[], driver: number, lap: Lap): boolean {
  if (lap.is_pit_out_lap) return true;
  return pits.some((p) => p.driver_number === driver && p.lap_number === lap.lap_number);
}

/** Highest fully completed lap at or before the playhead. */
export function playheadLap(laps: Lap[] | null | undefined, now: number): number {
  let max = 0;
  for (const lap of laps ?? []) {
    const end = lapEndMs(lap);
    if (!Number.isFinite(end) || end > now) continue;
    if (lap.lap_number > max) max = lap.lap_number;
  }
  return max;
}

export function traceXMax(
  session: Pick<Session, "session_name" | "session_type" | "circuit_short_name"> | null | undefined,
  laps: Lap[] | null | undefined,
  now: number,
): number {
  const scheduled = scheduledRaceLaps(session) ?? 0;
  const seen = Math.max(playheadLap(laps, now), ...((laps ?? []).map((l) => l.lap_number) || [0]));
  return Math.max(10, scheduled, seen);
}

function lapsByDriver(laps: Lap[]): Map<number, Lap[]> {
  const map = new Map<number, Lap[]>();
  for (const lap of laps) {
    const list = map.get(lap.driver_number) ?? [];
    list.push(lap);
    map.set(lap.driver_number, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.lap_number - b.lap_number);
  return map;
}

function completedAt(laps: Lap[], now: number): Lap[] {
  return laps.filter((lap) => {
    const end = lapEndMs(lap);
    return Number.isFinite(end) && end <= now;
  });
}

/** Race position at the end of `lap`. OpenF1 first, else finishing order of that lap. */
export function positionAtLapEnd(
  positions: Position[],
  finishers: Array<{ driver: number; endMs: number }>,
  driver: number,
  lapEnd: number,
): number | null {
  const ofDriver = positions.filter((row) => row.driver_number === driver);
  const hit = latestBefore(ofDriver, lapEnd + 1500, (row) => parseTs(row.date));
  if (hit && hit.position > 0) return hit.position;
  const order = [...finishers].filter((row) => Number.isFinite(row.endMs)).sort((a, b) => a.endMs - b.endMs);
  const idx = order.findIndex((row) => row.driver === driver);
  return idx >= 0 ? idx + 1 : null;
}

export function gapSeries(opts: {
  drivers: Driver[];
  laps: Lap[];
  pits: Pit[];
  hidden: number[];
  mode: GapMode;
  refDriver: number | null;
  now: number;
}): TraceSeries[] {
  const hidden = new Set(opts.hidden);
  const byDriver = lapsByDriver(opts.laps);
  const maxLap = Math.max(1, ...opts.laps.map((l) => l.lap_number), 1);
  const cum = new Map<number, number[]>();
  for (const [dn, laps] of byDriver) {
    const arr: number[] = [];
    let t = 0;
    for (let i = 1; i <= maxLap; i++) {
      const hit = laps.find((l) => l.lap_number === i);
      if (hit?.lap_duration) {
        t += hit.lap_duration;
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
  const refDriver = opts.refDriver ?? opts.drivers[0]?.driver_number;
  const out: TraceSeries[] = [];
  for (const d of opts.drivers) {
    if (hidden.has(d.driver_number)) continue;
    const laps = completedAt(byDriver.get(d.driver_number) ?? [], opts.now);
    const c = cum.get(d.driver_number) ?? [];
    const pts: TracePt[] = [];
    for (const lap of laps) {
      const mine = c[lap.lap_number];
      if (!(mine > 0)) continue;
      let y = 0;
      if (opts.mode === "average") y = mine - (avg[lap.lap_number] ?? 0);
      else if (opts.mode === "driver") {
        const ref = cum.get(refDriver)?.[lap.lap_number] ?? 0;
        y = ref ? mine - ref : 0;
      } else {
        const leaderCum = Math.min(...[...cum.values()].map((a) => a[lap.lap_number] || Infinity));
        y = mine - leaderCum;
      }
      pts.push({
        lap: lap.lap_number,
        y,
        pit: isPitLap(opts.pits, d.driver_number, lap),
        endMs: lapEndMs(lap),
      });
    }
    out.push({ driver: d.driver_number, code: d.name_acronym, color: teamColor(d.team_colour), pts });
  }
  return out;
}

export function positionSeries(opts: {
  drivers: Driver[];
  laps: Lap[];
  pits: Pit[];
  positions: Position[];
  hidden: number[];
  now: number;
}): TraceSeries[] {
  const hidden = new Set(opts.hidden);
  const byDriver = lapsByDriver(opts.laps);
  const positions = [...opts.positions].sort((a, b) => parseTs(a.date) - parseTs(b.date));
  const maxLap = Math.max(1, ...opts.laps.map((l) => l.lap_number), 1);
  const finishersByLap = new Map<number, Array<{ driver: number; endMs: number }>>();
  for (let n = 1; n <= maxLap; n++) {
    const rows: Array<{ driver: number; endMs: number }> = [];
    for (const [dn, laps] of byDriver) {
      const lap = laps.find((l) => l.lap_number === n);
      if (!lap) continue;
      const end = lapEndMs(lap);
      if (!Number.isFinite(end) || end > opts.now) continue;
      rows.push({ driver: dn, endMs: end });
    }
    finishersByLap.set(n, rows);
  }
  const out: TraceSeries[] = [];
  for (const d of opts.drivers) {
    if (hidden.has(d.driver_number)) continue;
    const laps = completedAt(byDriver.get(d.driver_number) ?? [], opts.now);
    const pts: TracePt[] = [];
    for (const lap of laps) {
      const end = lapEndMs(lap);
      if (!Number.isFinite(end)) continue;
      const y = positionAtLapEnd(positions, finishersByLap.get(lap.lap_number) ?? [], d.driver_number, end);
      if (y == null) continue;
      pts.push({
        lap: lap.lap_number,
        y,
        pit: isPitLap(opts.pits, d.driver_number, lap),
        endMs: end,
      });
    }
    out.push({ driver: d.driver_number, code: d.name_acronym, color: teamColor(d.team_colour), pts });
  }
  return out;
}

export function fieldSize(series: TraceSeries[], driverCount: number): number {
  const maxP = Math.max(0, ...series.flatMap((s) => s.pts.map((p) => p.y)));
  return Math.max(2, driverCount, Math.ceil(maxP));
}

export function traceSeries(
  bundle: SessionBundle | null | undefined,
  opts: { axis: RaceTraceYAxis; gapMode: GapMode; refDriver: number | null; hidden: number[]; now: number },
): TraceSeries[] {
  if (!bundle) return [];
  const base = {
    drivers: bundle.drivers,
    laps: bundle.laps,
    pits: bundle.pits,
    hidden: opts.hidden,
    now: opts.now,
  };
  if (opts.axis === "position") {
    return positionSeries({ ...base, positions: bundle.positions });
  }
  return gapSeries({ ...base, mode: opts.gapMode, refDriver: opts.refDriver });
}
