import { afterEach, describe, expect, it } from "vitest";
import {
  API_BASE,
  RELAY_STORAGE_KEY,
  TOKEN_URL,
  normalizeRelayUrl,
  readRelayUrl,
  restBase,
  tokenUrl,
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

describe("OpenF1 relay URL", () => {
  it("strips trailing slashes and rejects non-http values", () => {
    expect(normalizeRelayUrl("https://foo.azurewebsites.net/api/")).toBe("https://foo.azurewebsites.net/api");
    expect(normalizeRelayUrl("http://127.0.0.1:8799/")).toBe("http://127.0.0.1:8799");
    expect(normalizeRelayUrl("javascript:alert(1)")).toBe("");
    expect(normalizeRelayUrl("not a url")).toBe("");
    expect(normalizeRelayUrl("   ")).toBe("");
  });

  it("routes REST and token through the saved relay", () => {
    mockStorage();
    expect(readRelayUrl()).toBe("");
    expect(restBase()).toBe(API_BASE);
    expect(tokenUrl()).toBe(TOKEN_URL);

    writeRelayUrl("https://f1pw-openf1-relay.azurewebsites.net/api/");
    expect(readRelayUrl()).toBe("https://f1pw-openf1-relay.azurewebsites.net/api");
    expect(restBase()).toBe("https://f1pw-openf1-relay.azurewebsites.net/api/v1");
    expect(tokenUrl()).toBe("https://f1pw-openf1-relay.azurewebsites.net/api/token");

    writeRelayUrl("");
    expect(localStorage.getItem(RELAY_STORAGE_KEY)).toBeNull();
    expect(restBase()).toBe(API_BASE);
    expect(tokenUrl()).toBe(TOKEN_URL);
  });
});
