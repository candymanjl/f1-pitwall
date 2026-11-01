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

/** Location must stay off the critical path of the other endpoints. */
export const LOCATION_POLL_MS = 2500;
export const POSITION_POLL_MS = 4000;
export const INTERVALS_POLL_MS = 4000;
export const RACE_CONTROL_POLL_MS = 7500;
export const LAPS_POLL_MS = 10_000;
export const STINTS_POLL_MS = 30_000;
export const PIT_POLL_MS = 30_000;
export const WEATHER_POLL_MS = 60_000;
export const CAR_DATA_POLL_MS = 4000;

/** Fastest REST cadence — used as the idle tick floor. */
export const FAST_POLL_MS = LOCATION_POLL_MS;
/** Legacy alias for tests that still group the slower endpoints. */
export const SLOW_POLL_MS = STINTS_POLL_MS;

export const MQTT_SILENCE_MS = 15_000;
export const TOPIC_RATE_WINDOW_MS = 5_000;

export const MQTT_STREAM_TOPICS = [
  "v1/location",
  "v1/position",
  "v1/intervals",
  "v1/laps",
  "v1/race_control",
  "v1/pit",
  "v1/stints",
  "v1/weather",
] as const;

export const MQTT_CAR_DATA_TOPIC = "v1/car_data";

export const LIVE_POLL_SPECS: LivePollSpec[] = [
  { path: "location", topic: "v1/location", dateField: "date", everyMs: LOCATION_POLL_MS },
  { path: "position", topic: "v1/position", dateField: "date", everyMs: POSITION_POLL_MS },
  { path: "intervals", topic: "v1/intervals", dateField: "date", everyMs: INTERVALS_POLL_MS },
  { path: "race_control", topic: "v1/race_control", dateField: "date", everyMs: RACE_CONTROL_POLL_MS },
  { path: "laps", topic: "v1/laps", dateField: "date_start", everyMs: LAPS_POLL_MS },
  { path: "pit", topic: "v1/pit", dateField: "date", everyMs: PIT_POLL_MS },
  { path: "stints", topic: "v1/stints", dateField: null, everyMs: STINTS_POLL_MS },
  { path: "weather", topic: "v1/weather", dateField: "date", everyMs: WEATHER_POLL_MS },
  { path: "car_data", topic: "v1/car_data", dateField: "date", everyMs: CAR_DATA_POLL_MS },
];

const IMMEDIATE_PATHS = new Set<LivePollPath>(["location", "position", "intervals", "car_data"]);

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

export type LiveFeedMode = "STREAM" | "POLLING" | "OFF";
export type LiveTabRole = "leader" | "follower";

export type LivePollDebug = {
  mode: LiveFeedMode;
  lastPollAt: number | null;
  lastCycleMs: number | null;
  added: Record<string, number>;
  lastError: string;
  topicRates: Record<string, number>;
  lastMessageAt: Record<string, number>;
  lastMessageAgeMs: number | null;
  tabRole: LiveTabRole;
};

export type TopicRateState = { stamps: Record<string, number[]> };

export function emptyRateState(): TopicRateState {
  return { stamps: {} };
}

export function recordTopicHit(
  state: TopicRateState,
  topic: string,
  now: number,
  windowMs = TOPIC_RATE_WINDOW_MS,
): void {
  const list = state.stamps[topic] ?? (state.stamps[topic] = []);
  list.push(now);
  const cutoff = now - windowMs;
  while (list.length && list[0] < cutoff) list.shift();
}

export function topicRates(
  state: TopicRateState,
  now: number,
  windowMs = TOPIC_RATE_WINDOW_MS,
): Record<string, number> {
  const out: Record<string, number> = {};
  const cutoff = now - windowMs;
  const seconds = windowMs / 1000;
  for (const [topic, list] of Object.entries(state.stamps)) {
    let n = 0;
    for (const t of list) if (t >= cutoff) n += 1;
    if (n) out[topic] = n / seconds;
  }
  return out;
}

export function lastMessageAgeMs(lastAt: Record<string, number>, now: number): number | null {
  let max = -Infinity;
  for (const t of Object.values(lastAt)) {
    if (Number.isFinite(t) && t > max) max = t;
  }
  if (!Number.isFinite(max) || max <= 0) return null;
  return Math.max(0, now - max);
}

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

export const LOCATION_LIVE_WINDOW_MS = 10_000;

export function locationLiveSinceIso(now = Date.now()): string {
  return new Date(now - LOCATION_LIVE_WINDOW_MS).toISOString();
}

export function livePollParams(
  spec: LivePollSpec,
  sessionKey: number,
  cursors: Record<string, string>,
  fallbackSince: string,
  now = Date.now(),
): Record<string, string | number> {
  const params: Record<string, string | number> = { session_key: sessionKey };
  if (spec.dateField) {
    if (spec.path === "location" && !cursors[spec.path]) {
      params["date>"] = locationLiveSinceIso(now);
    } else {
      params[`${spec.dateField}>`] = normalizeFilterIso(cursors[spec.path] || fallbackSince);
    }
  }
  return params;
}

export function pollSpecsForPage(page?: PageId): LivePollSpec[] {
  return LIVE_POLL_SPECS.filter((spec) => spec.path !== "car_data" || page === "telemetry");
}

export function mqttTopicsForPage(page?: PageId): string[] {
  if (page === "telemetry") return [...MQTT_STREAM_TOPICS, MQTT_CAR_DATA_TOPIC];
  return [...MQTT_STREAM_TOPICS];
}

/** Location / position / intervals (and car_data on Telemetry) fire on the first tick. */
export function seedLastRan(now: number, specs: LivePollSpec[] = LIVE_POLL_SPECS): Record<string, number> {
  const last: Record<string, number> = {};
  for (const spec of specs) {
    last[spec.path] = IMMEDIATE_PATHS.has(spec.path) ? now - spec.everyMs : now;
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

function formatAge(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `last ${(ms / 1000).toFixed(1)}s`;
  return `last ${Math.round(ms / 1000)}s`;
}

export function formatLiveDebug(debug: Partial<LivePollDebug>): string {
  const mode = debug.mode ?? (debug.lastPollAt ? "POLLING" : "OFF");
  const parts: string[] = [mode];
  if (debug.tabRole === "follower") {
    parts.push("another tab is polling");
    return parts.join(" · ");
  }
  const rates = Object.entries(debug.topicRates ?? {})
    .filter(([, n]) => typeof n === "number" && n > 0)
    .map(([topic, n]) => `${topic} ${n.toFixed(1)}/s`);
  if (rates.length) parts.push(rates.join(" · "));
  const age = formatAge(debug.lastMessageAgeMs);
  if (age) parts.push(age);
  const rows =
    Object.entries(debug.added ?? {})
      .map(([path, n]) => `${path} +${n}`)
      .join(" · ");
  if (rows) parts.push(rows);
  if (debug.lastCycleMs != null) parts.push(`${debug.lastCycleMs}ms`);
  const time = debug.lastPollAt ? new Date(debug.lastPollAt).toISOString().slice(11, 19) : "";
  if (time) parts.push(`${time} UTC`);
  parts.push(debug.lastError || "ok");
  return parts.join(" · ");
}

export function emptyLiveDebug(): LivePollDebug {
  return {
    mode: "OFF",
    lastPollAt: null,
    lastCycleMs: null,
    added: {},
    lastError: "",
    topicRates: {},
    lastMessageAt: {},
    lastMessageAgeMs: null,
    tabRole: "leader",
  };
}
