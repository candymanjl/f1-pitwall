import { DEFAULT_MEETING_KEY, DEFAULT_SESSION_KEY, DEFAULT_YEAR } from "../config";
import { parseTs } from "../lib/time";
import { apiGet } from "./client";
import { isLiveLock } from "./errors";
import { snapshotAt } from "./derive";
import { isRaceOrSprint } from "./grid";
import { loadDriverLocations } from "./carLocation";
import { detectPitLane, DEFAULT_PIT_ENTRY, DEFAULT_PIT_EXIT, pickPitForTrace } from "./pitlane";
import { buildOutline, detectCorners, lapWindow, pickOutlineLap, sectorFractions } from "./track";
import type {
  Driver,
  Interval,
  Lap,
  LocationSample,
  Meeting,
  PageId,
  Pit,
  Position,
  RaceControl,
  Session,
  SessionBundle,
  StartingGrid,
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

export function cachedSession(sessions: Session[] | undefined, sessionKey: number): Session | undefined {
  return sessions?.find((s) => s.session_key === sessionKey);
}

export function cachedMeeting(meetings: Meeting[] | undefined, meetingKey: number): Meeting | undefined {
  return meetings?.find((m) => m.meeting_key === meetingKey);
}

export function mapPagesFirst(page?: PageId): boolean {
  return page !== "tyres" && page !== "strategy";
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

export type LoadProgress = "timing" | "map" | "weekend";

export type LoadBundleOpts = {
  meeting?: Meeting | null;
  weekendSessions?: Session[] | null;
  page?: PageId;
  onProgress?: (phase: LoadProgress, bundle: SessionBundle) => void;
};

function emptyBundle(meeting: Meeting, session: Session, weekendSessions: Session[]): SessionBundle {
  return {
    meeting,
    session,
    weekendSessions: weekendSessions.slice().sort((a, b) => parseTs(a.date_start) - parseTs(b.date_start)),
    drivers: [],
    laps: [],
    intervals: [],
    positions: [],
    startingGrid: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track: [],
    corners: [],
    sectorFracs: [0.3, 0.6, 1],
    pitEntry: DEFAULT_PIT_ENTRY,
    pitExit: DEFAULT_PIT_EXIT,
    locations: [],
  };
}

async function loadWeekendStints(weekendSessions: Session[], sessionKey: number, current: Stint[]): Promise<Stint[]> {
  const extras = await Promise.all(
    weekendSessions
      .filter((s) => s.session_key !== sessionKey)
      .map(async (s) => {
        try {
          const extra = await apiGet<Stint[]>("stints", { session_key: s.session_key });
          return extra.map((row) => ({ ...row, session_key: s.session_key }));
        } catch (err) {
          if (isLiveLock(err)) throw err;
          return [] as Stint[];
        }
      }),
  );
  return [...current, ...extras.flat()];
}

export async function loadBundle(sessionKey: number, opts: LoadBundleOpts = {}): Promise<SessionBundle> {
  const cached = cachedSession(opts.weekendSessions ?? undefined, sessionKey);
  const session = cached ?? (await apiGet<Session[]>("sessions", { session_key: sessionKey }))[0];
  if (!session) throw new Error("Session not found");

  const knownMeeting = cachedMeeting(opts.meeting ? [opts.meeting] : undefined, session.meeting_key);
  const weekendKnown =
    opts.weekendSessions &&
    opts.weekendSessions.length > 0 &&
    opts.weekendSessions.every((s) => s.meeting_key === session.meeting_key)
      ? opts.weekendSessions
      : null;

  const raceLike = /race|sprint/i.test(session.session_name);
  const [meetingRow, weekendSessions, drivers, laps, stints, pits, weather, raceControl, positions, intervals, startingGrid] =
    await Promise.all([
      knownMeeting
        ? Promise.resolve(knownMeeting)
        : apiGet<Meeting[]>("meetings", { meeting_key: session.meeting_key }).then((rows) => rows[0]),
      weekendKnown
        ? Promise.resolve(weekendKnown)
        : apiGet<Session[]>("sessions", { meeting_key: session.meeting_key }),
      apiGet<Driver[]>("drivers", { session_key: sessionKey }),
      apiGet<Lap[]>("laps", { session_key: sessionKey }),
      apiGet<Stint[]>("stints", { session_key: sessionKey }),
      apiGet<Pit[]>("pit", { session_key: sessionKey }),
      apiGet<Weather[]>("weather", { session_key: sessionKey }),
      apiGet<RaceControl[]>("race_control", { session_key: sessionKey }),
      apiGet<Position[]>("position", { session_key: sessionKey }),
      raceLike
        ? apiGet<Interval[]>("intervals", { session_key: sessionKey }).catch((err) => {
            if (isLiveLock(err)) throw err;
            return [] as Interval[];
          })
        : Promise.resolve([] as Interval[]),
      isRaceOrSprint(session)
        ? apiGet<StartingGrid[]>("starting_grid", { session_key: sessionKey }).catch((err) => {
            if (isLiveLock(err)) throw err;
            return [] as StartingGrid[];
          })
        : Promise.resolve([] as StartingGrid[]),
    ]);

  const meeting = meetingRow;
  if (!meeting) throw new Error("Meeting not found");

  const sortedWeekend = weekendSessions.slice().sort((a, b) => parseTs(a.date_start) - parseTs(b.date_start));
  const sortedDrivers = drivers.slice().sort((a, b) => a.driver_number - b.driver_number);
  const sectorFracs = sectorFractions(laps);

  let bundle: SessionBundle = {
    ...emptyBundle(meeting, session, sortedWeekend),
    drivers: sortedDrivers,
    laps,
    intervals,
    positions,
    startingGrid,
    stints,
    weekendStints: stints.slice(),
    pits,
    weather,
    raceControl,
    sectorFracs,
  };
  opts.onProgress?.("timing", bundle);

  const locP = loadDriverLocations(sessionKey, sortedDrivers, session.date_start, session.date_end).catch((err) => {
    if (isLiveLock(err)) throw err;
    return [] as LocationSample[];
  });
  const trackP = (async () => {
    const track = await loadTrack(sessionKey, laps, sortedDrivers);
    const pitMarks = await loadPitMarks(sessionKey, track, pits);
    return { track, corners: detectCorners(track), pitMarks };
  })();
  const stintP = loadWeekendStints(sortedWeekend, sessionKey, stints);

  const applyMap = async () => {
    const [locations, trackBits] = await Promise.all([locP, trackP]);
    bundle = {
      ...bundle,
      locations,
      track: trackBits.track,
      corners: trackBits.corners,
      pitEntry: trackBits.pitMarks.entry,
      pitExit: trackBits.pitMarks.exit,
    };
    opts.onProgress?.("map", bundle);
  };
  const applyWeekend = async () => {
    const weekendStints = await stintP;
    bundle = { ...bundle, weekendStints };
    opts.onProgress?.("weekend", bundle);
  };

  if (mapPagesFirst(opts.page)) {
    await applyMap();
    await applyWeekend();
  } else {
    await applyWeekend();
    await applyMap();
  }

  return bundle;
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
