import { LIVE_LOCK_RETRY_MS, LIVE_POLL_MS, readMode, readPitLoss, SPEEDS, writeMode, writePitLoss } from "./config";
import { hasUsableAuth, peekAccessToken, peekAuth } from "./data/auth";
import { applyUiScale, readUiScale, writeUiScale, type UiScalePref } from "./lib/scale";
import { snapshotAt } from "./data/derive";
import { classifyOpenF1Failure, OpenF1Error } from "./data/errors";
import { applyLiveMessage } from "./data/liveMerge";
import { startLiveFeed, type LiveHandle, type LiveSource } from "./data/live";
import { loadBundle, loadMeetings, loadSessions } from "./data/loadSession";
import { followLiveFromScrub, followLiveOnPlay, stepPlayback } from "./lib/playback";
import { historicalStartMs, isFinishedSession, playableEndMs } from "./lib/sessionClock";
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

function syncPlayableRange(): void {
  if (!state.bundle) return;
  const start = parseTs(state.bundle.session.date_start);
  if (Number.isFinite(start)) state.start = start;
  state.end = playableEndMs(state.start, state.bundle);
  if (state.end <= state.start) state.end = state.start + 1;
}

/**
 * In-progress live stays on the newest sample.
 * Historical *and* finished sessions (even if Settings data mode is Live) open at mid-race.
 * There is no saved playhead — localStorage only keeps the data mode, not t.
 */
export function applyLoadedClock(): void {
  syncPlayableRange();
  if (state.mode === "live" && !isFinishedSession(state.bundle)) {
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
}

let reloadInFlight: Promise<void> | null = null;
let reloadGen = 0;

export async function reloadAll(opts: { force?: boolean } = {}): Promise<void> {
  if (reloadInFlight && !opts.force) return reloadInFlight;
  const gen = ++reloadGen;
  const work = (async () => {
    state.loading = state.lock ? "Retrying OpenF1…" : "Loading meetings…";
    state.error = "";
    emit(true);
    try {
      state.meetings = await loadMeetings(state.year);
      if (gen !== reloadGen) return;
      state.sessions = await loadSessions(state.meetingKey);
      if (gen !== reloadGen) return;
      if (state.sessionKey) await changeSession(state.sessionKey);
      else {
        state.loading = "";
        emit(true);
      }
    } catch (err) {
      if (gen !== reloadGen) return;
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

export async function changeYear(year: number): Promise<void> {
  state.year = year;
  state.loading = "Loading meetings…";
  emit();
  try {
    state.meetings = await loadMeetings(year);
    state.meetingKey = state.meetings[0]?.meeting_key ?? 0;
    await changeMeeting(state.meetingKey);
  } catch (err) {
    applyFetchError(err);
  }
}

export async function changeMeeting(meetingKey: number): Promise<void> {
  state.meetingKey = meetingKey;
  state.loading = "Loading sessions…";
  emit();
  try {
    state.sessions = await loadSessions(meetingKey);
    const race = state.sessions.find((s) => s.session_name === "Race") ?? state.sessions[state.sessions.length - 1];
    state.sessionKey = race?.session_key ?? 0;
    if (state.sessionKey) await changeSession(state.sessionKey);
    else {
      state.loading = "";
      emit();
    }
  } catch (err) {
    applyFetchError(err);
  }
}

export async function changeSession(sessionKey: number): Promise<void> {
  state.sessionKey = sessionKey;
  state.loading = "Loading session data from OpenF1…";
  state.error = "";
  state.playing = false;
  state.followLive = false;
  emit();
  try {
    const bundle = await loadBundle(sessionKey);
    state.bundle = bundle;
    state.start = parseTs(bundle.session.date_start);
    applyLoadedClock();
    state.followLive = false;
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
    refreshSnap();
    state.loading = "";
    state.lock = null;
    state.error = "";
    state.panelErrors = { track: bundle.track.length ? "" : "Track outline could not be loaded from OpenF1 /location.", telemetry: "" };
    stopLockRetry();
    syncLiveFeed();
  } catch (err) {
    applyFetchError(err);
    return;
  }
  emit();
}

let lastTick = performance.now();
let liveTimer = 0;

function tick(now: number): void {
  const dt = now - lastTick;
  lastTick = now;
  if (state.playing && state.bundle && !state.scrubbing) {
    syncPlayableRange();
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
    refreshSnap();
    emit();
  }
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
  syncPlayableRange();
  if (state.scrubbing || !state.followLive || !state.playing) {
    state.t = Math.min(state.end, Math.max(state.start, held));
    return;
  }
  state.t = state.end;
  refreshSnap();
  emit();
}

/** Merge an MQTT/poll payload and keep a scrubbed cursor put. */
export function ingestLive(topic: string, payload: unknown, mode: "merge" | "replace" = "merge"): void {
  if (!state.bundle) return;
  state.bundle = applyLiveMessage(state.bundle, topic, payload, state.sessionKey, mode);
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
  if (state.mode !== "live" || !state.bundle || !state.sessionKey) return;
  if (!auth.signedIn && auth.source !== "manual") return;
  liveHandle = startLiveFeed({
    username: auth.username || "openf1",
    sessionKey: state.sessionKey,
    onMessage: (topic, payload, mode) => {
      ingestLive(topic, payload, mode);
    },
    onStatus: (source) => {
      state.liveSource = source;
      emit();
    },
  });
}
