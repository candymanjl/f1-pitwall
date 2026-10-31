import { describe, expect, it } from "vitest";
import {
  classifyOpenF1Failure,
  extractDetail,
  isLiveLock,
  isNetworkFailure,
  OpenF1Error,
  shouldShowLiveLockBanner,
} from "./errors";

const LIVE_JSON = {
  detail:
    "Live F1 session in progress. Global API access (including past sessions) is restricted to authenticated users until the session ends...",
};

describe("classifyOpenF1Failure", () => {
  it("treats HTTP 401 with the live-session detail as a live lock", () => {
    const err = classifyOpenF1Failure({ status: 401, body: LIVE_JSON, path: "meetings" });
    expect(err.kind).toBe("live-lock");
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/locked while a live F1 session/i);
    expect(isLiveLock(err)).toBe(true);
  });

  it("treats Failed to fetch / CORS TypeError as a live lock", () => {
    const err = classifyOpenF1Failure({ cause: new TypeError("Failed to fetch") });
    expect(err.kind).toBe("live-lock");
    expect(isLiveLock(err)).toBe(true);
    expect(err.detail).toMatch(/CORS|401/i);
  });

  it("does not treat other HTTP errors as a live lock", () => {
    const err = classifyOpenF1Failure({ status: 500, body: { detail: "boom" }, path: "laps" });
    expect(err.kind).toBe("http");
    expect(err.message).toMatch(/500/);
    expect(isLiveLock(err)).toBe(false);
  });

  it("classifies a bare 401 without a body as a live lock", () => {
    const err = classifyOpenF1Failure({ status: 401 });
    expect(err.kind).toBe("live-lock");
  });

  it("treats the live-session detail as a lock even without a 401 status", () => {
    const err = classifyOpenF1Failure({ status: 403, body: LIVE_JSON });
    expect(err.kind).toBe("live-lock");
  });

  it("does not treat a credential 401 as a live lock", () => {
    const err = classifyOpenF1Failure({ status: 401, body: { detail: "Incorrect username or password" } });
    expect(err.kind).toBe("http");
    expect(err.message).toMatch(/Incorrect username/i);
  });

  it("does not lock the UI when the user already has a token", () => {
    const live = classifyOpenF1Failure({ status: 401, body: LIVE_JSON, authenticated: true });
    expect(live.kind).toBe("http");
    expect(isLiveLock(live)).toBe(false);
    const cors = classifyOpenF1Failure({ cause: new TypeError("Failed to fetch"), authenticated: true });
    expect(cors.kind).toBe("http");
    expect(isLiveLock(cors)).toBe(false);
    const prior = classifyOpenF1Failure({
      cause: new OpenF1Error("live-lock", "OpenF1 is locked while a live F1 session is running.", 401),
      authenticated: true,
    });
    expect(prior.kind).toBe("http");
  });
});

describe("helpers", () => {
  it("reads OpenF1 detail JSON", () => {
    expect(extractDetail(LIVE_JSON)).toMatch(/Live F1 session/);
    expect(extractDetail(null)).toBe("");
  });

  it("detects browser network failures", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkFailure(new Error("OpenF1 500 on laps"))).toBe(false);
  });

  it("isLiveLock recognises unclassified Failed to fetch", () => {
    expect(isLiveLock(new TypeError("Failed to fetch"))).toBe(true);
    expect(isLiveLock(new OpenF1Error("http", "nope", 503))).toBe(false);
  });

  it("hides the live-lock banner once a token exists", () => {
    expect(shouldShowLiveLockBanner("live", false)).toBe(true);
    expect(shouldShowLiveLockBanner("live", true)).toBe(false);
    expect(shouldShowLiveLockBanner(null, false)).toBe(false);
  });
});
