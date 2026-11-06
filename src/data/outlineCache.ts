import type { OutlineFrom, Session } from "./types";

export const OUTLINE_CACHE_KEY = "f1pitwall.circuitOutline";

export type CachedOutline = {
  circuitKey: number | null;
  circuitName: string;
  track: [number, number][];
  sectorFracs: [number, number, number];
  year: number;
  meetingName: string;
  sessionName: string;
  sessionKey: number;
  savedAt: number;
};

export function circuitCacheId(session: Pick<Session, "circuit_key" | "circuit_short_name">): string {
  if (session.circuit_key != null && Number.isFinite(session.circuit_key)) return `k:${session.circuit_key}`;
  return `n:${(session.circuit_short_name || "").trim().toLowerCase()}`;
}

function readAll(): Record<string, CachedOutline> {
  try {
    const raw = localStorage.getItem(OUTLINE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedOutline>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, CachedOutline>): void {
  try {
    localStorage.setItem(OUTLINE_CACHE_KEY, JSON.stringify(all));
  } catch {
    /* quota */
  }
}

export function readCachedOutline(
  session: Pick<Session, "circuit_key" | "circuit_short_name">,
): CachedOutline | null {
  const id = circuitCacheId(session);
  if (id === "n:") return null;
  const hit = readAll()[id];
  if (!hit?.track || hit.track.length < 8) return null;
  return hit;
}

export function writeCachedOutline(
  session: Pick<Session, "circuit_key" | "circuit_short_name">,
  outline: Omit<CachedOutline, "circuitKey" | "circuitName" | "savedAt">,
): void {
  const id = circuitCacheId(session);
  if (id === "n:" || outline.track.length < 8) return;
  const all = readAll();
  all[id] = {
    ...outline,
    circuitKey: session.circuit_key ?? null,
    circuitName: session.circuit_short_name,
    savedAt: Date.now(),
  };
  writeAll(all);
}

export function cachedAsFrom(hit: CachedOutline): OutlineFrom {
  return {
    year: hit.year,
    meetingName: hit.meetingName,
    sessionName: hit.sessionName,
    sessionKey: hit.sessionKey,
  };
}
