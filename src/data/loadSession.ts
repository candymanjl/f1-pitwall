import { DEFAULT_MEETING_KEY, DEFAULT_SESSION_KEY, DEFAULT_YEAR } from "../config";
import { parseTs } from "../lib/time";
import { apiGet } from "./client";
import { isLiveLock } from "./errors";
import { snapshotAt } from "./derive";
import { detectPitLane, DEFAULT_PIT_ENTRY, DEFAULT_PIT_EXIT, pickPitForTrace } from "./pitlane";
import { buildOutline, detectCorners, lapWindow, pickOutlineLap, sectorFractions } from "./track";
import type {
  Driver,
  Interval,
  Lap,
  LocationSample,
  Meeting,
  Pit,
  Position,
  RaceControl,
  Session,
  SessionBundle,
  Stint,
  Weather,
} from "./types";

export async function loadMeetings(year: number): Promise<Meeting[]> {
  const rows = await apiGet<Meeting[]>("meetings", { year });
  return rows.sort((a, b) => parseTs(a.date_start) - parseTs(b.date_start));
}

export async function loadSessions(meetingKey: number): Promise<Session[]> {
  const rows = await apiGet<Session[]>("sessions", { meeting_key: meetingKey });
  return rows.sort((a, b) => parseTs(a.date_start) - parseTs(b.date_start));
}

async function loadTrack(sessionKey: number, laps: Lap[], drivers: Driver[]): Promise<[number, number][]> {
  const preferred =
    pickOutlineLap(laps.filter((l) => l.driver_number === drivers[0]?.driver_number)) ??
    pickOutlineLap(laps);
  if (!preferred) return [];
  const win = lapWindow(preferred);
  if (!win) return [];
  try {
    const samples = await apiGet<LocationSample[]>("location", {
      session_key: sessionKey,
      driver_number: preferred.driver_number,
      "date>": win.from,
      "date<": win.to,
    });
    return buildOutline(samples);
  } catch (err) {
    if (isLiveLock(err)) throw err;
    return [];
  }
}

export async function loadBundle(sessionKey: number): Promise<SessionBundle> {
  const sessions = await apiGet<Session[]>("sessions", { session_key: sessionKey });
  const session = sessions[0];
  if (!session) throw new Error("Session not found");

  const [meetings, weekendSessions, drivers, laps, stints, pits, weather, raceControl, positions] =
    await Promise.all([
      apiGet<Meeting[]>("meetings", { meeting_key: session.meeting_key }),
      apiGet<Session[]>("sessions", { meeting_key: session.meeting_key }),
      apiGet<Driver[]>("drivers", { session_key: sessionKey }),
      apiGet<Lap[]>("laps", { session_key: sessionKey }),
      apiGet<Stint[]>("stints", { session_key: sessionKey }),
      apiGet<Pit[]>("pit", { session_key: sessionKey }),
      apiGet<Weather[]>("weather", { session_key: sessionKey }),
      apiGet<RaceControl[]>("race_control", { session_key: sessionKey }),
      apiGet<Position[]>("position", { session_key: sessionKey }),
    ]);

  const meeting = meetings[0];
  if (!meeting) throw new Error("Meeting not found");

  let intervals: Interval[] = [];
  if (/race|sprint/i.test(session.session_name)) {
    try {
      intervals = await apiGet<Interval[]>("intervals", { session_key: sessionKey });
    } catch (err) {
      if (isLiveLock(err)) throw err;
      intervals = [];
    }
  }

  const weekendStints: Stint[] = [...stints];
  for (const s of weekendSessions) {
    if (s.session_key === sessionKey) continue;
    try {
      const extra = await apiGet<Stint[]>("stints", { session_key: s.session_key });
      for (const row of extra) weekendStints.push({ ...row, session_key: s.session_key });
    } catch (err) {
      if (isLiveLock(err)) throw err;
    }
  }

  const track = await loadTrack(sessionKey, laps, drivers);
  const corners = detectCorners(track);
  const sectorFracs = sectorFractions(laps);
  const pitMarks = await loadPitMarks(sessionKey, track, pits);

  return {
    meeting,
    session,
    weekendSessions: weekendSessions.sort((a, b) => parseTs(a.date_start) - parseTs(b.date_start)),
    drivers: drivers.sort((a, b) => a.driver_number - b.driver_number),
    laps,
    intervals,
    positions,
    stints,
    weekendStints,
    pits,
    weather,
    raceControl,
    track,
    corners,
    sectorFracs,
    pitEntry: pitMarks.entry,
    pitExit: pitMarks.exit,
  };
}

async function loadPitMarks(
  sessionKey: number,
  track: [number, number][],
  pits: Pit[],
): Promise<{ entry: number; exit: number }> {
  const fallback = { entry: DEFAULT_PIT_ENTRY, exit: DEFAULT_PIT_EXIT };
  const pit = pickPitForTrace(pits);
  if (!pit || track.length < 2) return fallback;
  const t = parseTs(pit.date);
  if (!Number.isFinite(t)) return fallback;
  const dur = (pit.lane_duration ?? 25) * 1000;
  try {
    const samples = await apiGet<LocationSample[]>("location", {
      session_key: sessionKey,
      driver_number: pit.driver_number,
      "date>": new Date(t - 20000).toISOString(),
      "date<": new Date(t + dur + 20000).toISOString(),
    });
    return detectPitLane(track, samples) ?? fallback;
  } catch (err) {
    if (isLiveLock(err)) throw err;
    return fallback;
  }
}

export async function loadDefaultKeys(): Promise<{ year: number; meetingKey: number; sessionKey: number }> {
  try {
    const sessions = await apiGet<Session[]>("sessions", { session_key: DEFAULT_SESSION_KEY });
    if (sessions[0]) {
      return {
        year: sessions[0].year ?? DEFAULT_YEAR,
        meetingKey: sessions[0].meeting_key,
        sessionKey: sessions[0].session_key,
      };
    }
  } catch {
    /* fall through */
  }
  return { year: DEFAULT_YEAR, meetingKey: DEFAULT_MEETING_KEY, sessionKey: DEFAULT_SESSION_KEY };
}

export { snapshotAt };
