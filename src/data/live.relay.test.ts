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
    writeRelayUrl("https://f1pw-openf1-relay.azurewebsites.net/api");
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

    expect(statuses[0]).toMatch(/^poll:Relay: REST poll every 4s/);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const firstUrl = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL]>)[0]?.[0];
    expect(String(firstUrl)).toMatch(/^https:\/\/f1pw-openf1-relay\.azurewebsites\.net\/api\/v1\//);
    handle.stop();
    expect(statuses.at(-1)).toMatch(/^off:/);
  });
});
