import { appendLiveLocations, locationTime } from "./carLocation";
import { parseTs } from "../lib/time";
import type { LocationSample, SessionBundle } from "./types";

export type LiveRow = Record<string, unknown> & { _id?: number; _key?: string; t?: number };

const TOPIC_FIELD: Record<string, keyof SessionBundle> = {
  "v1/laps": "laps",
  "v1/intervals": "intervals",
  "v1/position": "positions",
  "v1/stints": "stints",
  "v1/pit": "pits",
  "v1/weather": "weather",
  "v1/race_control": "raceControl",
  "v1/drivers": "drivers",
  "v1/location": "locations",
  "v1/car_data": "carData",
};

export const LIVE_TOPICS = Object.keys(TOPIC_FIELD);

const TIME_SERIES = new Set<keyof SessionBundle>([
  "intervals",
  "positions",
  "pits",
  "weather",
  "raceControl",
  "locations",
  "carData",
]);

export function normalizeTopic(topic: string): string {
  return topic.replace(/^\//, "");
}

function asRows(payload: unknown): LiveRow[] {
  if (payload == null) return [];
  if (typeof payload === "string") {
    try {
      return asRows(JSON.parse(payload));
    } catch {
      return [];
    }
  }
  if (Array.isArray(payload)) return payload.filter((x): x is LiveRow => x != null && typeof x === "object");
  if (typeof payload === "object") return [payload as LiveRow];
  return [];
}

function incomingId(row: LiveRow): number {
  const n = Number(row._id);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Merge MQTT/WebSocket documents into a list.
 * Same `_key` replaces the previous row when `_id` is greater or equal (sector updates).
 * Time-series rows (no identity key) are appended with no lookup.
 */
export function liveRowKey(row: LiveRow): string {
  if (typeof row._key === "string" && row._key) return row._key;
  const driver = row.driver_number;
  if (row.stint_number != null && driver != null) return `stint-${driver}-${row.stint_number}`;
  if (row.date_start && row.lap_number != null && driver != null) return `lap-${driver}-${row.lap_number}`;
  return "";
}

export function rowTimeMs(row: LiveRow): number {
  if (typeof row.t === "number" && Number.isFinite(row.t)) return row.t;
  if (typeof row.date === "string") return parseTs(row.date);
  if (typeof row.date_start === "string") return parseTs(row.date_start);
  return NaN;
}

export function rowsLatestMs(rows: LiveRow[]): number {
  let max = -Infinity;
  for (const row of rows) {
    const t = rowTimeMs(row);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return Number.isFinite(max) && max > 0 ? max : NaN;
}

export function mergeLiveRows<T extends LiveRow>(existing: T[], incoming: unknown, timeSeries = false): T[] {
  const rows = asRows(incoming) as T[];
  if (!rows.length) return existing;
  if (timeSeries) return existing.concat(rows);
  const next = existing.slice();
  const index = new Map<string, number>();
  for (let i = 0; i < next.length; i++) {
    const key = liveRowKey(next[i]);
    if (key) index.set(key, i);
  }
  for (const row of rows) {
    const key = liveRowKey(row);
    if (!key) {
      next.push(row);
      continue;
    }
    const idx = index.get(key);
    if (idx == null) {
      index.set(key, next.length);
      next.push(row);
      continue;
    }
    if (incomingId(row) >= incomingId(next[idx])) {
      next[idx] = { ...next[idx], ...row };
    }
  }
  return next;
}

export type LiveApplyResult = {
  bundle: SessionBundle;
  added: number;
  latestMs: number;
};

export function applyLiveUpdate(
  bundle: SessionBundle,
  topic: string,
  payload: unknown,
  sessionKey?: number,
  mode: "merge" | "replace" = "merge",
): LiveApplyResult {
  const field = TOPIC_FIELD[normalizeTopic(topic)];
  if (!field) return { bundle, added: 0, latestMs: NaN };
  const current = bundle[field] ?? [];
  if (!Array.isArray(current)) return { bundle, added: 0, latestMs: NaN };
  const incoming = asRows(payload).filter((row) => {
    if (sessionKey == null) return true;
    if (row.session_key == null || row.session_key === "") return true;
    return Number(row.session_key) === sessionKey;
  });
  if (!incoming.length) return { bundle, added: 0, latestMs: NaN };
  const latestMs = rowsLatestMs(incoming);

  if (field === "locations") {
    const rows = incoming as LocationSample[];
    for (const row of rows) locationTime(row);
    const next =
      mode === "replace" ? appendLiveLocations([], rows) : appendLiveLocations(current as LocationSample[], rows);
    return { bundle: { ...bundle, locations: next }, added: incoming.length, latestMs };
  }

  if (mode === "replace") {
    return { bundle: { ...bundle, [field]: incoming }, added: incoming.length, latestMs };
  }
  const merged = mergeLiveRows(current as LiveRow[], incoming, TIME_SERIES.has(field));
  return { bundle: { ...bundle, [field]: merged }, added: incoming.length, latestMs };
}

export function applyLiveMessage(
  bundle: SessionBundle,
  topic: string,
  payload: unknown,
  sessionKey?: number,
  mode: "merge" | "replace" = "merge",
): SessionBundle {
  return applyLiveUpdate(bundle, topic, payload, sessionKey, mode).bundle;
}
