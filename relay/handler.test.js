import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { ALLOWED_ORIGIN, handleRelay, upstreamUrl } = require("./handler.js");

function req(partial) {
  return {
    method: "GET",
    path: "/v1/sessions",
    search: "?session_key=latest",
    header: () => "",
    body: async () => "",
    fetch: async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    ...partial,
  };
}

describe("openf1 relay handler", () => {
  it("answers OPTIONS with CORS only for the GitHub Pages origin", async () => {
    const ok = await handleRelay(req({ method: "OPTIONS", header: (n) => (n === "origin" ? ALLOWED_ORIGIN : "") }));
    expect(ok.status).toBe(204);
    expect(ok.headers["Access-Control-Allow-Origin"]).toBe(ALLOWED_ORIGIN);
    expect(ok.headers["Access-Control-Allow-Headers"]).toMatch(/Authorization/i);

    const no = await handleRelay(req({ method: "OPTIONS", header: (n) => (n === "origin" ? "https://evil.example" : "") }));
    expect(no.status).toBe(204);
    expect(no.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("forwards the bearer header to OpenF1 /v1 and /token", async () => {
    const seen = [];
    const fetch = vi.fn(async (url, init) => {
      seen.push({ url: String(url), auth: init.headers.authorization, body: init.body || "" });
      return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
    });
    const get = await handleRelay(
      req({
        header: (n) => (n === "authorization" ? "Bearer fake-token-for-cors-test" : n === "origin" ? ALLOWED_ORIGIN : ""),
        fetch,
      }),
    );
    expect(get.status).toBe(401);
    expect(get.headers["Access-Control-Allow-Origin"]).toBe(ALLOWED_ORIGIN);
    expect(seen[0].url).toBe("https://api.openf1.org/v1/sessions?session_key=latest");
    expect(seen[0].auth).toBe("Bearer fake-token-for-cors-test");

    const post = await handleRelay(
      req({
        method: "POST",
        path: "token",
        search: "",
        header: (n) => (n === "origin" ? ALLOWED_ORIGIN : n === "content-type" ? "application/x-www-form-urlencoded" : ""),
        body: async () => "username=fake&password=fake",
        fetch,
      }),
    );
    expect(post.status).toBe(401);
    expect(seen[1].url).toBe("https://api.openf1.org/token");
    expect(seen[1].body).toBe("username=fake&password=fake");
  });

  it("maps /v1 and /token at the site root (no /api prefix)", async () => {
    expect(upstreamUrl("/v1/sessions", "?session_key=latest")).toBe(
      "https://api.openf1.org/v1/sessions?session_key=latest",
    );
    expect(upstreamUrl("/token", "")).toBe("https://api.openf1.org/token");
    expect(upstreamUrl("/api/v1/laps", "")).toBe("https://api.openf1.org/v1/laps");
  });

  it("does not open-proxy other paths", async () => {
    expect(upstreamUrl("admin", "")).toBeNull();
    const res = await handleRelay(req({ path: "/secret" }));
    expect(res.status).toBe(404);
  });
});
