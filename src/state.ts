import {
  LIVE_LOCK_RETRY_MS,
  LIVE_POLL_MS,
  readLiveDebug,
  readMode,
  readPitLoss,
  readRelayUrl,
  SPEEDS,
  writeLiveDebug,
  writeMode,
  writePitLoss,
} from "./config";
import { hasUsableAuth, peekAccessToken, peekAuth } from "./data/auth";
import { applyUiScale, readUiScale, writeUiScale, type UiScalePref } from "./lib/scale";
import { snapshotAt } from "./data/derive";
import { classifyOpenF1Failure, OpenF1Error } from "./data/errors";
import { applyLiveUpdate } from "./data/liveMerge";
import { startLiveFeed, type LiveHandle, type LiveSource } from "./data/live";
import { emptyLiveDebug, seedLiveCursors, type LivePollDebug } from "./data/livePoll";
import { loadBundle, loadMeetings, loadSessions } from "./data/loadSession";
import { followLiveFromScrub, followLiveOnPlay, stepPlayback } from "./lib/playback";
import { historicalStartMs, isFinishedSession, latestSampleMs, playableEndMs } from "./lib/sessionClock";
import { nextSelection } from "./lib/select";
import { parseTs } from "./lib/time";
import type { DataMode } from "./config";
import type { Meeting, PageId, Session, SessionBundle, TimingSnapshot } from "./data/types";

export type AppState = {
  page: PageId;
  year: number;
  meetingKey: number;
  sessionKey: number;
  meetings: Meeting[];
  sessions: Session[];
  bundle: SessionBundle | null;
  snap: TimingSnapshot | null;
  t: number;
  start: number;
  end: number;
  playing: boolean;
  /** True only after LIVE or a scrub to the very end — never because Date.now() moved. */
  followLive: boolean;
  /** True while the user is dragging the playback slider. */
  scrubbing: boolean;
  speed: number;
  mode: DataMode;
  pitLoss: { green: number; vsc: number; sc: number };
  loading: string;
  /** True while Year/Meeting list fetches run — does not replace the loaded session. */
  listsBusy: boolean;
  error: string;
  lock: "live" | null;
  retryAt: number;
  panelErrors: { track: string; telemetry: string };
  selectedDriver: number | null;
  selectedDrivers: number[];
  telemetry: { driver: number; lap: number }[];
  traceMode: "leader" | "average" | "driver";
  traceDriver: number | null;
  pitMode: "green" | "vsc" | "sc";
  hiddenDrivers: number[];
  liveSource: LiveSource;
  uiScale: UiScalePref;
  showLiveDebug: boolean;
  liveDebug: LivePollDebug;
  /** Newest sample time, maintained on ingest. Full scan only after a bundle load. */
  latestMs: number;
  /** Wall clock of the last poll/MQTT batch that added rows. */
  lastIngestAt: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();

export const state: AppState = {
  page: "trackmap",
  year: 2025,
  meetingKey: 1272,
  sessionKey: 9877,
  meetings: [],
  sessions: [],
  bundle: null,
  snap: null,
  t: 0,
  start: 0,
  end: 1,
  playing: false,
  followLive: false,
  scrubbing: false,
  speed: 4,
  mode: readMode(),
  pitLoss: readPitLoss(),
  loading: "",
  listsBusy: false,
  error: "",
  lock: null,
  retryAt: 0,
  panelErrors: { track: "", telemetry: "" },
  selectedDriver: null,
  selectedDrivers: [],
  telemetry: [],
  traceMode: "leader",
  traceDriver: null,
  pitMode: "green",
  hiddenDrivers: [],
  liveSource: "off",
  uiScale: readUiScale(),
  showLiveDebug: readLiveDebug(),
  liveDebug: emptyLiveDebug(),
  latestMs: Number.NaN,
  lastIngestAt: 0,
};

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let emitTimer = 0;
export function emit(immediate = false): void {
  if (immediate || !state.playing) {
    for (const fn of listeners) fn();
    return;
  }
  if (emitTimer) return;
  emitTimer = window.setTimeout(() => {
    emitTimer = 0;
    for (const fn of listeners) fn();
  }, 80);
}

const LIVE_SNAP_MS = 125;
let liveSnapAt = 0;
let liveSnapTimer = 0;

function sessionIsFinished(bundle = state.bundle): boolean {
  return isFinishedSession(bundle, Date.now(), {
    live: state.mode === "live",
    lastIngestAt: state.lastIngestAt,
    latestMs: state.latestMs,
  });
}

function applyLatestMs(t: number): void {
  if (!Number.isFinite(t)) return;
  if (!Number.isFinite(state.latestMs) || t > state.latestMs) state.latestMs = t;
}

function scheduleLiveSnap(): void {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - liveSnapAt >= LIVE_SNAP_MS) {
    liveSnapAt = now;
    refreshSnap();
    emit();
    return;
  }
  if (liveSnapTimer) return;
  liveSnapTimer = window.setTimeout(() => {
    liveSnapTimer = 0;
    liveSnapAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    refreshSnap();
    emit();
  }, LIVE_SNAP_MS);
}

function refreshSnap(): void {
  if (!state.bundle) {
    state.snap = null;
    return;
  }
  state.snap = snapshotAt(state.bundle, state.t);
}

export function setPage(page: PageId): void {
  state.page = page;
  location.hash = page;
  emit(true);
}

function syncPlayableRange(scan = false): void {
  if (!state.bundle) return;
  const start = parseTs(state.bundle.session.date_start);
  if (Number.isFinite(start)) state.start = start;
  if (scan || !Number.isFinite(state.latestMs)) {
    state.latestMs = latestSampleMs(state.bundle);
  }
  if (Number.isFinite(state.latestMs) && state.latestMs > state.start) state.end = state.latestMs;
  else state.end = playableEndMs(state.start, state.bundle);
  if (state.end <= state.start) state.end = state.start + 1;
}

/**
 * In-progress live stays on the newest sample.
 * Historical *and* finished sessions (even if Settings data mode is Live) open at mid-race.
 * There is no saved playhead — localStorage only keeps the data mode, not t.
 */
export function applyLoadedClock(): void {
  syncPlayableRange(true);
  if (state.mode === "live" && !sessionIsFinished()) {
    state.t = state.end;
    return;
  }
  state.t = historicalStartMs(state.start, state.end, state.bundle);
}

export function setClock(t: number, source: "scrub" | "code" = "code"): void {
  syncPlayableRange();
  state.t = Math.min(state.end, Math.max(state.start, t));
  if (source === "scrub") {
    state.followLive = followLiveFromScrub(state.t, state.start, state.end, state.mode);
  }
  refreshSnap();
  emit(true);
}

export function setScrubbing(on: boolean): void {
  state.scrubbing = on;
  if (on) state.followLive = false;
  if (!on) emit(true);
}

export function pinToLive(): void {
  if (state.mode !== "live") return;
  syncPlayableRange();
  state.followLive = true;
  state.playing = true;
  state.t = state.end;
  refreshSnap();
  emit(true);
}

export function setPlaying(playing: boolean): void {
  state.playing = playing;
  if (!playing) state.followLive = false;
  else state.followLive = followLiveOnPlay(state.t, state.end, state.mode);
  emit(true);
}

export function setSpeed(speed: number): void {
  state.speed = SPEEDS.includes(speed as (typeof SPEEDS)[number]) ? speed : 1;
  emit();
}

export function setSelectedDriver(n: number | null): void {
  state.selectedDrivers = n == null ? [] : [n];
  state.selectedDriver = n;
  emit(true);
}

export function selectDriver(n: number, ev?: { shiftKey?: boolean }): void {
  state.selectedDrivers = nextSelection(state.selectedDrivers, n, !!ev?.shiftKey);
  state.selectedDriver = state.selectedDrivers[state.selectedDrivers.length - 1] ?? null;
  emit(true);
}

export function isDriverSelected(n: number): boolean {
  return state.selectedDrivers.includes(n);
}

export function hasDriverSelection(): boolean {
  return state.selectedDrivers.length > 0;
}

export function setTelemetrySlots(slots: { driver: number; lap: number }[]): void {
  state.telemetry = slots.slice(0, 4);
  emit();
}

export function setTraceMode(mode: AppState["traceMode"], driver?: number | null): void {
  state.traceMode = mode;
  if (driver != null) state.traceDriver = driver;
  emit();
}

export function setPitMode(mode: AppState["pitMode"]): void {
  state.pitMode = mode;
  emit();
}

export function setDataMode(mode: DataMode): void {
  state.mode = mode;
  writeMode(mode);
  if (mode === "live" && state.bundle && !sessionIsFinished()) {
    syncPlayableRange();
    state.followLive = true;
    state.playing = true;
    state.t = state.end;
  }
  syncLiveFeed();
  emit();
}

export function setPitLoss(loss: AppState["pitLoss"]): void {
  state.pitLoss = loss;
  writePitLoss(loss);
  emit();
}

export function setUiScale(pref: UiScalePref): void {
  state.uiScale = pref;
  writeUiScale(pref);
  applyUiScale(pref);
  emit(true);
}

export function setShowLiveDebug(on: boolean): void {
  state.showLiveDebug = on;
  writeLiveDebug(on);
  emit(true);
}

export function setPanelError(key: keyof AppState["panelErrors"], message: string): void {
  state.panelErrors[key] = message;
  emit();
}

export function applyFetchError(err: unknown): OpenF1Error {
  const e = classifyOpenF1Failure({
    cause: err,
    status: err instanceof OpenF1Error ? err.status : undefined,
    authenticated: hasUsableAuth(),
    tokenAttached: Boolean(peekAccessToken()),
  });
  state.loading = "";
  if (e.kind === "live-lock") {
    state.lock = "live";
    state.error = "";
    if (!state.retryAt || state.retryAt < Date.now()) state.retryAt = Date.now() + LIVE_LOCK_RETRY_MS;
    startLockRetry();
  } else {
    state.lock = null;
    state.error = e.message;
    stopLockRetry();
  }
  emit(true);
  return e;
}

export function clearLiveLock(): void {
  state.lock = null;
  state.error = "";
  state.retryAt = 0;
  stopLockRetry();
  emit(true);
}

export async function retryNow(): Promise<void> {
  if (hasUsableAuth()) {
    clearLiveLock();
  } else if (state.lock === "live") {
    state.retryAt = Date.now() + LIVE_LOCK_RETRY_MS;
  } else {
    state.retryAt = 0;
  }
  await reloadAll({ force: true });
  if (state.sessionKey) await loadSelectedSession();
}

let reloadInFlight: Promise<void> | null = null;
let reloadGen = 0;

export async function reloadAll(opts: { force?: boolean } = {}): Promise<void> {
  if (reloadInFlight && !opts.force) return reloadInFlight;
  const gen = ++reloadGen;
  const work = (async () => {
    state.listsBusy = true;
    if (!state.bundle) state.loading = state.lock ? "Retrying OpenF1…" : "Loading meetings…";
    state.error = "";
    emit(true);
    try {
      state.meetings = await loadMeetings(state.year);
      if (gen !== reloadGen) return;
      state.sessions = await loadSessions(state.meetingKey);
      if (gen !== reloadGen) return;
      state.listsBusy = false;
      state.loading = "";
      emit(true);
    } catch (err) {
      if (gen !== reloadGen) return;
      state.listsBusy = false;
      applyFetchError(err);
    }
  })().finally(() => {
    if (reloadInFlight === work) reloadInFlight = null;
  });
  reloadInFlight = work;
  return work;
}

let lockTimer = 0;
function startLockRetry(): void {
  if (lockTimer) return;
  lockTimer = window.setInterval(() => {
    if (state.lock !== "live") {
      stopLockRetry();
      return;
    }
    emit(true);
    if (!reloadInFlight && Date.now() >= state.retryAt) void retryNow();
  }, 1000);
}

function stopLockRetry(): void {
  if (lockTimer) window.clearInterval(lockTimer);
  lockTimer = 0;
  state.retryAt = 0;
}

export function sessionPickerDirty(): boolean {
  return !state.bundle || state.bundle.session.session_key !== state.sessionKey;
}

/** Session the feed is actually showing — never the Year/Meeting/Session picker. */
export function loadedSessionKey(): number {
  return state.bundle?.session.session_key ?? 0;
}

export async function changeYear(year: number): Promise<void> {
  state.year = year;
  state.listsBusy = true;
  emit(true);
  try {
    state.meetings = await loadMeetings(year);
    state.meetingKey = state.meetings[0]?.meeting_key ?? 0;
    await changeMeeting(state.meetingKey);
  } catch (err) {
    state.listsBusy = false;
    applyFetchError(err);
  }
}

export async function changeMeeting(meetingKey: number): Promise<void> {
  state.meetingKey = meetingKey;
  state.listsBusy = true;
  emit(true);
  try {
    state.sessions = await loadSessions(meetingKey);
    const race = state.sessions.find((s) => s.session_name === "Race") ?? state.sessions[state.sessions.length - 1];
    state.sessionKey = race?.session_key ?? 0;
    state.listsBusy = false;
    emit(true);
  } catch (err) {
    state.listsBusy = false;
    applyFetchError(err);
  }
}

/** Update the Session picker only — heavy data waits for Load. */
export function changeSession(sessionKey: number): void {
  state.sessionKey = sessionKey;
  emit(true);
}

const LOAD_LABEL: Record<string, string> = {
  timing: "Loading timing…",
  map: "Loading map…",
  weekend: "Loading weekend…",
};

let loadGen = 0;

export async function loadSelectedSession(): Promise<void> {
  const sessionKey = state.sessionKey;
  if (!sessionKey) return;
  const gen = ++loadGen;
  state.loading = "Loading session…";
  state.error = "";
  emit(true);
  try {
    const meeting = state.meetings.find((m) => m.meeting_key === state.meetingKey) ?? null;
    const bundle = await loadBundle(sessionKey, {
      meeting,
      weekendSessions: state.sessions,
      page: state.page,
      onProgress: (phase, partial) => {
        if (gen !== loadGen) return;
        applyPartialBundle(partial, phase === "timing");
        state.loading = LOAD_LABEL[phase] ?? "Loading session…";
        emit(true);
      },
    });
    if (gen !== loadGen) return;
    applyPartialBundle(bundle, false);
    state.loading = "";
    state.lock = null;
    state.error = "";
    state.panelErrors = {
      track: bundle.track.length ? "" : "Track outline could not be loaded from OpenF1 /location.",
      telemetry: "",
    };
    stopLockRetry();
    syncLiveFeed();
  } catch (err) {
    if (gen !== loadGen) return;
    applyFetchError(err);
    return;
  }
  emit(true);
}

function applyPartialBundle(bundle: SessionBundle, first: boolean): void {
  const firstApply = first || !state.bundle || state.bundle.session.session_key !== bundle.session.session_key;
  state.bundle = bundle;
  if (firstApply) {
    state.lastIngestAt = 0;
    state.start = parseTs(bundle.session.date_start);
    applyLoadedClock();
    if (state.mode === "live" && !sessionIsFinished(bundle)) {
      state.followLive = true;
      state.playing = true;
    } else {
      state.followLive = false;
      state.playing = false;
    }
    state.selectedDriver = null;
    state.selectedDrivers = [];
    const firstFour = bundle.drivers.slice(0, 2).map((d, i) => {
      const laps = bundle.laps
        .filter((l) => l.driver_number === d.driver_number && l.lap_duration && !l.is_pit_out_lap)
        .sort((a, b) => (a.lap_duration ?? 99) - (b.lap_duration ?? 99));
      return { driver: d.driver_number, lap: laps[i === 0 ? 0 : Math.min(1, laps.length - 1)]?.lap_number ?? 5 };
    });
    state.telemetry = firstFour;
    state.traceDriver = bundle.drivers[0]?.driver_number ?? null;
  }
  refreshSnap();
}

let lastTick = performance.now();
let liveTimer = 0;

export function stepClock(dt: number): void {
  if (!state.playing || !state.bundle || state.scrubbing) return;
  if (Number.isFinite(state.latestMs) && state.latestMs > state.start) {
    state.end = Math.max(state.end, state.latestMs);
  }
  const next = stepPlayback({
    t: state.t,
    start: state.start,
    end: state.end,
    playing: state.playing,
    speed: state.speed,
    dt,
    mode: state.mode,
    followLive: state.followLive,
    now: Date.now(),
    scrubbing: state.scrubbing,
  });
  state.t = next.t;
  state.playing = next.playing;
  state.followLive = next.followLive;
  if (state.mode === "live" && state.followLive) scheduleLiveSnap();
  else {
    refreshSnap();
    emit();
  }
}

function tick(now: number): void {
  const dt = now - lastTick;
  lastTick = now;
  stepClock(dt);
  requestAnimationFrame(tick);
}

export function startClock(): void {
  lastTick = performance.now();
  requestAnimationFrame(tick);
  if (liveTimer) window.clearInterval(liveTimer);
  liveTimer = window.setInterval(() => {
    applyLiveClock("poll");
  }, LIVE_POLL_MS);
}

/** Pull the cursor to the newest sample only when the user is actually live-following. */
export function applyLiveClock(_source: "poll" | "mqtt" | "ingest" = "ingest"): void {
  if (state.mode !== "live" || !state.bundle) return;
  const held = state.t;
  if (Number.isFinite(state.latestMs) && state.latestMs > state.start) {
    state.end = Math.max(state.end, state.latestMs);
  }
  if (state.scrubbing || !state.followLive) {
    state.t = Math.min(state.end, Math.max(state.start, held));
    return;
  }
  state.t = state.end;
  scheduleLiveSnap();
}

/** Merge an MQTT/poll payload and keep a scrubbed cursor put. */
export function ingestLive(topic: string, payload: unknown, mode: "merge" | "replace" = "merge"): void {
  if (!state.bundle) return;
  const result = applyLiveUpdate(state.bundle, topic, payload, loadedSessionKey() || undefined, mode);
  if (result.added === 0) return;
  state.bundle = result.bundle;
  applyLatestMs(result.latestMs);
  state.lastIngestAt = Date.now();
  applyLiveClock("mqtt");
  if (!(state.followLive && state.playing) || state.scrubbing) {
    refreshSnap();
    emit();
  }
}

let liveHandle: LiveHandle | null = null;

export function syncLiveFeed(): void {
  liveHandle?.stop();
  liveHandle = null;
  state.liveSource = "off";
  const auth = peekAuth();
  const sessionKey = loadedSessionKey();
  if (state.mode !== "live" || !state.bundle || !sessionKey) return;
  const relay = Boolean(readRelayUrl());
  if (!relay && !auth.signedIn && auth.source !== "manual") return;
  liveHandle = startLiveFeed({
    username: auth.username || "openf1",
    sessionKey: loadedSessionKey,
    cursors: seedLiveCursors(state.bundle),
    page: () => state.page,
    onMessage: (topic, payload, mode) => {
      ingestLive(topic, payload, mode);
    },
    onStatus: (source) => {
      state.liveSource = source;
      emit();
    },
    onDebug: (debug) => {
      state.liveDebug = debug;
      emit();
    },
  });
}
