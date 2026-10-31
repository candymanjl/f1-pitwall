import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAuth, memoryStore, resetAuthForTests, signIn } from "./auth";
import { authorizedFetch } from "./clientAuth";

afterEach(() => {
  resetAuthForTests();
  vi.unstubAllGlobals();
});

describe("authorizedFetch 401 retry", () => {
  it("refreshes the token and retries the request once", async () => {
    let tokenCalls = 0;
    const authFetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/token")) {
        tokenCalls += 1;
        return new Response(JSON.stringify({ access_token: `tok-${tokenCalls}`, expires_in: 3600 }), {
          status: 200,
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    configureAuth({ fetch: authFetch as unknown as typeof fetch, store: memoryStore() });
    await signIn("ada", "pw");

    let apiCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes("/token")) return authFetch(url);
        apiCalls += 1;
        if (apiCalls === 1) return new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
        return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
      }),
    );

    const res = await authorizedFetch("https://api.openf1.org/v1/meetings");
    expect(res.status).toBe(200);
    expect(apiCalls).toBe(2);
    expect(tokenCalls).toBe(2);
    expect(await res.json()).toEqual([{ ok: true }]);
  });

  it("sends Bearer on every request; mock OpenF1 401s without it and 200s with it", async () => {
    const store = memoryStore({
      "f1pitwall.openf1User": "ada",
      "f1pitwall.openf1Password": "pw",
      "f1pitwall.openf1AccessToken": "live-token",
      "f1pitwall.openf1ExpiresAt": String(Date.now() + 3_600_000),
    });
    configureAuth({
      fetch: (async () => {
        throw new Error("should not refresh");
      }) as unknown as typeof fetch,
      store,
    });

    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization");
        seen.push(auth ?? "");
        if (!auth) {
          return new Response(JSON.stringify({ detail: "Live F1 session in progress. Restricted to authenticated users." }), {
            status: 401,
          });
        }
        expect(auth).toBe("Bearer live-token");
        return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
      }),
    );

    const locked = await authorizedFetch("https://api.openf1.org/v1/meetings", { headers: { accept: "application/json" } });
    expect(locked.status).toBe(200);
    expect(seen).toEqual(["Bearer live-token"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get("Authorization");
        if (!auth) {
          return new Response(JSON.stringify({ detail: "Live F1 session in progress." }), { status: 401 });
        }
        return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
      }),
    );
    resetAuthForTests(memoryStore());
    const bare = await authorizedFetch("https://api.openf1.org/v1/meetings");
    expect(bare.status).toBe(401);
  });
});
