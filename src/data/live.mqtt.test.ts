/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("./client", () => ({ apiGet, parseRetryAfterMs: () => 4000 }));

import { AUTH_ACCESS_KEY, AUTH_EXPIRY_KEY, AUTH_USER_KEY, TOKEN_REFRESH_SKEW_MS, writeRelayUrl } from "../config";
import { applyLiveMessage } from "./liveMerge";
import { startLiveFeed, type MqttLike } from "./live";
import { MQTT_SILENCE_MS } from "./livePoll";
import type { SessionBundle } from "./types";

function mockBroker() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const client: MqttLike & { emit: (event: string, ...args: unknown[]) => void } = {
    on: (event, cb) => {
      (handlers[event] ??= []).push(cb);
    },
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    end: vi.fn(),
    emit: (event, ...args) => {
      for (const cb of handlers[event] ?? []) cb(...args);
    },
  };
  return client;
}

function bundle(partial: Partial<SessionBundle> = {}): SessionBundle {
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: "Test",
      circuit_short_name: "TST",
      country_name: "X",
      location: "X",
      date_start: "",
      year: 2026,
    },
    session: {
      session_key: 99,
      meeting_key: 1,
      session_name: "Race",
      session_type: "Race",
      date_start: "",
      date_end: "",
      circuit_short_name: "TST",
      country_name: "X",
      location: "X",
      year: 2026,
    },
    weekendSessions: [],
    drivers: [],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track: [],
    corners: [],
    sectorFracs: [0.3, 0.3, 0.4],
    ...partial,
  };
}

afterEach(() => {
  writeRelayUrl("");
  apiGet.mockReset();
  vi.useRealTimers();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("OpenF1 MQTT even when a relay is set", () => {
  it("connects the browser to the OpenF1 broker with the relay token", async () => {
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    vi.useFakeTimers();
    const client = mockBroker();
    const connectMqtt = vi.fn(() => client);
    const statuses: string[] = [];
    const handle = startLiveFeed({
      username: "ada@example.com",
      sessionKey: 99,
      tabChannel: null,
      getToken: async () => "relay-access-token",
      connectMqtt,
      onMessage: () => {},
      onStatus: (source, detail) => statuses.push(`${source}:${detail ?? ""}`),
    });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(connectMqtt).toHaveBeenCalledWith(
      "wss://mqtt.openf1.org:8084/mqtt",
      expect.objectContaining({ username: "ada@example.com", password: "relay-access-token" }),
    );
    expect(statuses.some((s) => s.startsWith("poll:"))).toBe(false);
    client.emit("connect");
    expect(statuses.some((s) => s.startsWith("mqtt"))).toBe(true);
    expect(client.subscribe).toHaveBeenCalled();
    const topics = (client.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(topics).toEqual(expect.arrayContaining(["v1/location", "v1/laps", "v1/weather"]));
    expect(topics).not.toContain("v1/car_data");
    handle.stop();
  });

  it("uses pitwall when the username is empty", async () => {
    vi.useFakeTimers();
    const client = mockBroker();
    const connectMqtt = vi.fn(() => client);
    const handle = startLiveFeed({
      username: "  ",
      sessionKey: 1,
      tabChannel: null,
      getToken: async () => "tok",
      connectMqtt,
      onMessage: () => {},
      onStatus: () => {},
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(connectMqtt).toHaveBeenCalledWith(
      "wss://mqtt.openf1.org:8084/mqtt",
      expect.objectContaining({ username: "pitwall" }),
    );
    handle.stop();
  });

  it("upserts the same _key when MQTT delivers a newer _id (lap sectors)", async () => {
    vi.useFakeTimers();
    const client = mockBroker();
    const messages: Array<{ topic: string; payload: unknown }> = [];
    const handle = startLiveFeed({
      username: "ada",
      sessionKey: 99,
      tabChannel: null,
      getToken: async () => "tok",
      connectMqtt: () => client,
      onMessage: (topic, payload) => messages.push({ topic, payload }),
      onStatus: () => {},
    });
    await vi.advanceTimersByTimeAsync(0);
    client.emit("connect");
    client.emit(
      "message",
      "v1/laps",
      JSON.stringify({
        _key: "lap-44-12",
        _id: 10,
        driver_number: 44,
        lap_number: 12,
        duration_sector_1: 28.1,
        session_key: 99,
      }),
    );
    client.emit(
      "message",
      "v1/laps",
      JSON.stringify({
        _key: "lap-44-12",
        _id: 11,
        driver_number: 44,
        lap_number: 12,
        duration_sector_2: 31.4,
        session_key: 99,
      }),
    );
    const start = bundle({ laps: [] });
    let next = start;
    for (const msg of messages) next = applyLiveMessage(next, msg.topic, msg.payload, 99);
    expect(next.laps).toHaveLength(1);
    expect((next.laps[0] as { duration_sector_2?: number }).duration_sector_2).toBe(31.4);
    expect((next.laps[0] as { _id?: number })._id).toBe(11);
    handle.stop();
  });

  it("falls back to REST after 15s of MQTT silence and returns to STREAM on the next message", async () => {
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    vi.useFakeTimers();
    apiGet.mockResolvedValue([]);
    const client = mockBroker();
    const statuses: string[] = [];
    const debugModes: string[] = [];
    const handle = startLiveFeed({
      username: "ada",
      sessionKey: 99,
      tabChannel: null,
      getToken: async () => "tok",
      connectMqtt: () => client,
      onMessage: () => {},
      onStatus: (source, detail) => statuses.push(`${source}:${detail ?? ""}`),
      onDebug: (debug) => debugModes.push(debug.mode),
    });
    await vi.advanceTimersByTimeAsync(0);
    client.emit("connect");
    expect(debugModes.at(-1)).toBe("STREAM");
    const callsAfterConnect = apiGet.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MQTT_SILENCE_MS);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(statuses.some((s) => /silent 15s/i.test(s))).toBe(true);
    expect(debugModes).toContain("POLLING");
    expect(apiGet.mock.calls.length).toBeGreaterThan(callsAfterConnect);
    client.emit("message", "v1/position", JSON.stringify({ driver_number: 1, position: 1, session_key: 99 }));
    expect(debugModes.at(-1)).toBe("STREAM");
    expect(statuses.filter((s) => s.startsWith("mqtt")).length).toBeGreaterThan(1);
    handle.stop();
  });

  it("refreshes the token before expiry and reconnects MQTT", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    localStorage.setItem(AUTH_USER_KEY, "ada@example.com");
    localStorage.setItem(AUTH_ACCESS_KEY, "tok");
    localStorage.setItem(AUTH_EXPIRY_KEY, String(1_700_000_000_000 + TOKEN_REFRESH_SKEW_MS + 20_000));
    const first = mockBroker();
    const second = mockBroker();
    const connectMqtt = vi.fn(() => (connectMqtt.mock.calls.length <= 1 ? first : second));
    const handle = startLiveFeed({
      username: "ada@example.com",
      sessionKey: 1,
      tabChannel: null,
      getToken: async () => "tok",
      connectMqtt,
      onMessage: () => {},
      onStatus: () => {},
    });
    await vi.advanceTimersByTimeAsync(0);
    first.emit("connect");
    expect(connectMqtt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(connectMqtt).toHaveBeenCalledTimes(2);
    expect(first.end).toHaveBeenCalled();
    handle.stop();
  });

  it("starts location without waiting for it to finish so it cannot block position", async () => {
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    let releaseLoc = (): void => {};
    apiGet.mockImplementation(async (path: string) => {
      if (path === "location") {
        await new Promise<void>((resolve) => {
          releaseLoc = resolve;
        });
        return [{ date: "2025-10-26T20:10:01.000Z", x: 1 }];
      }
      if (path === "position") return [{ date: "2025-10-26T20:10:01.000Z", position: 1 }];
      return [];
    });
    const seen: string[] = [];
    const handle = startLiveFeed({
      username: "ada",
      sessionKey: 99,
      tabChannel: null,
      getToken: async () => "",
      onMessage: (topic) => seen.push(topic),
      onStatus: () => {},
    });
    await vi.waitFor(() => {
      expect(seen).toContain("v1/position");
    });
    expect(seen).not.toContain("v1/location");
    releaseLoc();
    await vi.waitFor(() => {
      expect(seen).toContain("v1/location");
    });
    handle.stop();
  });
});
