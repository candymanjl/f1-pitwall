/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock("./client", () => ({ apiGet }));

import { writeRelayUrl } from "../config";
import { startLiveFeed } from "./live";

afterEach(() => {
  writeRelayUrl("");
  apiGet.mockReset();
  vi.useRealTimers();
});

describe("relay incremental live poll", () => {
  it("appends only rows after the cursor as a moving now cutoff advances", async () => {
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    vi.useFakeTimers();
    let now = Date.parse("2025-10-26T20:10:02.000Z");
    const feed = [
      { date: "2025-10-26T20:10:01.000Z", driver_number: 1, position: 1 },
      { date: "2025-10-26T20:10:05.000Z", driver_number: 1, position: 1 },
      { date: "2025-10-26T20:10:09.000Z", driver_number: 1, position: 1 },
    ];
    let pickerKey = 5555;
    apiGet.mockImplementation(async (path: string, params: Record<string, string | number>) => {
      expect(params.session_key).toBe(9877);
      if (path !== "position") return [];
      const since = String(params["date>"] ?? "");
      return feed.filter((row) => row.date > since && Date.parse(row.date) <= now);
    });

    const seen: Array<{ date: string }> = [];
    const handle = startLiveFeed({
      username: "ada",
      sessionKey: () => 9877,
      cursors: { position: "2025-10-26T20:10:00.000Z" },
      onMessage: (_topic, payload) => {
        if (Array.isArray(payload)) seen.push(...(payload as Array<{ date: string }>));
      },
      onStatus: () => {},
    });
    pickerKey += 1;
    void pickerKey;

    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(apiGet).toHaveBeenCalled();
    expect(seen.map((r) => r.date)).toEqual(["2025-10-26T20:10:01.000Z"]);

    now = Date.parse("2025-10-26T20:10:06.000Z");
    await vi.advanceTimersByTimeAsync(4000);
    expect(seen.map((r) => r.date)).toEqual(["2025-10-26T20:10:01.000Z", "2025-10-26T20:10:05.000Z"]);
    handle.stop();
  });

  it("backs off on HTTP errors and keeps the loop running", async () => {
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    vi.useFakeTimers();
    let calls = 0;
    apiGet.mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error("502");
      return [];
    });
    const statuses: string[] = [];
    const handle = startLiveFeed({
      username: "ada",
      sessionKey: 1,
      onMessage: () => {},
      onStatus: (source, detail) => statuses.push(`${source}:${detail ?? ""}`),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.some((s) => /retry/i.test(s))).toBe(true);
    await vi.advanceTimersByTimeAsync(8000);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(calls).toBeGreaterThanOrEqual(3);
    handle.stop();
    expect(statuses.at(-1)).toMatch(/^off:/);
  });
});
