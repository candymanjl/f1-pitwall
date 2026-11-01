import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_REFRESH_SKEW_MS, TOKEN_STORAGE_KEY, writeRelayUrl } from "../config";
import {
  configureAuth,
  getAccessToken,
  memoryStore,
  peekAuth,
  requestToken,
  resetAuthForTests,
  signIn,
  signOut,
  tryRefreshAfter401,
} from "./auth";
import { OpenF1Error } from "./errors";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  resetAuthForTests();
  writeRelayUrl("");
  try {
    Reflect.deleteProperty(globalThis, "localStorage");
  } catch {
    /* ignore */
  }
  vi.useRealTimers();
});

describe("requestToken", () => {
  it("POSTs the token request through the saved relay", async () => {
    const memory = new Map<string, string>([["f1pitwall.openf1Relay", "https://f1-pitwall-relay-11686.azurewebsites.net"]]);
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
        removeItem: (k: string) => void memory.delete(k),
      },
      configurable: true,
    });
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("https://f1-pitwall-relay-11686.azurewebsites.net/token");
      return jsonRes(200, { access_token: "tok-relay", expires_in: "3600" });
    });
    configureAuth({ fetch: fetchMock as unknown as typeof fetch, store: memoryStore() });
    const tok = await requestToken("ada", "pw");
    expect(tok.access_token).toBe("tok-relay");
  });

  it("POSTs form-urlencoded username and password", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_url)).toMatch(/\/token$/);
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toMatch(/x-www-form-urlencoded/i);
      expect(String(init?.body)).toBe("username=ada%40example.com&password=s3cret");
      return jsonRes(200, { access_token: "tok-1", expires_in: "3600", token_type: "bearer" });
    });
    configureAuth({ fetch: fetchMock as unknown as typeof fetch, store: memoryStore() });
    const tok = await requestToken("ada@example.com", "s3cret");
    expect(tok.access_token).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces a friendly CORS/network error instead of failing silently", async () => {
    configureAuth({
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      store: memoryStore(),
    });
    await expect(requestToken("ada", "pw")).rejects.toMatchObject({
      name: "OpenF1Error",
      message: expect.stringMatching(/CORS|network|blocked the sign-in/i),
    });
  });

  it("maps incorrect credentials to an HTTP error", async () => {
    configureAuth({
      fetch: (async () => jsonRes(401, { detail: "Incorrect username or password" })) as unknown as typeof fetch,
      store: memoryStore(),
    });
    await expect(signIn("ada", "nope")).rejects.toBeInstanceOf(OpenF1Error);
    await expect(signIn("ada", "nope")).rejects.toMatchObject({
      status: 401,
      message: expect.stringMatching(/Incorrect username/i),
    });
  });
});

describe("token cache / refresh", () => {
  it("returns the cached token until 5 minutes before expiry", async () => {
    const now = 1_700_000_000_000;
    const fetchMock = vi.fn(async () => jsonRes(200, { access_token: "fresh", expires_in: 3600 }));
    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      now: () => now,
      store: memoryStore(),
    });
    await signIn("ada", "pw");
    expect(await getAccessToken()).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledOnce();

    configureAuth({ now: () => now + 3600 * 1000 - TOKEN_REFRESH_SKEW_MS - 1000 });
    expect(await getAccessToken()).toBe("fresh");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes automatically inside the 5-minute skew window", async () => {
    const now = 1_700_000_000_000;
    let issued = 0;
    const fetchMock = vi.fn(async () => {
      issued += 1;
      return jsonRes(200, { access_token: `tok-${issued}`, expires_in: 3600 });
    });
    configureAuth({
      fetch: fetchMock as unknown as typeof fetch,
      now: () => now,
      store: memoryStore(),
    });
    await signIn("ada", "pw");
    configureAuth({ now: () => now + 3600 * 1000 - TOKEN_REFRESH_SKEW_MS + 50 });
    expect(await getAccessToken()).toBe("tok-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("parses expires_in when OpenF1 sends it as a string", async () => {
    const now = 1_700_000_000_000;
    const store = memoryStore();
    configureAuth({
      fetch: (async () => jsonRes(200, { access_token: "tok-str", expires_in: "3600", token_type: "bearer" })) as unknown as typeof fetch,
      now: () => now,
      store,
    });
    await signIn("ada", "pw");
    expect(store.get("f1pitwall.openf1AccessToken")).toBe("tok-str");
    expect(Number(store.get("f1pitwall.openf1ExpiresAt"))).toBe(now + 3600 * 1000);
  });

  it("uses the cached OAuth token even if the password is missing", async () => {
    const now = 1_700_000_000_000;
    const store = memoryStore({
      "f1pitwall.openf1User": "ada",
      "f1pitwall.openf1AccessToken": "cached-oauth",
      "f1pitwall.openf1ExpiresAt": String(now + 3600 * 1000),
    });
    configureAuth({
      fetch: (async () => {
        throw new Error("should not hit /token");
      }) as unknown as typeof fetch,
      now: () => now,
      store,
    });
    expect(peekAuth().signedIn).toBe(true);
    expect(await getAccessToken()).toBe("cached-oauth");
  });

  it("falls back to a manually pasted token when not signed in", async () => {
    const store = memoryStore({ [TOKEN_STORAGE_KEY]: "pasted-token" });
    configureAuth({
      fetch: (async () => {
        throw new Error("should not hit /token");
      }) as unknown as typeof fetch,
      store,
    });
    expect(peekAuth().source).toBe("manual");
    expect(await getAccessToken()).toBe("pasted-token");
  });

  it("signOut drops stored username, password, and access token", async () => {
    configureAuth({
      fetch: (async () => jsonRes(200, { access_token: "x", expires_in: 3600 })) as unknown as typeof fetch,
      store: memoryStore(),
    });
    await signIn("ada", "pw");
    signOut();
    expect(peekAuth().signedIn).toBe(false);
    expect(await getAccessToken()).toBe("");
  });
});

describe("401 retry", () => {
  it("tryRefreshAfter401 force-refreshes when a password login exists", async () => {
    let issued = 0;
    const fetchMock = vi.fn(async () => {
      issued += 1;
      return jsonRes(200, { access_token: `tok-${issued}`, expires_in: 3600 });
    });
    configureAuth({ fetch: fetchMock as unknown as typeof fetch, store: memoryStore() });
    await signIn("ada", "pw");
    expect(await tryRefreshAfter401()).toBe(true);
    expect(await getAccessToken()).toBe("tok-2");
  });

  it("does not refresh a pasted-only token", async () => {
    configureAuth({
      fetch: (async () => {
        throw new Error("no");
      }) as unknown as typeof fetch,
      store: memoryStore({ [TOKEN_STORAGE_KEY]: "pasted" }),
    });
    expect(await tryRefreshAfter401()).toBe(false);
  });
});
