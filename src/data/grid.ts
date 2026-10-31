import { parseTs } from "../lib/time";
import type { Position, Session, SessionBundle, StartingGrid } from "./types";

export function isRaceOrSprint(session: Pick<Session, "session_name" | "session_type">): boolean {
  const name = session.session_name.trim();
  if (/qualifying|practice|shootout/i.test(name)) return false;
  return /^(race|sprint)$/i.test(name);
}

function gridSlot(row: StartingGrid): number | null {
  const n = Number(row.position ?? row.grid_position);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Grid slot per driver: `/starting_grid` when present, else the first `/position` of the race. */
export function gridByDriver(bundle: Pick<SessionBundle, "startingGrid" | "positions">): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of bundle.startingGrid ?? []) {
    const slot = gridSlot(row);
    if (slot != null) map.set(row.driver_number, slot);
  }
  if (map.size) return map;

  const first = new Map<number, { t: number; pos: number }>();
  for (const row of bundle.positions) {
    const t = parseTs(row.date);
    if (!Number.isFinite(t) || !Number.isFinite(row.position) || row.position <= 0) continue;
    const prev = first.get(row.driver_number);
    if (!prev || t < prev.t) first.set(row.driver_number, { t, pos: row.position });
  }
  for (const [driver, hit] of first) map.set(driver, hit.pos);
  return map;
}

/** Positive = gained vs grid, negative = lost, 0 = unchanged. */
export function positionChange(gridPos: number | null | undefined, currentPos: number): number | null {
  if (gridPos == null || !Number.isFinite(gridPos) || !Number.isFinite(currentPos)) return null;
  if (gridPos <= 0 || currentPos <= 0) return null;
  return gridPos - currentPos;
}

export function firstPositionByDriver(positions: Position[]): Map<number, number> {
  return gridByDriver({ startingGrid: [], positions });
}
