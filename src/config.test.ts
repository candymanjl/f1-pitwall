import { afterEach, describe, expect, it } from "vitest";
import {
  API_BASE,
  DEFAULT_RELAY_URL,
  RELAY_STORAGE_KEY,
  TOKEN_URL,
  ensureDefaultRelay,
  normalizeRelayUrl,
  parseLiveDelay,
  readLiveDelay,
  readRelayUrl,
  restBase,
  tokenUrl,
  writeLiveDelay,
  writeRelayUrl,
} from "./config";

function mockStorage(seed: Record<string, string> = {}): Map<string, string> {
  const memory = new Map(Object.entries(seed));
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return memory;
}

afterEach(() => {
  writeRelayUrl("");
  try {
    Reflect.deleteProperty(globalThis, "localStorage");
  } catch {
    /* ignore */
  }
});

describe("live delay", () => {
  it("defaults to 3 s and remembers Off or 5 s", () => {
    mockStorage();
    expect(readLiveDelay()).toBe(3000);
    expect(parseLiveDelay(null)).toBe(3000);
    expect(parseLiveDelay("nope")).toBe(3000);
    writeLiveDelay(0);
    expect(readLiveDelay()).toBe(0);
    writeLiveDelay(5000);
    expect(readLiveDelay()).toBe(5000);
    expect(localStorage.getItem("f1pitwall.liveDelay")).toBe("5000");
  });
});

describe("OpenF1 relay URL", () => {
  it("strips trailing slashes and rejects non-http values", () => {
    expect(normalizeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net/")).toBe(
      "https://f1-pitwall-relay-11686.azurewebsites.net",
    );
    expect(normalizeRelayUrl("http://127.0.0.1:8799/")).toBe("http://127.0.0.1:8799");
    expect(normalizeRelayUrl("javascript:alert(1)")).toBe("");
    expect(normalizeRelayUrl("not a url")).toBe("");
    expect(normalizeRelayUrl("   ")).toBe("");
  });

  it("defaults to OpenF1 and only routes through a saved relay", () => {
    mockStorage();
    expect(readRelayUrl()).toBe("");
    expect(restBase()).toBe(API_BASE);
    expect(tokenUrl()).toBe(TOKEN_URL);

    writeRelayUrl("https://f1-pitwall-relay-11686.azurewebsites.net/");
    expect(readRelayUrl()).toBe("https://f1-pitwall-relay-11686.azurewebsites.net");
    expect(restBase()).toBe("https://f1-pitwall-relay-11686.azurewebsites.net/v1");
    expect(tokenUrl()).toBe("https://f1-pitwall-relay-11686.azurewebsites.net/token");

    writeRelayUrl("");
    expect(localStorage.getItem(RELAY_STORAGE_KEY)).toBeNull();
    expect(restBase()).toBe(API_BASE);
    expect(tokenUrl()).toBe(TOKEN_URL);
  });

  it("seeds the Azure relay on GitHub Pages when none is saved", () => {
    mockStorage();
    const prev = globalThis.location;
    Object.defineProperty(globalThis, "location", {
      value: { hostname: "candymanjl.github.io" },
      configurable: true,
    });
    ensureDefaultRelay();
    expect(readRelayUrl()).toBe(DEFAULT_RELAY_URL);
    expect(restBase()).toBe(`${DEFAULT_RELAY_URL}/v1`);
    Object.defineProperty(globalThis, "location", { value: prev, configurable: true });
  });
});
