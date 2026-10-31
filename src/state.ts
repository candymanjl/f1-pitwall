import { LIVE_LOCK_RETRY_MS, LIVE_POLL_MS, readMode, readPitLoss, SPEEDS, writeMode, writePitLoss } from "./config";
import { peekAuth } from "./data/auth";
import { snapshotAt } from "./data/derive";
import { classifyOpenF1Failure, type OpenF1Error } from "./data/errors";
import { applyLiveMessage } from "./data/liveMerge";
import { startLiveFeed, type LiveHandle, type LiveSource } from "./data/live";
import { loadBundle, loadMeetings, loadSessions } from "./data/loadSession";
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

export function setClock(t: number): void {
  state.t = Math.min(state.end, Math.max(state.start, t));
  refreshSnap();
  emit();
}

export function setPlaying(playing: boolean): void {
  state.playing = playing;
  emit();
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

export function setPanelError(key: keyof AppState["panelErrors"], message: string): void {
  state.panelErrors[key] = message;
  emit();
}

export function applyFetchError(err: unknown): OpenF1Error {
  const e = classifyOpenF1Failure({ cause: err });
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

export async function retryNow(): Promise<void> {
  if (state.lock === "live") state.retryAt = Date.now() + LIVE_LOCK_RETRY_MS;
  else state.retryAt = 0;
  await reloadAll();
}

let reloadInFlight: Promise<void> | null = null;

export async function reloadAll(): Promise<void> {
  if (reloadInFlight) return reloadInFlight;
  reloadInFlight = (async () => {
    state.loading = state.lock ? "Retrying OpenF1…" : "Loading meetings…";
    state.error = "";
    emit(true);
    try {
      state.meetings = await loadMeetings(state.year);
      state.sessions = await loadSessions(state.meetingKey);
      if (state.sessionKey) await changeSession(state.sessionKey);
      else {
        state.loading = "";
        emit(true);
      }
    } catch (err) {
      applyFetchError(err);
    }
  })().finally(() => {
    reloadInFlight = null;
  });
  return reloadInFlight;
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
  emit();
  try {
    const bundle = await loadBundle(sessionKey);
    state.bundle = bundle;
    state.start = parseTs(bundle.session.date_start);
    state.end = parseTs(bundle.session.date_end);
    if (!Number.isFinite(state.end) || state.end <= state.start) state.end = state.start + 90 * 60 * 1000;
    const firstLap = bundle.laps
      .map((l) => parseTs(l.date_start))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)[0];
    const interesting = Number.isFinite(firstLap)
      ? firstLap + Math.min(18 * 60 * 1000, (state.end - firstLap) * 0.28)
      : state.start + (state.end - state.start) * 0.25;
    state.t = Math.min(state.end, Math.max(state.start, interesting));
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
  if (state.mode === "historical" && state.playing && state.bundle) {
    const next = state.t + dt * state.speed;
    if (next >= state.end) {
      state.t = state.end;
      state.playing = false;
    } else {
      state.t = next;
    }
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
    if (state.mode !== "live" || !state.bundle) return;
    state.t = Date.now();
    refreshSnap();
    emit();
  }, LIVE_POLL_MS);
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
      if (!state.bundle) return;
      state.bundle = applyLiveMessage(state.bundle, topic, payload, state.sessionKey, mode);
      if (state.mode === "live") state.t = Date.now();
      refreshSnap();
      emit();
    },
    onStatus: (source) => {
      state.liveSource = source;
      emit();
    },
  });
}
