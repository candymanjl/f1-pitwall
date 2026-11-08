import type { Pit, Stint } from "./types";

/** Shown when a pit is known and the next compound has not arrived yet. */
export const TYRE_UPDATING = "UPDATING";

export type StintChoice = {
  stint: Stint | null;
  updating: boolean;
};

function byNewest(a: Stint, b: Stint): number {
  const start = (a.lap_start ?? 0) - (b.lap_start ?? 0);
  if (start !== 0) return start;
  return (a.stint_number ?? 0) - (b.stint_number ?? 0);
}

function covers(stint: Stint, lap: number, liveLatest: boolean): boolean {
  const start = stint.lap_start ?? 1;
  if (lap < start) return false;
  if (stint.lap_end == null) return true;
  if (lap <= stint.lap_end) return true;
  return liveLatest;
}

/**
 * Newest stint that applies to this lap.
 * Live mode keeps the latest stint open when its lap_end is behind the lap feed.
 * A pit after that stint began, with no newer compound yet, is "updating".
 */
export function resolveStint(opts: {
  stints: Stint[];
  driver: number;
  lap: number;
  live?: boolean;
  pits?: Pit[];
  inPitLane?: boolean;
}): StintChoice {
  const mine = opts.stints.filter((stint) => stint.driver_number === opts.driver).sort(byNewest);
  if (!mine.length || !Number.isFinite(opts.lap) || opts.lap <= 0) return { stint: null, updating: false };
  const latest = mine[mine.length - 1];
  let chosen: Stint | null = null;
  for (let i = mine.length - 1; i >= 0; i--) {
    if (covers(mine[i], opts.lap, !!opts.live && mine[i] === latest)) {
      chosen = mine[i];
      break;
    }
  }
  if (!chosen) return { stint: null, updating: false };
  if (!opts.live) return { stint: chosen, updating: false };
  const began = chosen.lap_start ?? 1;
  const pitAfter = (opts.pits ?? []).some(
    (pit) => pit.driver_number === opts.driver && pit.lap_number != null && pit.lap_number > began && pit.lap_number <= opts.lap,
  );
  const laneAfter = !!opts.inPitLane && opts.lap > began;
  return { stint: chosen, updating: pitAfter || laneAfter };
}
