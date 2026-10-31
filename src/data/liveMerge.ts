import type { SessionBundle } from "./types";

export type LiveRow = Record<string, unknown> & { _id?: number; _key?: string };

const TOPIC_FIELD: Record<string, keyof SessionBundle> = {
  "v1/laps": "laps",
  "v1/intervals": "intervals",
  "v1/position": "positions",
  "v1/stints": "stints",
  "v1/pit": "pits",
  "v1/weather": "weather",
  "v1/race_control": "raceControl",
  "v1/drivers": "drivers",
};

export const LIVE_TOPICS = Object.keys(TOPIC_FIELD);

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
 * Rows without `_key` are appended (time series like position / intervals).
 */
export function mergeLiveRows<T extends LiveRow>(existing: T[], incoming: unknown): T[] {
  const next = existing.slice();
  for (const row of asRows(incoming) as T[]) {
    const key = typeof row._key === "string" ? row._key : "";
    if (!key) {
      next.push(row);
      continue;
    }
    const idx = next.findIndex((r) => r._key === key);
    if (idx < 0) {
      next.push(row);
      continue;
    }
    if (incomingId(row) >= incomingId(next[idx])) {
      next[idx] = { ...next[idx], ...row };
    }
  }
  return next;
}

export function applyLiveMessage(
  bundle: SessionBundle,
  topic: string,
  payload: unknown,
  sessionKey?: number,
  mode: "merge" | "replace" = "merge",
): SessionBundle {
  const field = TOPIC_FIELD[normalizeTopic(topic)];
  if (!field) return bundle;
  const current = bundle[field];
  if (!Array.isArray(current)) return bundle;
  const incoming = asRows(payload).filter((row) => {
    if (sessionKey == null) return true;
    if (row.session_key == null || row.session_key === "") return true;
    return Number(row.session_key) === sessionKey;
  });
  if (mode === "replace") {
    return { ...bundle, [field]: incoming };
  }
  if (!incoming.length) return bundle;
  return { ...bundle, [field]: mergeLiveRows(current as LiveRow[], incoming) };
}
