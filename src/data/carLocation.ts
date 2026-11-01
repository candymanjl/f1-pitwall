import { parseTs } from "../lib/time";
import { distToTrack } from "./pitlane";
import { polylineLength } from "./track";
import { apiGet } from "./client";
import { isLiveLock } from "./errors";
import type { Driver, LocationSample } from "./types";

export const LOCATION_MAX_AGE_MS = 10_000;
export const LOCATION_SAMPLE_GAP_MS = 500;

export type LocHit = { t: number; x: number; y: number; driver: number };

/** Keep roughly 2 Hz so a session load stays usable. */
export function downsampleLocations(samples: LocationSample[], minGapMs = LOCATION_SAMPLE_GAP_MS): LocationSample[] {
  const sorted = samples
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(parseTs(s.date)))
    .sort((a, b) => a.driver_number - b.driver_number || parseTs(a.date) - parseTs(b.date));
  const out: LocationSample[] = [];
  let lastDriver = -1;
  let lastT = -Infinity;
  for (const s of sorted) {
    const t = parseTs(s.date);
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

export function indexLocations(samples: LocationSample[] | null | undefined): Map<number, LocHit[]> {
  const map = new Map<number, LocHit[]>();
  for (const s of samples ?? []) {
    const t = parseTs(s.date);
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
