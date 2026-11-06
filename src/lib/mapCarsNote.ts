import { LOCATION_MAX_AGE_MS, locationTime } from "../data/carLocation";
import type { LocationSample } from "../data/types";

export function latestLocationAgeMs(samples: LocationSample[] | null | undefined, now: number): number | null {
  let newest = -Infinity;
  for (const sample of samples ?? []) {
    const t = locationTime(sample);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (!Number.isFinite(newest) || newest <= 0) return null;
  return Math.max(0, now - newest);
}

function formatSampleAge(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}

/** Shown on the track map while live GPS has not arrived or has gone stale. */
export function liveLocationWaitNote(opts: {
  live: boolean;
  locations?: LocationSample[] | null;
  now: number;
}): string | null {
  if (!opts.live) return null;
  const ageMs = latestLocationAgeMs(opts.locations, opts.now);
  if (ageMs == null) return "Waiting for live positions from OpenF1";
  if (ageMs <= LOCATION_MAX_AGE_MS) return null;
  return `Waiting for live positions from OpenF1, last sample ${formatSampleAge(ageMs)} ago`;
}
