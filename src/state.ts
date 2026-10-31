import { LIVE_POLL_MS, readMode, readPitLoss, SPEEDS, writeMode, writePitLoss } from "./config";
import { snapshotAt } from "./data/derive";
import { loadBundle, loadMeetings, loadSessions } from "./data/loadSession";
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
  selectedDriver: number | null;
  telemetry: { driver: number; lap: number }[];
  traceMode: "leader" | "average" | "driver";
  traceDriver: number | null;
  pitMode: "green" | "vsc" | "sc";
  hiddenDrivers: number[];
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
  selectedDriver: null,
  telemetry: [],
  traceMode: "leader",
  traceDriver: null,
  pitMode: "green",
  hiddenDrivers: [],
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
  state.selectedDriver = n;
  emit();
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
  emit();
}

export function setPitLoss(loss: AppState["pitLoss"]): void {
  state.pitLoss = loss;
  writePitLoss(loss);
  emit();
}

export async function changeYear(year: number): Promise<void> {
  state.year = year;
  state.loading = "Loading meetings…";
  emit();
  state.meetings = await loadMeetings(year);
  state.meetingKey = state.meetings[0]?.meeting_key ?? 0;
  await changeMeeting(state.meetingKey);
}

export async function changeMeeting(meetingKey: number): Promise<void> {
  state.meetingKey = meetingKey;
  state.loading = "Loading sessions…";
  emit();
  state.sessions = await loadSessions(meetingKey);
  const race = state.sessions.find((s) => s.session_name === "Race") ?? state.sessions[state.sessions.length - 1];
  state.sessionKey = race?.session_key ?? 0;
  if (state.sessionKey) await changeSession(state.sessionKey);
  else {
    state.loading = "";
    emit();
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
    state.selectedDriver = bundle.drivers[0]?.driver_number ?? null;
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
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    state.loading = "";
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
