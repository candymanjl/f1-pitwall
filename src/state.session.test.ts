/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadMeetings = vi.fn();
const loadSessions = vi.fn();
const loadBundle = vi.fn();

vi.mock("./data/loadSession", () => ({
  loadMeetings: (...args: unknown[]) => loadMeetings(...args),
  loadSessions: (...args: unknown[]) => loadSessions(...args),
  loadBundle: (...args: unknown[]) => loadBundle(...args),
}));

import {
  changeMeeting,
  changeSession,
  changeYear,
  loadSelectedSession,
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
  state.listsBusy = false;
  state.error = "";
  state.lock = null;
});

afterEach(() => {
  state.bundle = loadedBundle as typeof state.bundle;
  state.loading = "";
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
  });

  it("Meeting list fetch does not set the heavy loading veil", async () => {
    loadSessions.mockResolvedValue([race]);
    await changeMeeting(10);
    expect(state.loading).toBe("");
    expect(state.bundle).toBe(loadedBundle);
    expect(loadBundle).not.toHaveBeenCalled();
  });
});
