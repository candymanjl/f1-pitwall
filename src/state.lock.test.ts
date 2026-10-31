/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { AUTH_ACCESS_KEY, AUTH_EXPIRY_KEY, AUTH_USER_KEY } from "./config";
import { hasUsableAuth, memoryStore, resetAuthForTests } from "./data/auth";
import { shouldShowLiveLockBanner } from "./data/errors";
import { applyFetchError, clearLiveLock, state } from "./state";

afterEach(() => {
  resetAuthForTests();
  state.lock = null;
  state.error = "";
  state.retryAt = 0;
});

describe("live-lock vs signed-in token", () => {
  it("does not keep the banner up when Settings already has a token", () => {
    resetAuthForTests(
      memoryStore({
        [AUTH_USER_KEY]: "ada",
        [AUTH_ACCESS_KEY]: "live-token",
        [AUTH_EXPIRY_KEY]: String(Date.now() + 3_600_000),
      }),
    );
    expect(hasUsableAuth()).toBe(true);
    state.lock = "live";
    applyFetchError(new TypeError("Failed to fetch"));
    expect(state.lock).toBeNull();
    expect(shouldShowLiveLockBanner(state.lock, hasUsableAuth())).toBe(false);
  });

  it("still shows the banner for a bare 401 when nobody is signed in", () => {
    resetAuthForTests(memoryStore());
    expect(hasUsableAuth()).toBe(false);
    applyFetchError(new TypeError("Failed to fetch"));
    expect(state.lock).toBe("live");
    expect(shouldShowLiveLockBanner(state.lock, hasUsableAuth())).toBe(true);
    clearLiveLock();
    expect(state.lock).toBeNull();
    expect(shouldShowLiveLockBanner(state.lock, false)).toBe(false);
  });
});
