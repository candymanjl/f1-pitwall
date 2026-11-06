import { parseTs } from "../lib/time";
import { apiGet } from "./client";
import { isLiveLock } from "./errors";
import {
  cachedAsFrom,
  readCachedOutline,
  writeCachedOutline,
} from "./outlineCache";
import {
  buildOutline,
  detectCorners,
  lapWindow,
  liveOutlineBeatsFallback,
  outlineFromLocations,
  outlineIsUsable,
  pickSectorLap,
  sectorDistanceFractions,
  sectorFracsFromLocations,
} from "./track";
import type { Driver, Lap, LocationSample, Meeting, OutlineFrom, Session, SessionBundle } from "./types";

export type LoadedOutline = {
  track: [number, number][];
  sectorFracs: [number, number, number] | null;
  from: OutlineFrom | null;
};

let lastPromoteN = 0;
let lastPromoteAt = 0;

export function resetOutlinePromoteForTests(): void {
  lastPromoteN = 0;
  lastPromoteAt = 0;
}

export function formatOutlineLabel(from: OutlineFrom | null | undefined): string | null {
  if (!from) return null;
  const gp = from.meetingName.replace(/\s+Grand Prix\b/gi, " GP").replace(/\s+/g, " ").trim();
  return `Outline from ${from.year} ${gp}`;
}

function donorScore(session: Session): number {
  const name = (session.session_name || "").toLowerCase();
  const race = name.includes("race") && !name.includes("sprint") ? 3 : name.includes("qual") ? 2 : name.includes("sprint") ? 1 : 0;
  return race * 1e15 + parseTs(session.date_start);
}

export function preferOutlineDonors(current: Session, sessions: Session[]): Session[] {
  const ck = current.circuit_key;
  const name = (current.circuit_short_name || "").trim().toLowerCase();
  const before = parseTs(current.date_start);
  const seen = new Set<number>();
  const out: Session[] = [];
  for (const session of sessions) {
    if (session.session_key === current.session_key || seen.has(session.session_key)) continue;
    if (session.is_cancelled) continue;
    const t = parseTs(session.date_start);
    if (!Number.isFinite(t) || t >= before) continue;
    if (ck != null && session.circuit_key != null) {
      if (session.circuit_key !== ck) continue;
    } else if ((session.circuit_short_name || "").trim().toLowerCase() !== name) {
      continue;
    }
    seen.add(session.session_key);
    out.push(session);
  }
  return out.sort((a, b) => donorScore(b) - donorScore(a));
}

export async function loadSessionOutline(
  sessionKey: number,
  laps: Lap[],
  drivers: Driver[],
): Promise<{ track: [number, number][]; sectorFracs: [number, number, number] | null }> {
  const preferred = pickSectorLap(laps, drivers);
  if (!preferred) return { track: [], sectorFracs: null };
  const win = lapWindow(preferred);
  if (!win) return { track: [], sectorFracs: null };
  try {
    const samples = await apiGet<LocationSample[]>("location", {
      session_key: sessionKey,
      driver_number: preferred.driver_number,
      "date>": win.from,
      "date<": win.to,
    });
    return { track: buildOutline(samples), sectorFracs: sectorDistanceFractions(samples, preferred) };
  } catch (err) {
    if (isLiveLock(err)) throw err;
    return { track: [], sectorFracs: null };
  }
}

async function loadCircuitSessions(session: Session): Promise<Session[]> {
  if (session.circuit_key != null) {
    try {
      return await apiGet<Session[]>("sessions", { circuit_key: session.circuit_key });
    } catch (err) {
      if (isLiveLock(err)) throw err;
    }
  }
  const name = (session.circuit_short_name || "").trim();
  if (name) {
    try {
      return await apiGet<Session[]>("sessions", { circuit_short_name: name });
    } catch (err) {
      if (isLiveLock(err)) throw err;
    }
  }
  return [];
}

async function loadDonorOutline(donor: Session): Promise<{ track: [number, number][]; sectorFracs: [number, number, number] | null }> {
  try {
    const [drivers, laps] = await Promise.all([
      apiGet<Driver[]>("drivers", { session_key: donor.session_key }),
      apiGet<Lap[]>("laps", { session_key: donor.session_key }),
    ]);
    return loadSessionOutline(donor.session_key, laps, drivers);
  } catch (err) {
    if (isLiveLock(err)) throw err;
    return { track: [], sectorFracs: null };
  }
}

function fromDonor(donor: Session, meetingName: string): OutlineFrom {
  return {
    year: donor.year,
    meetingName,
    sessionName: donor.session_name,
    sessionKey: donor.session_key,
  };
}

export async function resolveFallbackOutline(opts: {
  session: Session;
  meeting: Meeting;
  weekendSessions: Session[];
}): Promise<LoadedOutline | null> {
  const cached = readCachedOutline(opts.session);
  if (cached && outlineIsUsable(cached.track)) {
    return {
      track: cached.track,
      sectorFracs: cached.sectorFracs,
      from: cachedAsFrom(cached),
    };
  }
  let listed: Session[] = [];
  try {
    listed = await loadCircuitSessions(opts.session);
  } catch (err) {
    if (isLiveLock(err)) throw err;
  }
  const donors = preferOutlineDonors(opts.session, [...opts.weekendSessions, ...listed]);
  for (const donor of donors.slice(0, 3)) {
    const loaded = await loadDonorOutline(donor);
    if (!outlineIsUsable(loaded.track)) continue;
    const from = fromDonor(donor, opts.meeting.meeting_name);
    writeCachedOutline(opts.session, {
      track: loaded.track,
      sectorFracs: loaded.sectorFracs ?? [0.3, 0.4, 0.3],
      year: from.year,
      meetingName: from.meetingName,
      sessionName: from.sessionName,
      sessionKey: from.sessionKey,
    });
    return { track: loaded.track, sectorFracs: loaded.sectorFracs, from };
  }
  return null;
}

export function cacheCurrentOutline(bundle: SessionBundle): void {
  if (bundle.outlineFrom || !outlineIsUsable(bundle.track)) return;
  writeCachedOutline(bundle.session, {
    track: bundle.track,
    sectorFracs: bundle.sectorFracs,
    year: bundle.session.year,
    meetingName: bundle.meeting.meeting_name,
    sessionName: bundle.session.session_name,
    sessionKey: bundle.session.session_key,
  });
}

export function maybePromoteLiveOutline(bundle: SessionBundle, now = Date.now()): SessionBundle | null {
  if (!bundle.outlineFrom && outlineIsUsable(bundle.track)) return null;
  const n = bundle.locations?.length ?? 0;
  if (n - lastPromoteN < 16 && now - lastPromoteAt < 1500) return null;
  lastPromoteN = n;
  lastPromoteAt = now;
  const live = outlineFromLocations(bundle.locations ?? [], bundle.laps, bundle.drivers);
  const fallback = bundle.outlineFrom ? bundle.track : [];
  if (!liveOutlineBeatsFallback(live, fallback)) return null;
  const sectorFracs =
    sectorFracsFromLocations(bundle.locations ?? [], bundle.laps, bundle.drivers) ?? bundle.sectorFracs;
  const next: SessionBundle = {
    ...bundle,
    track: live,
    corners: detectCorners(live),
    sectorFracs,
    outlineFrom: null,
  };
  cacheCurrentOutline(next);
  return next;
}
