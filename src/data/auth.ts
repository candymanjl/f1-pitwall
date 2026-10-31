import {
  AUTH_ACCESS_KEY,
  AUTH_EXPIRY_KEY,
  AUTH_PASS_KEY,
  AUTH_USER_KEY,
  TOKEN_REFRESH_SKEW_MS,
  TOKEN_STORAGE_KEY,
  TOKEN_URL,
  readToken,
} from "../config";
import { extractDetail, isNetworkFailure, OpenF1Error } from "./errors";

export type TokenResponse = {
  access_token: string;
  expires_in: string | number;
  token_type?: string;
};

export type AuthSnapshot = {
  username: string;
  signedIn: boolean;
  expiresAt: number;
  source: "oauth" | "manual" | "none";
  lastError: string;
};

export type AuthStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

export type AuthDeps = {
  fetch: typeof fetch;
  now: () => number;
  store: AuthStore;
};

export function memoryStore(seed: Record<string, string> = {}): AuthStore {
  const m = new Map(Object.entries(seed));
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      m.set(k, v);
    },
    remove: (k) => {
      m.delete(k);
    },
  };
}

function browserStore(): AuthStore {
  return {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* quota / private mode */
      }
    },
    remove: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
}

function defaultStore(): AuthStore {
  try {
    if (typeof localStorage !== "undefined") return browserStore();
  } catch {
    /* ignore */
  }
  return memoryStore();
}

let deps: AuthDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  store: defaultStore(),
};

export function configureAuth(partial: Partial<AuthDeps>): void {
  deps = { ...deps, ...partial };
}

export function resetAuthForTests(store: AuthStore = memoryStore()): AuthStore {
  deps = {
    fetch: (...args) => globalThis.fetch(...args),
    now: () => Date.now(),
    store,
  };
  return store;
}

function readManualToken(): string {
  return (deps.store.get(TOKEN_STORAGE_KEY) || readToken() || "").trim();
}

export function writeManualToken(token: string): void {
  if (token.trim()) deps.store.set(TOKEN_STORAGE_KEY, token.trim());
  else deps.store.remove(TOKEN_STORAGE_KEY);
}

export function hasPasswordLogin(): boolean {
  return Boolean(deps.store.get(AUTH_USER_KEY)?.trim() && deps.store.get(AUTH_PASS_KEY));
}

export function peekAuth(): AuthSnapshot {
  const username = deps.store.get(AUTH_USER_KEY)?.trim() || "";
  const expiresAt = Number(deps.store.get(AUTH_EXPIRY_KEY) || 0);
  const access = deps.store.get(AUTH_ACCESS_KEY)?.trim() || "";
  const signedIn = Boolean(username && (access || deps.store.get(AUTH_PASS_KEY)));
  const source: AuthSnapshot["source"] = signedIn ? "oauth" : readManualToken() ? "manual" : "none";
  return { username, signedIn, expiresAt, source, lastError: "" };
}

function persistToken(username: string, password: string, token: TokenResponse): number {
  const seconds = Number(token.expires_in);
  const ttlMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3600 * 1000;
  const expiresAt = deps.now() + ttlMs;
  deps.store.set(AUTH_USER_KEY, username);
  deps.store.set(AUTH_PASS_KEY, password);
  deps.store.set(AUTH_ACCESS_KEY, token.access_token);
  deps.store.set(AUTH_EXPIRY_KEY, String(expiresAt));
  return expiresAt;
}

export async function requestToken(username: string, password: string): Promise<TokenResponse> {
  const params = new URLSearchParams();
  params.set("username", username);
  params.set("password", password);
  try {
    const res = await deps.fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const raw = await res.text();
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    if (!res.ok) {
      const detail = extractDetail(body) || `OpenF1 /token returned ${res.status}.`;
      throw new OpenF1Error("http", detail, res.status, detail);
    }
    const parsed = body as TokenResponse;
    if (!parsed?.access_token) {
      throw new OpenF1Error("unknown", "OpenF1 /token did not return an access_token.", res.status, raw);
    }
    return parsed;
  } catch (err) {
    if (err instanceof OpenF1Error) throw err;
    if (isNetworkFailure(err)) {
      throw new OpenF1Error(
        "unknown",
        "OpenF1 blocked the sign-in request (CORS or network). Check your connection, or paste a bearer token under Advanced.",
        null,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw new OpenF1Error("unknown", err instanceof Error ? err.message : "Sign-in failed.", null, "");
  }
}

export async function signIn(username: string, password: string): Promise<AuthSnapshot> {
  const user = username.trim();
  if (!user || !password) {
    throw new OpenF1Error("http", "Enter your OpenF1 username and password.", 400, "");
  }
  const token = await requestToken(user, password);
  persistToken(user, password, token);
  return peekAuth();
}

export function signOut(): void {
  deps.store.remove(AUTH_USER_KEY);
  deps.store.remove(AUTH_PASS_KEY);
  deps.store.remove(AUTH_ACCESS_KEY);
  deps.store.remove(AUTH_EXPIRY_KEY);
}

function tokenStillFresh(expiresAt: number): boolean {
  return expiresAt - TOKEN_REFRESH_SKEW_MS > deps.now();
}

export async function getAccessToken(opts: { force?: boolean } = {}): Promise<string> {
  const username = deps.store.get(AUTH_USER_KEY)?.trim() || "";
  const password = deps.store.get(AUTH_PASS_KEY) || "";
  const cached = deps.store.get(AUTH_ACCESS_KEY)?.trim() || "";
  const expiresAt = Number(deps.store.get(AUTH_EXPIRY_KEY) || 0);

  if (username && password) {
    if (!opts.force && cached && tokenStillFresh(expiresAt)) return cached;
    const token = await requestToken(username, password);
    persistToken(username, password, token);
    return token.access_token;
  }
  return readManualToken();
}

/** True when a forced refresh produced a new token (used for a single 401 retry). */
export async function tryRefreshAfter401(): Promise<boolean> {
  if (!hasPasswordLogin()) return false;
  try {
    const next = await getAccessToken({ force: true });
    return Boolean(next);
  } catch {
    return false;
  }
}
