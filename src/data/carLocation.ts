import { parseTs } from "../lib/time";
import { distToTrack } from "./pitlane";
import { polylineLength } from "./track";
import { apiGet } from "./client";
import { isLiveLock } from "./errors";
import type { Driver, LocationSample } from "./types";

export const LOCATION_MAX_AGE_MS = 10_000;
export const LOCATION_SAMPLE_GAP_MS = 500;
/** Live GPS kept this long so merge never rescans a whole race. */
export const LIVE_LOCATION_KEEP_MS = 8 * 60 * 1000;

export type LocHit = { t: number; x: number; y: number; driver: number };

/** Parse once and stash on the sample. */
export function locationTime(sample: LocationSample): number {
  if (typeof sample.t === "number" && Number.isFinite(sample.t)) return sample.t;
  const t = parseTs(sample.date);
  sample.t = t;
  return t;
}

/** Keep roughly 2 Hz so a session load stays usable. Sorts only the given batch. */
export function downsampleLocations(samples: LocationSample[], minGapMs = LOCATION_SAMPLE_GAP_MS): LocationSample[] {
  const sorted = samples
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(locationTime(s)))
    .sort((a, b) => a.driver_number - b.driver_number || locationTime(a) - locationTime(b));
  const out: LocationSample[] = [];
  let lastDriver = -1;
  let lastT = -Infinity;
  for (const s of sorted) {
    const t = locationTime(s);
    if (s.driver_number !== lastDriver) {
      out.push(s);
      lastDriver = s.driver_number;
      lastT = t;
      continue;
    }
    if (t - lastT >= minGapMs) {
      out.push(s);
      lastT = t;
    }
  }
  return out;
}

function firstIndexAtLeast(samples: LocationSample[], cut: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (locationTime(samples[mid]) < cut) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function capLocations(samples: LocationSample[], now?: number, keepMs = LIVE_LOCATION_KEEP_MS): LocationSample[] {
  if (!samples.length) return samples;
  const newest = locationTime(samples[samples.length - 1]);
  const cut = (Number.isFinite(now) ? (now as number) : newest) - keepMs;
  if (!Number.isFinite(cut)) return samples;
  const i = firstIndexAtLeast(samples, cut);
  return i === 0 ? samples : samples.slice(i);
}

/** Downsample only the incoming batch, then append. Never re-sort the stored list. */
export function appendLiveLocations(
  existing: LocationSample[],
  incoming: LocationSample[],
  now?: number,
): LocationSample[] {
  const batch = downsampleLocations(incoming);
  if (!batch.length) return existing;
  const newest = locationTime(batch[batch.length - 1]);
  const cut = (Number.isFinite(now) ? (now as number) : newest) - LIVE_LOCATION_KEEP_MS;
  const start = Number.isFinite(cut) ? firstIndexAtLeast(existing, cut) : 0;
  const kept = start === 0 ? existing : existing.slice(start);
  return kept.length ? kept.concat(batch) : batch;
}

export function indexLocations(samples: LocationSample[] | null | undefined): Map<number, LocHit[]> {
  const map = new Map<number, LocHit[]>();
  for (const s of samples ?? []) {
    const t = locationTime(s);
    if (!Number.isFinite(t) || !Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
    const list = map.get(s.driver_number) ?? [];
    list.push({ t, x: s.x, y: s.y, driver: s.driver_number });
    map.set(s.driver_number, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.t - b.t);
  return map;
}

export function nearestIndexed(list: LocHit[] | undefined, now: number): LocHit | null {
  if (!list?.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < now) lo = mid + 1;
    else hi = mid;
  }
  const right = list[lo];
  const left = list[Math.max(0, lo - 1)];
  if (!right) return left ?? null;
  if (left === right) return right;
  return Math.abs(right.t - now) <= Math.abs(left.t - now) ? right : left;
}

export function locationOnTrack(track: [number, number][], x: number, y: number): boolean {
  if (track.length < 2) return true;
  const span = polylineLength(track);
  return distToTrack(track, x, y) <= Math.max(span * 0.03, 80);
}

export function isRecentLocation(hit: LocHit | null, now: number, maxAge = LOCATION_MAX_AGE_MS): boolean {
  return !!hit && Number.isFinite(now) && Math.abs(now - hit.t) <= maxAge;
}

export async function loadDriverLocations(
  sessionKey: number,
  drivers: Driver[],
  from: string,
  to: string,
): Promise<LocationSample[]> {
  if (!drivers.length || !from || !to) return [];
  const chunks = await Promise.all(
    drivers.map(async (d) => {
      try {
        return await apiGet<LocationSample[]>("location", {
          session_key: sessionKey,
          driver_number: d.driver_number,
          "date>": from,
          "date<": to,
        });
      } catch (err) {
        if (isLiveLock(err)) throw err;
        return [];
      }
    }),
  );
  return downsampleLocations(chunks.flat());
}
