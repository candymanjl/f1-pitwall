/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeRelayUrl } from "../config";
import { startLiveFeed } from "./live";

afterEach(() => {
  writeRelayUrl("");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("startLiveFeed with a relay URL", () => {
  it("skips MQTT and starts 4s REST polling", async () => {
    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net");
    const fetchMock = vi.fn(async () => {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const statuses: string[] = [];
    const handle = startLiveFeed({
      username: "ada",
      sessionKey: 9877,
      onMessage: () => {},
      onStatus: (source, detail) => {
        statuses.push(`${source}:${detail ?? ""}`);
      },
    });

    expect(statuses[0]).toMatch(/^poll:Relay: staggered REST poll/);
    await vi.waitFor(() => {
      const urls = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL]>).map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/v1/location"))).toBe(true);
      expect(urls.some((u) => u.includes("/v1/position"))).toBe(true);
      expect(urls.some((u) => u.includes("/v1/intervals"))).toBe(true);
      expect(urls.every((u) => u.includes("date%3E"))).toBe(true);
    });
    await vi.waitFor(
      () => {
        const urls = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL]>).map((c) => String(c[0]));
        expect(urls.some((u) => u.includes("/v1/laps") && u.includes("date_start%3E"))).toBe(true);
      },
      { timeout: 2500 },
    );
    handle.stop();
    expect(statuses.at(-1)).toMatch(/^off:/);
  });
});
