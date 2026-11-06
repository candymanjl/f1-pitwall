/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadMeetings = vi.fn();
const loadSessions = vi.fn();
const loadBundle = vi.fn();

vi.mock("./data/loadSession", () => ({
  loadMeetings: (...args: unknown[]) => loadMeetings(...args),
  loadSessions: (...args: unknown[]) => loadSessions(...args),
  loadBundle: (...args: unknown[]) => loadBundle(...args),
  refreshTimingData: async (bundle: unknown) => bundle,
}));

import { OpenF1Error } from "./data/errors";
import {
  changeMeeting,
  changeSession,
  changeYear,
  loadSelectedSession,
  reloadAll,
  retryNow,
  sessionPickerDirty,
  state,
} from "./state";

const meeting = {
  meeting_key: 10,
  meeting_name: "Test GP",
  circuit_short_name: "Test",
  country_name: "Test",
  location: "Test",
  date_start: "2025-01-01T00:00:00.000Z",
  year: 2025,
};

const race = {
  session_key: 20,
  meeting_key: 10,
  session_name: "Race",
  session_type: "Race",
  date_start: "2025-01-01T12:00:00.000Z",
  date_end: "2025-01-01T14:00:00.000Z",
  circuit_short_name: "Test",
  country_name: "Test",
  location: "Test",
  year: 2025,
};

const loadedBundle = {
  meeting,
  session: { ...race, session_key: 99, session_name: "Practice 1" },
  weekendSessions: [race],
  drivers: [],
  laps: [],
  intervals: [],
  positions: [],
  stints: [],
  weekendStints: [],
  pits: [],
  weather: [],
  raceControl: [],
  track: [[0, 0] as [number, number]],
  corners: [],
  sectorFracs: [0.3, 0.6, 1] as [number, number, number],
  locations: [],
};

beforeEach(() => {
  loadMeetings.mockReset();
  loadSessions.mockReset();
  loadBundle.mockReset();
  state.year = 2025;
  state.meetingKey = 1272;
  state.sessionKey = 9877;
  state.meetings = [];
  state.sessions = [];
  state.bundle = loadedBundle as typeof state.bundle;
  state.loading = "";
  state.loadProgress = null;
  state.listsBusy = false;
  state.error = "";
  state.lock = null;
});

afterEach(() => {
  state.bundle = loadedBundle as typeof state.bundle;
  state.loading = "";
  state.loadProgress = null;
  state.listsBusy = false;
});

describe("deferred session load", () => {
  it("Year/Meeting only refresh lists and leave the last bundle in place", async () => {
    loadMeetings.mockResolvedValue([meeting]);
    loadSessions.mockResolvedValue([race]);
    await changeYear(2024);
    expect(state.year).toBe(2024);
    expect(state.meetingKey).toBe(10);
    expect(state.sessionKey).toBe(20);
    expect(state.meetings).toEqual([meeting]);
    expect(state.sessions).toEqual([race]);
    expect(state.bundle).toBe(loadedBundle);
    expect(loadBundle).not.toHaveBeenCalled();
    expect(state.loading).toBe("");
    expect(sessionPickerDirty()).toBe(true);
  });

  it("Session picker only stores the key until Load", async () => {
    changeSession(20);
    expect(state.sessionKey).toBe(20);
    expect(state.bundle?.session.session_key).toBe(99);
    expect(loadBundle).not.toHaveBeenCalled();
    expect(sessionPickerDirty()).toBe(true);

    loadBundle.mockImplementation(async (_key: number, opts: { onProgress?: (p: string, b: unknown) => void }) => {
      opts.onProgress?.("timing", loadedBundle);
      return { ...loadedBundle, session: race };
    });
    await loadSelectedSession();
    expect(loadBundle).toHaveBeenCalledTimes(1);
    expect(state.bundle?.session.session_key).toBe(20);
    expect(sessionPickerDirty()).toBe(false);
    expect(state.loading).toBe("");
  });

  it("applies the track outline as soon as Load publishes it, without opening Track map", async () => {
    const emptyTrack = { ...loadedBundle, track: [] as [number, number][] };
    const withTrack = {
      ...loadedBundle,
      track: [
        [0, 0],
        [100, 0],
        [100, 80],
        [0, 80],
      ] as [number, number][],
    };
    let trackDuringOutline: number | undefined;
    loadBundle.mockImplementation(async (_key: number, opts: { onProgress?: (p: string, b: unknown) => void }) => {
      opts.onProgress?.("timing", emptyTrack);
      opts.onProgress?.("outline", withTrack);
      trackDuringOutline = state.bundle?.track.length;
      opts.onProgress?.("map", { ...withTrack, locations: [] });
      return withTrack;
    });
    state.page = "laptiming";
    state.bundle = null;
    state.sessionKey = 20;
    await loadSelectedSession();
    expect(trackDuringOutline).toBeGreaterThan(2);
    expect(state.bundle!.track.length).toBeGreaterThan(2);
    expect(state.page).toBe("laptiming");
  });

  it("keeps Loading session… until the full bundle is ready, including the first Load", async () => {
    let loadingDuringTiming = "unset";
    let loadingDuringMap = "unset";
    let progressDuringLaps: typeof state.loadProgress = null;
    let bundleDuringTiming: unknown = "unset";
    loadBundle.mockImplementation(
      async (
        _key: number,
        opts: {
          onProgress?: (p: string, b: unknown) => void;
          onFetch?: (p: { done: number; total: number; label: string; pct: number }) => void;
        },
      ) => {
        expect(state.loading).toBe("Loading session…");
        expect(state.bundle).toBeNull();
        opts.onFetch?.({ done: 3, total: 10, label: "laps", pct: 30 });
        progressDuringLaps = state.loadProgress;
        opts.onProgress?.("timing", loadedBundle);
        loadingDuringTiming = state.loading;
        bundleDuringTiming = state.bundle;
        opts.onProgress?.("map", loadedBundle);
        loadingDuringMap = state.loading;
        return loadedBundle;
      },
    );
    state.bundle = null;
    state.sessionKey = 20;
    state.loading = "";
    await loadSelectedSession();
    expect(loadingDuringTiming).toBe("Loading session…");
    expect(loadingDuringMap).toBe("Loading session…");
    expect(bundleDuringTiming).toBe(loadedBundle);
    expect(progressDuringLaps).toMatchObject({ label: "laps", pct: 30, done: 3, total: 10 });
    expect(state.loading).toBe("");
    expect(state.loadProgress).toBeNull();
  });

  it("clears the overlay progress when a Load fails", async () => {
    loadBundle.mockRejectedValue(new OpenF1Error("http", "OpenF1 500", 500));
    state.bundle = null;
    state.sessionKey = 20;
    state.loadProgress = { done: 2, total: 8, label: "drivers", pct: 25 };
    await loadSelectedSession();
    expect(state.loading).toBe("");
    expect(state.loadProgress).toBeNull();
  });

  it("Meeting list fetch does not set the heavy loading veil", async () => {
    loadSessions.mockResolvedValue([race]);
    await changeMeeting(10);
    expect(state.loading).toBe("");
    expect(state.bundle).toBe(loadedBundle);
    expect(loadBundle).not.toHaveBeenCalled();
  });

  it("arms live follow when Load finishes an in-progress session", async () => {
    const now = Date.now();
    const latest = new Date(now - 2000).toISOString();
    const liveBundle = {
      ...loadedBundle,
      session: {
        ...loadedBundle.session,
        session_key: 20,
        date_start: new Date(now - 30 * 60 * 1000).toISOString(),
        date_end: new Date(now + 90 * 60 * 1000).toISOString(),
      },
      intervals: [{ date: latest, driver_number: 1, gap_to_leader: 0, interval: 0 }],
    };
    state.mode = "live";
    state.sessionKey = 20;
    state.bundle = null;
    state.followLive = false;
    state.playing = false;
    loadBundle.mockResolvedValue(liveBundle);
    await loadSelectedSession();
    expect(state.followLive).toBe(true);
    expect(state.playing).toBe(true);
    expect(state.t).toBe(state.end);
    expect(state.t).toBe(Date.parse(latest));
    state.mode = "historical";
    state.followLive = false;
    state.playing = false;
  });

  it("page open and picker changes fetch zero bundles until Load", async () => {
    state.bundle = null;
    state.sessionKey = 9877;
    loadMeetings.mockResolvedValue([meeting]);
    loadSessions.mockResolvedValue([race]);
    await reloadAll();
    expect(loadMeetings).toHaveBeenCalled();
    expect(loadSessions).toHaveBeenCalled();
    expect(loadBundle).not.toHaveBeenCalled();
    expect(state.bundle).toBeNull();

    await changeYear(2024);
    await changeMeeting(10);
    changeSession(20);
    expect(loadBundle).not.toHaveBeenCalled();

    loadBundle.mockResolvedValue({ ...loadedBundle, session: race });
    await loadSelectedSession();
    expect(loadBundle).toHaveBeenCalledTimes(1);
  });

  it("explicit retry still loads the selected bundle", async () => {
    state.bundle = null;
    state.sessionKey = 20;
    state.lock = null;
    loadMeetings.mockResolvedValue([meeting]);
    loadSessions.mockResolvedValue([race]);
    loadBundle.mockResolvedValue({ ...loadedBundle, session: race });
    await retryNow();
    expect(loadBundle).toHaveBeenCalled();
    expect(state.bundle).toMatchObject({ session: { session_key: 20 } });
  });
});
