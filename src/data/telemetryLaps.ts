import type { Lap, Pit } from "./types";

export type TelemetrySlot = { driver: number; lap: number };

function finitePositive(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Pit-in laps are the lap number recorded on `/pit`. */
export function pitInLaps(pits: Pit[], driver: number): Set<number> {
  const laps = new Set<number>();
  for (const pit of pits) {
    if (pit.driver_number === driver && pit.lap_number != null && Number.isFinite(pit.lap_number)) {
      laps.add(pit.lap_number);
    }
  }
  return laps;
}

/**
 * A complete racing lap has a start time, a duration, and all three sectors.
 * In-laps and out-laps are excluded.
 */
export function isCompleteLap(lap: Lap, inLaps: Set<number>): boolean {
  if (lap.is_pit_out_lap) return false;
  if (inLaps.has(lap.lap_number)) return false;
  if (!lap.date_start) return false;
  if (!finitePositive(lap.lap_duration)) return false;
  if (!finitePositive(lap.duration_sector_1)) return false;
  if (!finitePositive(lap.duration_sector_2)) return false;
  if (!finitePositive(lap.duration_sector_3)) return false;
  return true;
}

export function fastestCompleteLap(laps: Lap[], driver: number, pits: Pit[]): number | null {
  const inLaps = pitInLaps(pits, driver);
  let best: Lap | null = null;
  for (const lap of laps) {
    if (lap.driver_number !== driver || !isCompleteLap(lap, inLaps)) continue;
    if (!best || (lap.lap_duration as number) < (best.lap_duration as number)) best = lap;
  }
  return best?.lap_number ?? null;
}

/** Fastest complete lap, or the first timed lap when the session has none. */
export function defaultLapForDriver(laps: Lap[], driver: number, pits: Pit[]): number {
  const complete = fastestCompleteLap(laps, driver, pits);
  if (complete != null) return complete;
  const timed = laps.find((lap) => lap.driver_number === driver && finitePositive(lap.lap_duration));
  return timed?.lap_number ?? 1;
}

export function ensureMinDrivers(
  slots: TelemetrySlot[],
  drivers: { driver_number: number }[],
  laps: Lap[],
  pits: Pit[],
  min = 2,
  max = 4,
): TelemetrySlot[] {
  const capped = slots.length > max ? slots.slice(0, max) : slots;
  if (capped.length >= min || !drivers.length) return capped;
  const out = capped.slice();
  const used = new Set(out.map((slot) => slot.driver));
  for (const driver of drivers) {
    if (out.length >= min) break;
    if (used.has(driver.driver_number)) continue;
    out.push({
      driver: driver.driver_number,
      lap: defaultLapForDriver(laps, driver.driver_number, pits),
    });
    used.add(driver.driver_number);
  }
  return out;
}

/** Drivers who do not have this lap number keep their current lap. */
export function slotsAtLap(slots: TelemetrySlot[], laps: Lap[], lapNumber: number): TelemetrySlot[] {
  if (!Number.isFinite(lapNumber) || lapNumber < 1) return slots;
  const have = new Set(
    laps
      .filter((lap) => lap.lap_number === lapNumber && finitePositive(lap.lap_duration))
      .map((lap) => lap.driver_number),
  );
  let changed = false;
  const next = slots.map((slot) => {
    if (!have.has(slot.driver) || slot.lap === lapNumber) return slot;
    changed = true;
    return { driver: slot.driver, lap: lapNumber };
  });
  return changed ? next : slots;
}

/** Changes when a selected driver's timed laps or fastest complete lap changes. */
export function telemetryPickerKey(laps: Lap[], pits: Pit[], drivers: number[]): string {
  const parts = [String(pits.length)];
  for (const driver of drivers) {
    const nums: number[] = [];
    for (const lap of laps) {
      if (lap.driver_number === driver && typeof lap.lap_duration === "number" && lap.lap_duration > 0) {
        nums.push(lap.lap_number);
      }
    }
    parts.push(`${driver}:${fastestCompleteLap(laps, driver, pits) ?? ""}:${nums.join(".")}`);
  }
  return parts.join("|");
}

export function slotsAtFastest(slots: TelemetrySlot[], laps: Lap[], pits: Pit[]): TelemetrySlot[] {
  let changed = false;
  const next = slots.map((slot) => {
    const lap = fastestCompleteLap(laps, slot.driver, pits);
    if (lap == null || lap === slot.lap) return slot;
    changed = true;
    return { driver: slot.driver, lap };
  });
  return changed ? next : slots;
}
