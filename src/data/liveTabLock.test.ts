/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { startLiveTabLock, type TabLockChannel } from "./liveTabLock";

function memoryChannel(): { a: TabLockChannel; b: TabLockChannel } {
  const listenersA = new Set<(ev: { data: unknown }) => void>();
  const listenersB = new Set<(ev: { data: unknown }) => void>();
  const a: TabLockChannel = {
    postMessage: (msg) => {
      for (const fn of listenersB) fn({ data: msg });
    },
    addEventListener: (_type, fn) => listenersA.add(fn),
    removeEventListener: (_type, fn) => listenersA.delete(fn),
  };
  const b: TabLockChannel = {
    postMessage: (msg) => {
      for (const fn of listenersA) fn({ data: msg });
    },
    addEventListener: (_type, fn) => listenersB.add(fn),
    removeEventListener: (_type, fn) => listenersB.delete(fn),
  };
  return { a, b };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("live tab lock", () => {
  it("elects the first tab leader and warns the second", async () => {
    vi.useFakeTimers();
    const { a, b } = memoryChannel();
    const roles: string[] = [];
    const first = startLiveTabLock({
      channel: a,
      tabId: "tab-a",
      now: () => Date.now(),
      onRole: (role) => roles.push(`a:${role}`),
    });
    await vi.advanceTimersByTimeAsync(80);
    expect(first.role()).toBe("leader");
    expect(roles).toContain("a:leader");

    const second = startLiveTabLock({
      channel: b,
      tabId: "tab-b",
      now: () => Date.now(),
      onRole: (role) => roles.push(`b:${role}`),
    });
    await vi.advanceTimersByTimeAsync(80);
    expect(second.role()).toBe("follower");
    expect(roles).toContain("b:follower");
    first.stop();
    second.stop();
  });

  it("promotes a follower when the leader goes stale", async () => {
    vi.useFakeTimers();
    const { a, b } = memoryChannel();
    const first = startLiveTabLock({
      channel: a,
      tabId: "tab-a",
      now: () => Date.now(),
      onRole: () => {},
    });
    await vi.advanceTimersByTimeAsync(80);
    const roles: string[] = [];
    const second = startLiveTabLock({
      channel: b,
      tabId: "tab-b",
      now: () => Date.now(),
      onRole: (role) => roles.push(role),
    });
    await vi.advanceTimersByTimeAsync(80);
    expect(second.role()).toBe("follower");
    first.stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(second.role()).toBe("leader");
    expect(roles).toContain("leader");
    second.stop();
  });
});
