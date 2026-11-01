import type { Lap, SectorKind } from "../data/types";
import { parseTs } from "../lib/time";

/** OpenF1 segment codes on `/laps` `segments_sector_*`. */
export const SEG_YELLOW = 2048;
export const SEG_PERSONAL = 2049;
export const SEG_OVERALL = 2051;
export const SEG_PIT = 2064;

export type MiniCode = number | null;

export type MiniGroups = {
  s1: MiniCode[];
  s2: MiniCode[];
  s3: MiniCode[];
};

export type SectorReadout = {
  time: number | null;
  kind: SectorKind;
  /** True when this is the previous lap, still shown until the new sector finishes. */
  held: boolean;
  /** Seconds versus the same sector on the lap before the one shown. Negative is faster. */
  delta: number | null;
};

export type DriverTiming = {
  s1: SectorReadout;
  s2: SectorReadout;
  s3: SectorReadout;
  minis: MiniGroups;
};

export type MiniSlots = { s1: number; s2: number; s3: number };

type Which = "s1" | "s2" | "s3";

const WHICH: Which[] = ["s1", "s2", "s3"];

function durationOf(lap: Lap, which: Which): number | null {
  const value = which === "s1" ? lap.duration_sector_1 : which === "s2" ? lap.duration_sector_2 : lap.duration_sector_3;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function segmentsOf(lap: Lap, which: Which): Array<number | null> | null {
  if (which === "s1") return lap.segments_sector_1;
  if (which === "s2") return lap.segments_sector_2;
  return lap.segments_sector_3;
}

/** Same completion rules as `visibleLapTiming`: a sector appears only after its clock elapses. */
export function sectorFlags(lap: Lap, now: number): Record<Which, boolean> {
  const start = parseTs(lap.date_start);
  if (!Number.isFinite(start)) return { s1: false, s2: false, s3: false };
  const s1 = lap.duration_sector_1;
  const s2 = lap.duration_sector_2;
  const s3 = lap.duration_sector_3;
  const lapDone = lap.lap_duration != null && start + lap.lap_duration * 1000 <= now;
  const s1Done = lapDone || (s1 != null && start + s1 * 1000 <= now);
  const s2Done = lapDone || (s1Done && s2 != null && start + ((s1 ?? 0) + s2) * 1000 <= now);
  const s3Done = lapDone || (s2Done && s3 != null && start + ((s1 ?? 0) + (s2 ?? 0) + s3) * 1000 <= now);
  return { s1: s1Done, s2: s2Done, s3: s3Done };
}

function currentLap(laps: Lap[], now: number): Lap | null {
  let best: Lap | null = null;
  let bestStart = -Infinity;
  for (const lap of laps) {
    const start = parseTs(lap.date_start);
    if (!Number.isFinite(start) || start > now) continue;
    if (start >= bestStart) {
      best = lap;
      bestStart = start;
    }
  }
  return best;
}

function previousLap(laps: Lap[], cur: Lap | null): Lap | null {
  let best: Lap | null = null;
  for (const lap of laps) {
    if (cur && lap.lap_number >= cur.lap_number) continue;
    if (!best || lap.lap_number > best.lap_number) best = lap;
  }
  return best;
}

function classify(time: number | null, personal: number | null, overall: number | null): SectorKind {
  if (time == null) return "none";
  if (overall != null && Math.abs(time - overall) < 0.0006) return "overall";
  if (personal != null && Math.abs(time - personal) < 0.0006) return "personal";
  return "yellow";
}

function bests(laps: Lap[], now: number): Record<Which, number | null> {
  const best: Record<Which, number> = { s1: Infinity, s2: Infinity, s3: Infinity };
  for (const lap of laps) {
    const flags = sectorFlags(lap, now);
    for (const which of WHICH) {
      if (!flags[which]) continue;
      const time = durationOf(lap, which);
      if (time != null && time > 0 && time < best[which]) best[which] = time;
    }
  }
  return {
    s1: best.s1 === Infinity ? null : best.s1,
    s2: best.s2 === Infinity ? null : best.s2,
    s3: best.s3 === Infinity ? null : best.s3,
  };
}

/** Widest mini-sector list in the session, so every row lines up. */
export function sessionMiniSlots(laps: Lap[]): MiniSlots {
  const slots: MiniSlots = { s1: 0, s2: 0, s3: 0 };
  for (const lap of laps) {
    for (const which of WHICH) {
      const n = segmentsOf(lap, which)?.length ?? 0;
      if (n > slots[which]) slots[which] = n;
    }
  }
  return slots;
}

/** Sector clock in seconds from the lap start. Missing times fall back to a typical split of the lap. */
function sectorWindow(lap: Lap, which: Which): { start: number; dur: number } | null {
  const s1 = durationOf(lap, "s1");
  const s2 = durationOf(lap, "s2");
  const s3 = durationOf(lap, "s3");
  if (which === "s1" && s1) return { start: 0, dur: s1 };
  if (which === "s2" && s1 && s2) return { start: s1, dur: s2 };
  if (which === "s3" && s1 && s2 && s3) return { start: s1 + s2, dur: s3 };
  const known = [s1, s2, s3].filter((n): n is number => n != null && n > 0);
  const lapDur = lap.lap_duration && lap.lap_duration > 0 ? lap.lap_duration : known.length === 3 ? known.reduce((a, b) => a + b, 0) : null;
  if (!lapDur) return null;
  const fracs = [0.33, 0.39, 0.28];
  const idx = which === "s1" ? 0 : which === "s2" ? 1 : 2;
  let start = 0;
  for (let i = 0; i < idx; i++) start += lapDur * fracs[i];
  return { start, dur: lapDur * fracs[idx] };
}

function emptyMinis(slots: number): MiniCode[] {
  return Array.from({ length: Math.max(0, slots) }, () => null);
}

function segmentCount(lap: Lap, which: Which, slots: number): number {
  const n = segmentsOf(lap, which)?.length ?? 0;
  return Math.max(1, n || slots);
}

/** Seconds from the lap start until mini-sector `index` (0-based) is complete. */
function miniDoneAt(lap: Lap, which: Which, index: number, slots: number): number | null {
  const window = sectorWindow(lap, which);
  if (!window || window.dur <= 0) return null;
  const count = segmentCount(lap, which, slots);
  return window.start + ((index + 1) / count) * window.dur;
}

function paintCodes(lap: Lap | null, which: Which, slots: number, revealed: number): MiniCode[] {
  const out = emptyMinis(slots);
  if (!lap) return out;
  const src = segmentsOf(lap, which) ?? [];
  const limit = Math.min(slots, revealed);
  for (let i = 0; i < limit; i++) {
    const code = src[i];
    out[i] = typeof code === "number" ? code : null;
  }
  return out;
}

/** Every stored block, including the last S3 segment that finishes on the line. */
function fullMinis(lap: Lap | null, which: Which, slots: number): MiniCode[] {
  return paintCodes(lap, which, slots, slots);
}

/**
 * Blocks 0..n-1 light when that slice of the sector clock has elapsed.
 * Index 0 completes at 1/n, so it is the first block, not the second.
 */
function partialMinis(lap: Lap, which: Which, now: number, slots: number): MiniCode[] {
  const startMs = parseTs(lap.date_start);
  if (!Number.isFinite(startMs) || now < startMs || slots <= 0) return emptyMinis(slots);
  const window = sectorWindow(lap, which);
  if (!window || window.dur <= 0) return emptyMinis(slots);
  const elapsed = (now - startMs) / 1000;
  const count = segmentCount(lap, which, slots);
  const lapDone = lap.lap_duration != null && startMs + lap.lap_duration * 1000 <= now;
  let revealed = 0;
  if (lapDone || elapsed + 1e-6 >= window.start + window.dur) revealed = slots;
  else if (elapsed >= window.start) {
    const slice = window.dur / count;
    revealed = Math.min(count, Math.floor((elapsed - window.start + 1e-6) / slice));
  }
  return paintCodes(lap, which, slots, revealed);
}

export function formatSectorDelta(delta: number): string {
  const abs = Math.abs(delta).toFixed(3);
  if (delta > 0.0005) return `(+${abs})`;
  if (delta < -0.0005) return `(-${abs})`;
  return `(${abs})`;
}

export function segmentClass(code: MiniCode): string {
  if (code === SEG_OVERALL) return "seg-overall";
  if (code === SEG_PERSONAL) return "seg-personal";
  if (code === SEG_YELLOW) return "seg-yellow";
  if (code === SEG_PIT) return "seg-pit";
  return "seg-none";
}

export function segmentLabel(code: MiniCode): string {
  if (code === SEG_OVERALL) return "Overall best";
  if (code === SEG_PERSONAL) return "Personal best";
  if (code === SEG_YELLOW) return "Slower than personal best";
  if (code === SEG_PIT) return "Pit lane";
  return "No mini sector yet";
}

/**
 * Sector times and mini-sectors for one driver at the replay clock.
 * A finished lap keeps every block, including the last S3 segment, until the
 * first S1 mini-sector of the next lap completes. That moment lights block 1
 * and clears the rest. A sector time stays on the previous lap until the new one completes.
 */
export function driverTimingAt(laps: Lap[], driver: number, now: number, slots: MiniSlots): DriverTiming {
  const mine = laps.filter((lap) => lap.driver_number === driver);
  const cur = currentLap(mine, now);
  const prev = previousLap(mine, cur);
  const flags = cur ? sectorFlags(cur, now) : { s1: false, s2: false, s3: false };
  const personal = bests(mine, now);
  const overall = bests(laps, now);

  const holdFinished = (() => {
    if (!cur || !prev) return false;
    const start = parseTs(cur.date_start);
    if (!Number.isFinite(start) || now < start) return false;
    const firstEnd = miniDoneAt(cur, "s1", 0, slots.s1);
    if (firstEnd == null) return false;
    return (now - start) / 1000 + 1e-9 < firstEnd;
  })();

  const priorTime = (lap: Lap | null, which: Which): number | null => {
    if (!lap || !sectorFlags(lap, now)[which]) return null;
    return durationOf(lap, which);
  };

  const readout = (which: Which): SectorReadout => {
    const shown = cur && flags[which] ? cur : prev;
    const held = !(cur && flags[which]);
    const time = shown ? priorTime(shown, which) : null;
    const before = shown ? previousLap(mine, shown) : null;
    const earlier = priorTime(before, which);
    const delta = time != null && earlier != null ? time - earlier : null;
    return { time, kind: classify(time, personal[which], overall[which]), held: held && time != null, delta };
  };

  return {
    s1: readout("s1"),
    s2: readout("s2"),
    s3: readout("s3"),
    minis: (() => {
      const lap = holdFinished ? prev : cur ?? prev;
      if (!lap) {
        return { s1: emptyMinis(slots.s1), s2: emptyMinis(slots.s2), s3: emptyMinis(slots.s3) };
      }
      if (holdFinished) {
        return {
          s1: fullMinis(lap, "s1", slots.s1),
          s2: fullMinis(lap, "s2", slots.s2),
          s3: fullMinis(lap, "s3", slots.s3),
        };
      }
      return {
        s1: partialMinis(lap, "s1", now, slots.s1),
        s2: partialMinis(lap, "s2", now, slots.s2),
        s3: partialMinis(lap, "s3", now, slots.s3),
      };
    })(),
  };
}
