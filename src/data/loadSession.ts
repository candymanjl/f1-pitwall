import { DEFAULT_MEETING_KEY, DEFAULT_SESSION_KEY, DEFAULT_YEAR } from "../config";
import { parseTs } from "../lib/time";
import { apiGet } from "./client";
import { fillMissingLapStarts, timingLooksSparse } from "./lapStarts";
import { isLiveLock } from "./errors";
import { snapshotAt } from "./derive";
import { isRaceOrSprint } from "./grid";
import { loadDriverLocations } from "./carLocation";
import { createFetchTracker, trackJob, type FetchProgress } from "./loadProgress";
import { detectPitLane, DEFAULT_PIT_ENTRY, DEFAULT_PIT_EXIT, pickPitForTrace } from "./pitlane";
import { cacheCurrentOutline, loadSessionOutline, resolveFallbackOutline } from "./outlineFallback";
import {
  detectCorners,
  liveOutlineBeatsFallback,
  outlineFromLocations,
  outlineIsUsable,
  sectorFractions,
  sectorFracsFromLocations,
} from "./track";
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

export type LoadProgress = "timing" | "outline" | "map" | "weekend";

export type { FetchProgress };

export type LoadBundleOpts = {
  meeting?: Meeting | null;
  weekendSessions?: Session[] | null;
  page?: PageId;
  onProgress?: (phase: LoadProgress, bundle: SessionBundle) => void;
  onFetch?: (progress: FetchProgress) => void;
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
    outlineFrom: null,
  };
}

async function loadWeekendStints(
  weekendSessions: Session[],
  sessionKey: number,
  current: Stint[],
  onSession?: (session: Session) => void,
): Promise<Stint[]> {
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
        } finally {
          onSession?.(s);
        }
      }),
  );
  return [...current, ...extras.flat()];
}

export async function loadBundle(sessionKey: number, opts: LoadBundleOpts = {}): Promise<SessionBundle> {
  const tracker = createFetchTracker(opts.onFetch);
  const cached = cachedSession(opts.weekendSessions ?? undefined, sessionKey);
  const session = cached
    ? cached
    : (await trackJob(tracker, "session", apiGet<Session[]>("sessions", { session_key: sessionKey })))[0];
  if (!session) throw new Error("Session not found");

  const knownMeeting = cachedMeeting(opts.meeting ? [opts.meeting] : undefined, session.meeting_key);
  const weekendKnown =
    opts.weekendSessions &&
    opts.weekendSessions.length > 0 &&
    opts.weekendSessions.every((s) => s.meeting_key === session.meeting_key)
      ? opts.weekendSessions
      : null;

  const raceLike = /race|sprint/i.test(session.session_name);
  const [meetingRow, weekendSessions, drivers, rawLaps, rawStints, rawPits, rawWeather, rawRaceControl, rawPositions, intervals, startingGrid] =
    await Promise.all([
      knownMeeting
        ? Promise.resolve(knownMeeting)
        : trackJob(
            tracker,
            "meetings",
            apiGet<Meeting[]>("meetings", { meeting_key: session.meeting_key }).then((rows) => rows[0]),
          ),
      weekendKnown
        ? Promise.resolve(weekendKnown)
        : trackJob(tracker, "sessions", apiGet<Session[]>("sessions", { meeting_key: session.meeting_key })),
      trackJob(tracker, "drivers", apiGet<Driver[]>("drivers", { session_key: sessionKey })),
      trackJob(tracker, "laps", apiGet<Lap[]>("laps", { session_key: sessionKey })),
      trackJob(tracker, "stints", apiGet<Stint[]>("stints", { session_key: sessionKey })),
      trackJob(tracker, "pit", apiGet<Pit[]>("pit", { session_key: sessionKey })),
      trackJob(tracker, "weather", apiGet<Weather[]>("weather", { session_key: sessionKey })),
      trackJob(tracker, "race control", apiGet<RaceControl[]>("race_control", { session_key: sessionKey })),
      trackJob(tracker, "position", apiGet<Position[]>("position", { session_key: sessionKey })),
      raceLike
        ? trackJob(
            tracker,
            "intervals",
            apiGet<Interval[]>("intervals", { session_key: sessionKey }).catch((err) => {
              if (isLiveLock(err)) throw err;
              return [] as Interval[];
            }),
          )
        : Promise.resolve([] as Interval[]),
      isRaceOrSprint(session)
        ? trackJob(
            tracker,
            "starting grid",
            apiGet<StartingGrid[]>("starting_grid", { session_key: sessionKey }).catch((err) => {
              if (isLiveLock(err)) throw err;
              return [] as StartingGrid[];
            }),
          )
        : Promise.resolve([] as StartingGrid[]),
    ]);

  const meeting = meetingRow;
  if (!meeting) throw new Error("Meeting not found");

  const recovered = await recoverEmptyTiming(sessionKey, {
    laps: rawLaps,
    stints: rawStints,
    weather: rawWeather,
    positions: rawPositions,
    pits: rawPits,
    raceControl: rawRaceControl,
  });
  const laps = fillMissingLapStarts(recovered.laps, parseTs(session.date_start));
  const stints = recovered.stints;
  const weather = recovered.weather;
  const positions = recovered.positions;
  const pits = recovered.pits;
  const raceControl = recovered.raceControl;

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

  if (sortedDrivers.length) tracker.add(sortedDrivers.length);
  const locP = loadDriverLocations(sessionKey, sortedDrivers, session.date_start, session.date_end, (d) => {
    tracker.mark(`location · ${d.name_acronym || d.driver_number}`);
  }).catch((err) => {
    if (isLiveLock(err)) throw err;
    return [] as LocationSample[];
  });
  /** Outline fetch starts with timing data — never waits for the Track map tab, pit marks, or all-driver GPS. */
  const trackP = (async () => {
    const loaded = await trackJob(tracker, "track outline", loadSessionOutline(sessionKey, laps, sortedDrivers));
    let track = loaded.track;
    let sectorFracs = loaded.sectorFracs ?? bundle.sectorFracs;
    let outlineFrom = bundle.outlineFrom ?? null;
    if (!outlineIsUsable(track)) {
      const fallback = await trackJob(
        tracker,
        "circuit outline",
        resolveFallbackOutline({ session, meeting, weekendSessions: sortedWeekend }),
      );
      if (fallback && outlineIsUsable(fallback.track)) {
        track = fallback.track;
        sectorFracs = fallback.sectorFracs ?? sectorFracs;
        outlineFrom = fallback.from;
      }
    } else {
      outlineFrom = null;
    }
    const corners = detectCorners(track);
    bundle = { ...bundle, track, corners, sectorFracs, outlineFrom };
    if (!outlineFrom) cacheCurrentOutline(bundle);
    opts.onProgress?.("outline", bundle);
    const wantsPit = Boolean(pickPitForTrace(pits) && track.length >= 2);
    const pitMarks = wantsPit
      ? await trackJob(tracker, "pit lane", loadPitMarks(sessionKey, track, pits))
      : await loadPitMarks(sessionKey, track, pits);
    bundle = { ...bundle, pitEntry: pitMarks.entry, pitExit: pitMarks.exit };
    return { track, corners, pitMarks, sectorFracs, outlineFrom };
  })();
  const extraSessions = sortedWeekend.filter((s) => s.session_key !== sessionKey);
  if (extraSessions.length) tracker.add(extraSessions.length);
  const stintP = loadWeekendStints(sortedWeekend, sessionKey, stints, (s) => {
    tracker.mark(`stints · ${s.session_name}`);
  });

  const applyMap = async () => {
    const [locations, trackBits] = await Promise.all([locP, trackP]);
    let track = trackBits.track;
    let corners = trackBits.corners;
    let pitMarks = trackBits.pitMarks;
    let sectorFracs = trackBits.sectorFracs;
    let outlineFrom = trackBits.outlineFrom;
    if (!outlineIsUsable(track) || outlineFrom) {
      const fromGps = outlineFromLocations(locations, laps, sortedDrivers);
      if (liveOutlineBeatsFallback(fromGps, outlineFrom ? track : [])) {
        track = fromGps;
        corners = detectCorners(track);
        pitMarks = await loadPitMarks(sessionKey, track, pits);
        sectorFracs = sectorFracsFromLocations(locations, laps, sortedDrivers) ?? sectorFracs;
        outlineFrom = null;
      }
    }
    bundle = {
      ...bundle,
      locations,
      track,
      corners,
      sectorFracs,
      pitEntry: pitMarks.entry,
      pitExit: pitMarks.exit,
      outlineFrom,
    };
    if (!outlineFrom) cacheCurrentOutline(bundle);
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

const FORCE = { force: true as const, ttlMs: 0 };

async function refetchIfEmpty<T>(path: string, sessionKey: number, current: T[]): Promise<T[]> {
  if (current.length) return current;
  return apiGet<T[]>(path, { session_key: sessionKey }, FORCE);
}

/** A live session cached as [] would otherwise leave Timing / weather / laps blank after it finishes. */
async function recoverEmptyTiming(
  sessionKey: number,
  current: {
    laps: Lap[];
    stints: Stint[];
    weather: Weather[];
    positions: Position[];
    pits: Pit[];
    raceControl: RaceControl[];
  },
): Promise<typeof current> {
  if (!timingLooksSparse(current)) return current;
  const [laps, weather, positions, pits, raceControl, stints] = await Promise.all([
    refetchIfEmpty<Lap>("laps", sessionKey, current.laps),
    refetchIfEmpty<Weather>("weather", sessionKey, current.weather),
    refetchIfEmpty<Position>("position", sessionKey, current.positions),
    refetchIfEmpty<Pit>("pit", sessionKey, current.pits),
    refetchIfEmpty<RaceControl>("race_control", sessionKey, current.raceControl),
    refetchIfEmpty<Stint>("stints", sessionKey, current.stints),
  ]);
  return { laps, stints, weather, positions, pits, raceControl };
}

/** Full REST snapshot after a live session ends, replacing the 20s incremental window. */
export async function refreshTimingData(bundle: SessionBundle): Promise<SessionBundle> {
  const sessionKey = bundle.session.session_key;
  const raceLike = /race|sprint/i.test(bundle.session.session_name);
  const [laps, stints, pits, weather, raceControl, positions, intervals] = await Promise.all([
    apiGet<Lap[]>("laps", { session_key: sessionKey }, FORCE),
    apiGet<Stint[]>("stints", { session_key: sessionKey }, FORCE),
    apiGet<Pit[]>("pit", { session_key: sessionKey }, FORCE),
    apiGet<Weather[]>("weather", { session_key: sessionKey }, FORCE),
    apiGet<RaceControl[]>("race_control", { session_key: sessionKey }, FORCE),
    apiGet<Position[]>("position", { session_key: sessionKey }, FORCE),
    raceLike
      ? apiGet<Interval[]>("intervals", { session_key: sessionKey }, FORCE).catch((err) => {
          if (isLiveLock(err)) throw err;
          return bundle.intervals;
        })
      : Promise.resolve(bundle.intervals),
  ]);
  let locations = bundle.locations;
  try {
    locations = await loadDriverLocations(
      sessionKey,
      bundle.drivers,
      bundle.session.date_start,
      bundle.session.date_end,
    );
  } catch (err) {
    if (isLiveLock(err)) throw err;
  }
  return {
    ...bundle,
    laps: fillMissingLapStarts(laps, parseTs(bundle.session.date_start)),
    stints,
    pits,
    weather,
    raceControl,
    positions,
    intervals,
    locations,
  };
}

export { snapshotAt, timingLooksSparse };
