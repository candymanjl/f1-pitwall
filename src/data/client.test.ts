import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_ACCESS_KEY, AUTH_EXPIRY_KEY, AUTH_USER_KEY } from "../config";
import { configureAuth, memoryStore, resetAuthForTests } from "./auth";
import { apiGet, isRetryableAuthFailure, resetClientForTests, shouldRetryWithoutAuth } from "./client";
import { OpenF1Error } from "./errors";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const LIVE_LOCK = {
  detail: "Live F1 session in progress. Global API access (including past sessions) is restricted to authenticated users until the session ends.",
};

function signedInStore(): ReturnType<typeof memoryStore> {
  return memoryStore({
    [AUTH_USER_KEY]: "ada",
    [AUTH_ACCESS_KEY]: "live-token",
    [AUTH_EXPIRY_KEY]: String(Date.now() + 3_600_000),
  });
}

afterEach(() => {
  resetClientForTests();
  resetAuthForTests();
  vi.unstubAllGlobals();
});

describe("shouldRetryWithoutAuth", () => {
  it("retries every historical URL and refuses live latest feeds", () => {
    expect(shouldRetryWithoutAuth("https://api.openf1.org/v1/sessions?session_key=9877")).toBe(true);
    expect(shouldRetryWithoutAuth("https://api.openf1.org/v1/meetings?year=2025")).toBe(true);
    expect(shouldRetryWithoutAuth("https://api.openf1.org/v1/location?session_key=9877&meeting_key=1272")).toBe(true);
    expect(shouldRetryWithoutAuth("https://api.openf1.org/v1/sessions?session_key=latest")).toBe(false);
    expect(shouldRetryWithoutAuth("https://api.openf1.org/v1/meetings?meeting_key=latest")).toBe(false);
  });
});

describe("apiGet bearer + historical 401 fallback", () => {
  it("attaches Authorization: Bearer on the first REST request", async () => {
    configureAuth({ store: signedInStore() });
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("Authorization"));
        return jsonRes(200, [{ session_key: 9877 }]);
      }),
    );

    await apiGet("sessions", { session_key: 9877 });
    expect(seen).toEqual(["Bearer live-token"]);
  });

  it("retries a historical 401 without auth and returns the public body", async () => {
    configureAuth({ store: signedInStore() });
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization");
        seen.push(auth);
        if (auth) return jsonRes(401, LIVE_LOCK);
        return jsonRes(200, [{ session_key: 9877, session_name: "Race" }]);
      }),
    );

    const rows = await apiGet<Array<{ session_key: number }>>("sessions", { session_key: 9877 });
    expect(seen).toEqual(["Bearer live-token", null]);
    expect(rows).toEqual([{ session_key: 9877, session_name: "Race" }]);
  });

  it("retries Failed to fetch / CORS on a historical URL without the bearer", async () => {
    configureAuth({ store: signedInStore() });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        const auth = new Headers(init?.headers).get("Authorization");
        if (auth) throw new TypeError("Failed to fetch");
        return jsonRes(200, [{ meeting_key: 1272 }]);
      }),
    );

    const rows = await apiGet<Array<{ meeting_key: number }>>("meetings", { year: 2025 });
    expect(calls).toBe(2);
    expect(rows).toEqual([{ meeting_key: 1272 }]);
  });

  it("does not drop the bearer on session_key=latest after a 401", async () => {
    configureAuth({ store: signedInStore() });
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("Authorization"));
        return jsonRes(401, LIVE_LOCK);
      }),
    );

    await expect(apiGet("sessions", { session_key: "latest" })).rejects.toBeInstanceOf(OpenF1Error);
    expect(seen).toEqual(["Bearer live-token"]);
  });

  it("surfaces live-lock after both the authed and anonymous historical attempts fail", async () => {
    configureAuth({ store: signedInStore() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonRes(401, LIVE_LOCK)),
    );

    await expect(apiGet("location", { session_key: 9877 })).rejects.toMatchObject({
      kind: "live-lock",
    });
  });
});

describe("isRetryableAuthFailure", () => {
  it("retries 401, 403, live-lock, and CORS TypeError only", () => {
    expect(isRetryableAuthFailure(new OpenF1Error("http", "nope", 401))).toBe(true);
    expect(isRetryableAuthFailure(new OpenF1Error("http", "nope", 403))).toBe(true);
    expect(isRetryableAuthFailure(new OpenF1Error("live-lock", "locked", 401))).toBe(true);
    expect(isRetryableAuthFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableAuthFailure(new OpenF1Error("http", "boom", 500))).toBe(false);
    expect(isRetryableAuthFailure(new Error("nope"))).toBe(false);
  });
});
