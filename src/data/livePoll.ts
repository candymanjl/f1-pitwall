import { LIVE_POLL_MS } from "../config";
import { parseTs } from "../lib/time";
import type { PageId, SessionBundle } from "./types";

export type LivePollPath =
  | "laps"
  | "position"
  | "intervals"
  | "race_control"
  | "weather"
  | "pit"
  | "stints"
  | "location"
  | "car_data";

export type LivePollSpec = {
  path: LivePollPath;
  topic: string;
  dateField: "date" | "date_start" | null;
};

export const LIVE_POLL_SPECS: LivePollSpec[] = [
  { path: "laps", topic: "v1/laps", dateField: "date_start" },
  { path: "position", topic: "v1/position", dateField: "date" },
  { path: "intervals", topic: "v1/intervals", dateField: "date" },
  { path: "race_control", topic: "v1/race_control", dateField: "date" },
  { path: "weather", topic: "v1/weather", dateField: "date" },
  { path: "pit", topic: "v1/pit", dateField: "date" },
  { path: "stints", topic: "v1/stints", dateField: null },
  { path: "location", topic: "v1/location", dateField: "date" },
  { path: "car_data", topic: "v1/car_data", dateField: "date" },
];

const BUNDLE_FIELD: Record<LivePollPath, keyof SessionBundle | "carData"> = {
  laps: "laps",
  position: "positions",
  intervals: "intervals",
  race_control: "raceControl",
  weather: "weather",
  pit: "pits",
  stints: "stints",
  location: "locations",
  car_data: "carData",
};

export function lastSeenIso(rows: unknown[] | undefined, dateField: "date" | "date_start"): string {
  let max = -Infinity;
  let iso = "";
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object") continue;
    const raw = (row as Record<string, unknown>)[dateField];
    if (typeof raw !== "string") continue;
    const t = parseTs(raw);
    if (Number.isFinite(t) && t >= max) {
      max = t;
      iso = raw;
    }
  }
  return iso;
}

export function seedLiveCursors(bundle: SessionBundle | null | undefined): Record<string, string> {
  if (!bundle) return {};
  const out: Record<string, string> = {};
  for (const spec of LIVE_POLL_SPECS) {
    if (!spec.dateField) continue;
    const field = BUNDLE_FIELD[spec.path];
    const rows = bundle[field as keyof SessionBundle];
    const iso = lastSeenIso(Array.isArray(rows) ? rows : [], spec.dateField);
    if (iso) out[spec.path] = iso;
  }
  return out;
}

export function livePollParams(
  spec: LivePollSpec,
  sessionKey: number,
  cursors: Record<string, string>,
  fallbackSinceIso: string,
): Record<string, string | number> {
  const params: Record<string, string | number> = { session_key: sessionKey };
  if (spec.dateField) {
    params["date>"] = cursors[spec.path] || fallbackSinceIso;
  }
  return params;
}

export function pollSpecsForPage(page?: PageId): LivePollSpec[] {
  return LIVE_POLL_SPECS.filter((spec) => spec.path !== "car_data" || page === "telemetry");
}

export function nextPollDelayMs(failures: number, base = LIVE_POLL_MS, cap = 30_000): number {
  if (failures <= 0) return base;
  return Math.min(cap, base * 2 ** Math.min(failures, 4));
}

/** Default incremental window so the first tick never re-downloads a whole session. */
export function fallbackSinceIso(now = Date.now(), windowMs = 20_000): string {
  return new Date(now - windowMs).toISOString();
}
