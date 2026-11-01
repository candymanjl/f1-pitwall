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

function pad(values: Array<number | null> | null, slots: number, revealed: boolean): MiniCode[] {
  if (!revealed || slots <= 0) return Array.from({ length: slots }, () => null);
  const src = values ?? [];
  const out: MiniCode[] = [];
  for (let i = 0; i < slots; i++) {
    const code = src[i];
    out.push(typeof code === "number" ? code : null);
  }
  return out;
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
 * Mini-sectors are the current lap only and clear when that lap starts.
 * A sector time stays on the previous lap until the new one completes.
 */
export function driverTimingAt(laps: Lap[], driver: number, now: number, slots: MiniSlots): DriverTiming {
  const mine = laps.filter((lap) => lap.driver_number === driver);
  const cur = currentLap(mine, now);
  const prev = previousLap(mine, cur);
  const flags = cur ? sectorFlags(cur, now) : { s1: false, s2: false, s3: false };
  const personal = bests(mine, now);
  const overall = bests(laps, now);

  const readout = (which: Which): SectorReadout => {
    if (cur && flags[which]) {
      const time = durationOf(cur, which);
      return { time, kind: classify(time, personal[which], overall[which]), held: false };
    }
    const prevFlags = prev ? sectorFlags(prev, now) : null;
    const time = prev && prevFlags?.[which] ? durationOf(prev, which) : null;
    return { time, kind: classify(time, personal[which], overall[which]), held: time != null };
  };

  return {
    s1: readout("s1"),
    s2: readout("s2"),
    s3: readout("s3"),
    minis: {
      s1: pad(cur ? segmentsOf(cur, "s1") : null, slots.s1, flags.s1),
      s2: pad(cur ? segmentsOf(cur, "s2") : null, slots.s2, flags.s2),
      s3: pad(cur ? segmentsOf(cur, "s3") : null, slots.s3, flags.s3),
    },
  };
}
