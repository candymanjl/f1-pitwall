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
  everyMs: number;
};

export const FAST_POLL_MS = LIVE_POLL_MS;
export const SLOW_POLL_MS = 20_000;

export const LIVE_POLL_SPECS: LivePollSpec[] = [
  { path: "location", topic: "v1/location", dateField: "date", everyMs: FAST_POLL_MS },
  { path: "position", topic: "v1/position", dateField: "date", everyMs: FAST_POLL_MS },
  { path: "intervals", topic: "v1/intervals", dateField: "date", everyMs: FAST_POLL_MS },
  { path: "laps", topic: "v1/laps", dateField: "date_start", everyMs: SLOW_POLL_MS },
  { path: "race_control", topic: "v1/race_control", dateField: "date", everyMs: SLOW_POLL_MS },
  { path: "weather", topic: "v1/weather", dateField: "date", everyMs: SLOW_POLL_MS },
  { path: "pit", topic: "v1/pit", dateField: "date", everyMs: SLOW_POLL_MS },
  { path: "stints", topic: "v1/stints", dateField: null, everyMs: SLOW_POLL_MS },
  { path: "car_data", topic: "v1/car_data", dateField: "date", everyMs: FAST_POLL_MS },
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

export type LivePollDebug = {
  lastPollAt: number | null;
  lastCycleMs: number | null;
  added: Record<string, number>;
  lastError: string;
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

export function normalizeFilterIso(raw: string): string {
  const t = parseTs(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : raw;
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
  fallbackSince: string,
): Record<string, string | number> {
  const params: Record<string, string | number> = { session_key: sessionKey };
  if (spec.dateField) {
    params[`${spec.dateField}>`] = normalizeFilterIso(cursors[spec.path] || fallbackSince);
  }
  return params;
}

export function pollSpecsForPage(page?: PageId): LivePollSpec[] {
  return LIVE_POLL_SPECS.filter((spec) => spec.path !== "car_data" || page === "telemetry");
}

/** Spread slow endpoints after start so the first tick is only location/position/intervals. */
export function seedLastRan(now: number, specs: LivePollSpec[] = LIVE_POLL_SPECS): Record<string, number> {
  const last: Record<string, number> = {};
  let slow = 0;
  for (const spec of specs) {
    if (spec.everyMs <= FAST_POLL_MS) last[spec.path] = now - spec.everyMs;
    else {
      last[spec.path] = now - spec.everyMs + 1000 + slow * 2500;
      slow += 1;
    }
  }
  return last;
}

export function duePollSpecs(page: PageId | undefined, lastRan: Record<string, number>, now: number): LivePollSpec[] {
  return pollSpecsForPage(page).filter((spec) => now - (lastRan[spec.path] ?? 0) >= spec.everyMs);
}

export function nextDueInMs(page: PageId | undefined, lastRan: Record<string, number>, now: number): number {
  let min = FAST_POLL_MS;
  for (const spec of pollSpecsForPage(page)) {
    const wait = (lastRan[spec.path] ?? 0) + spec.everyMs - now;
    if (wait > 0 && wait < min) min = wait;
  }
  return Math.max(250, min);
}

export function nextPollDelayMs(failures: number, base = LIVE_POLL_MS, cap = 30_000): number {
  if (failures <= 0) return base;
  return Math.min(cap, base * 2 ** Math.min(failures, 4));
}

/** Default incremental window so the first tick never re-downloads a whole session. */
export function fallbackSinceIso(now = Date.now(), windowMs = 20_000): string {
  return new Date(now - windowMs).toISOString();
}

export function formatLiveDebug(debug: LivePollDebug): string {
  const time = debug.lastPollAt ? new Date(debug.lastPollAt).toISOString().slice(11, 19) : "—";
  const rows =
    Object.entries(debug.added)
      .map(([path, n]) => `${path} +${n}`)
      .join(" · ") || "idle";
  const err = debug.lastError || "ok";
  const cycle = debug.lastCycleMs != null ? `${debug.lastCycleMs}ms` : "—";
  return `poll ${time} UTC · ${rows} · ${cycle} · ${err}`;
}

export function emptyLiveDebug(): LivePollDebug {
  return { lastPollAt: null, lastCycleMs: null, added: {}, lastError: "" };
}
