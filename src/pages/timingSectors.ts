import type { Lap, SectorKind } from "../data/types";
import { displayedSource, motionFade, smoothedFrac } from "../lib/carMotion";
import { parseTs } from "../lib/time";

/** OpenF1 segment codes on `/laps` `segments_sector_*`. */
export const SEG_YELLOW = 2048;
export const SEG_PERSONAL = 2049;
export const SEG_OVERALL = 2051;
export const SEG_PIT = 2064;
/** Lit, but OpenF1 has not sent a colour for this block yet. */
export const SEG_PROVISIONAL = -1;

export type SectorSplit = [number, number, number];

/** Optional GPS progress. The timing page passes the smoothed on-track fraction. */
export type TimingFix = {
  /** 0 at the start/finish line, increasing around the lap. Null skips GPS. */
  progress?: number | null;
  /** Sector lengths along the outline, the same split the track map draws. */
  sectorFracs?: SectorSplit | null;
};

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

type SectorEnds = { s1: number; s2: number };

/** Outline split the map can trust. Lengths must each be a real slice of one lap. */
export function reliableSectorEnds(fracs: SectorSplit | null | undefined): SectorEnds | null {
  if (!fracs) return null;
  const [a, b, c] = fracs;
  if (![a, b, c].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0.05)) return null;
  const sum = a + b + c;
  if (sum < 0.85 || sum > 1.15) return null;
  return { s1: a / sum, s2: (a + b) / sum };
}

function sectorSpan(which: Which, ends: SectorEnds): { start: number; end: number } {
  if (which === "s1") return { start: 0, end: ends.s1 };
  if (which === "s2") return { start: ends.s1, end: ends.s2 };
  return { start: ends.s2, end: 1 };
}

/** How many mini-sectors are finished at this on-track fraction. */
export function revealedByProgress(frac: number, which: Which, ends: SectorEnds, count: number): number {
  if (count <= 0 || !Number.isFinite(frac)) return 0;
  const f = ((frac % 1) + 1) % 1;
  const { start, end } = sectorSpan(which, ends);
  const span = end - start;
  if (span <= 1e-6) return 0;
  if (f < start - 1e-4) return 0;
  if (f >= end - 1e-4) return count;
  return Math.min(count, Math.floor(((f - start) / span) * count + 1e-6));
}

/**
 * Smoothed GPS fraction for mini-sectors.
 * Only a fresh on-track location fix counts. Pit snaps, gap guesses, and a faded icon do not.
 */
export function gpsProgressForMinis(driver: number, now: number): number | null {
  if (displayedSource(driver) !== "location") return null;
  if (motionFade(driver, now) < 1) return null;
  const frac = smoothedFrac(driver, Number.NaN);
  return Number.isFinite(frac) ? ((frac % 1) + 1) % 1 : null;
}

type Estimates = Record<Which, number | null>;

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Sector clock in seconds from the lap start. Missing times use an estimate, then a typical split. */
function sectorWindow(lap: Lap, which: Which, estimates?: Estimates): { start: number; dur: number } | null {
  const own = (part: Which) => durationOf(lap, part) ?? positive(estimates?.[part]);
  const s1 = own("s1");
  const s2 = own("s2");
  const s3 = own("s3");
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
function miniDoneAt(lap: Lap, which: Which, index: number, slots: number, estimates?: Estimates): number | null {
  const window = sectorWindow(lap, which, estimates);
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

/** How many mini-sectors of this sector the car has finished at `now`. */
function revealedMinis(lap: Lap, which: Which, now: number, slots: number, estimates?: Estimates): number {
  const startMs = parseTs(lap.date_start);
  if (!Number.isFinite(startMs) || now < startMs || slots <= 0) return 0;
  const window = sectorWindow(lap, which, estimates);
  if (!window || window.dur <= 0) return 0;
  const elapsed = (now - startMs) / 1000;
  const count = segmentCount(lap, which, slots);
  const lapDone = lap.lap_duration != null && startMs + lap.lap_duration * 1000 <= now;
  if (lapDone || elapsed + 1e-6 >= window.start + window.dur) return slots;
  if (elapsed < window.start) return 0;
  const slice = window.dur / count;
  return Math.min(count, Math.floor((elapsed - window.start + 1e-6) / slice));
}

function miniForKind(kind: SectorKind): MiniCode {
  if (kind === "overall") return SEG_OVERALL;
  if (kind === "personal") return SEG_PERSONAL;
  return SEG_YELLOW;
}

/**
 * OpenF1 often stores nothing in S1 segment 1. Once the car is past that block,
 * paint it from the S1 time: purple or green when that time is the best, otherwise yellow.
 * A real pit-lane code, and any colour OpenF1 did send, stays as stored.
 */
function fillS1Block1(painted: MiniCode[], lap: Lap, revealed: number, now: number, personalS1: number | null, overallS1: number | null): MiniCode[] {
  if (revealed < 1 || painted.length === 0) return painted;
  const first = painted[0];
  if (first === SEG_PIT || first === SEG_YELLOW || first === SEG_PERSONAL || first === SEG_OVERALL) return painted;
  const done = sectorFlags(lap, now).s1;
  const kind = done ? classify(durationOf(lap, "s1"), personalS1, overallS1) : "yellow";
  const out = painted.slice();
  out[0] = miniForKind(kind);
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
function isRealCode(code: MiniCode): boolean {
  return code === SEG_YELLOW || code === SEG_PERSONAL || code === SEG_OVERALL || code === SEG_PIT;
}

function hasRealCodes(lap: Lap, which: Which): boolean {
  return (segmentsOf(lap, which) ?? []).some((code) => isRealCode(code));
}

/** Lit blocks with no OpenF1 colour yet. Completed sectors keep the stored codes. */
function provisionalMinis(revealed: number, slots: number): MiniCode[] {
  const out = emptyMinis(slots);
  const limit = Math.min(slots, Math.max(0, revealed));
  for (let i = 0; i < limit; i++) out[i] = SEG_PROVISIONAL;
  return out;
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
  if (code === SEG_PROVISIONAL) return "seg-provisional";
  return "seg-none";
}

export function segmentLabel(code: MiniCode): string {
  if (code === SEG_OVERALL) return "Overall best";
  if (code === SEG_PERSONAL) return "Personal best";
  if (code === SEG_YELLOW) return "Slower than personal best";
  if (code === SEG_PIT) return "Pit lane";
  if (code === SEG_PROVISIONAL) return "In progress";
  return "No mini sector yet";
}

function lastOwnSector(laps: Lap[], which: Which, before: Lap | null): number | null {
  let bestN = -1;
  let time: number | null = null;
  for (const lap of laps) {
    if (before && lap.lap_number >= before.lap_number) continue;
    const value = durationOf(lap, which);
    if (value == null || value <= 0) continue;
    if (lap.lap_number >= bestN) {
      bestN = lap.lap_number;
      time = value;
    }
  }
  return time;
}

/** First mini-sector boundary for this sector, as a fraction of the lap. */
function sectorFirstFrac(which: Which, ends: SectorEnds, count: number): number {
  const { start, end } = sectorSpan(which, ends);
  return start + (end - start) / Math.max(1, count);
}

/** True while the car's track position is still inside this sector. */
function gpsInsideSector(frac: number, which: Which, ends: SectorEnds): boolean {
  const { start, end } = sectorSpan(which, ends);
  return frac + 1e-9 >= start && frac < end - 1e-4;
}

/** A finished sector whose colour list has not arrived yet. Same colour on every block. */
function colourFromSectorTime(kind: SectorKind, slots: number): MiniCode[] {
  const code = miniForKind(kind);
  return Array.from({ length: Math.max(0, slots) }, () => code);
}

/**
 * Sector times and mini-sectors for one driver at the replay clock.
 * Each sector's blocks follow the same lap as that sector's time. The finished
 * coloured row stays up until this car passes the first S1 block of the new lap.
 * After that, S2 and S3 keep the previous colours until the car enters them.
 * A finished sector with no colour list takes purple, green, or yellow from its
 * time. Grey is only the part of a sector the car is still inside.
 *
 * A GPS reading that is still in S3 stays on the previous lap until the position
 * wraps back near the line. One sector of time is not enough to call that a new lap.
 * Live laps often have no sector times yet. GPS progress lights the blocks the car
 * has reached; a copied sector time is the backup when GPS is missing. `now` is the
 * playback clock, which in live mode is the delayed clock.
 */
export function driverTimingAt(
  laps: Lap[],
  driver: number,
  now: number,
  slots: MiniSlots,
  fix?: TimingFix | null,
): DriverTiming {
  const mine = laps.filter((lap) => lap.driver_number === driver);
  const cur = currentLap(mine, now);
  const prev = previousLap(mine, cur);
  const flags = cur ? sectorFlags(cur, now) : { s1: false, s2: false, s3: false };
  const personal = bests(mine, now);
  const overall = bests(laps, now);
  const estimates: Estimates = {
    s1: lastOwnSector(mine, "s1", cur) ?? overall.s1 ?? personal.s1,
    s2: lastOwnSector(mine, "s2", cur) ?? overall.s2 ?? personal.s2,
    s3: lastOwnSector(mine, "s3", cur) ?? overall.s3 ?? personal.s3,
  };
  const ends = reliableSectorEnds(fix?.sectorFracs);
  const gps = ends && typeof fix?.progress === "number" && Number.isFinite(fix.progress) ? ((fix.progress % 1) + 1) % 1 : null;
  const start = cur ? parseTs(cur.date_start) : Number.NaN;
  const elapsed = Number.isFinite(start) ? (now - start) / 1000 : Infinity;

  const holdFinished = (() => {
    if (!cur || !prev || !Number.isFinite(start) || now < start) return false;
    if (gps != null && ends) {
      const first = sectorFirstFrac("s1", ends, segmentCount(cur, "s1", slots.s1));
      const lapEst = (estimates.s1 ?? 25) + (estimates.s2 ?? 35) + (estimates.s3 ?? 20);
      const s3StartsAt = ends.s2 * lapEst;
      if (gps >= ends.s2 && elapsed + 1e-9 < s3StartsAt) return true;
      return gps + 1e-9 < first;
    }
    const firstEnd = miniDoneAt(cur, "s1", 0, slots.s1, estimates);
    if (firstEnd == null) return elapsed < 12;
    return elapsed + 1e-9 < firstEnd;
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
      const heldLap = (which: Which, lap: Lap | null): MiniCode[] => {
        if (!lap) return emptyMinis(slots[which]);
        const painted = fullMinis(lap, which, slots[which]);
        return which === "s1" ? fillS1Block1(painted, lap, slots.s1, now, personal.s1, overall.s1) : painted;
      };
      if (!cur) {
        return { s1: heldLap("s1", prev), s2: heldLap("s2", prev), s3: heldLap("s3", prev) };
      }
      const paint = (which: Which): MiniCode[] => {
        if (holdFinished) return heldLap(which, prev);
        const count = segmentCount(cur, which, slots[which]);
        if (flags[which] && hasRealCodes(cur, which)) {
          const painted = paintCodes(cur, which, slots[which], slots[which]);
          return which === "s1" ? fillS1Block1(painted, cur, slots.s1, now, personal.s1, overall.s1) : painted;
        }
        if (flags[which]) {
          const inside = gps != null && ends != null && gpsInsideSector(gps, which, ends);
          if (inside) return provisionalMinis(revealedByProgress(gps, which, ends, count), slots[which]);
          const kind = classify(durationOf(cur, which), personal[which], overall[which]);
          return colourFromSectorTime(kind, slots[which]);
        }
        if (gps != null && ends != null) {
          if (gps + 1e-9 < sectorFirstFrac(which, ends, count)) return heldLap(which, prev);
          const revealed = revealedByProgress(gps, which, ends, count);
          if (!hasRealCodes(cur, which)) return provisionalMinis(revealed, slots[which]);
          const painted = paintCodes(cur, which, slots[which], revealed);
          return which === "s1" ? fillS1Block1(painted, cur, revealed, now, personal.s1, overall.s1) : painted;
        }
        const revealed = revealedMinis(cur, which, now, slots[which], estimates);
        if (!hasRealCodes(cur, which)) return provisionalMinis(revealed, slots[which]);
        const painted = paintCodes(cur, which, slots[which], revealed);
        return which === "s1" ? fillS1Block1(painted, cur, revealed, now, personal.s1, overall.s1) : painted;
      };
      return { s1: paint("s1"), s2: paint("s2"), s3: paint("s3") };
    })(),
  };
}
