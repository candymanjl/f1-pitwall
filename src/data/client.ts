import {
  HISTORICAL_TTL_MS,
  RATE_MIN_GAP_MS,
  RATE_PER_MINUTE,
  RELAY_CONCURRENCY,
  RELAY_RATE_MIN_GAP_MS,
  RELAY_RATE_PER_MINUTE,
  readRelayUrl,
  restBase,
} from "../config";
import { hasUsableAuth, peekAccessToken } from "./auth";
import { authorizedFetch } from "./clientAuth";
import { classifyOpenF1Failure, isNetworkFailure, OpenF1Error } from "./errors";

type CacheEntry = { expires: number; body: unknown };

/** Old live-era `f1pw.cache:` rows (empty or partial) must not survive a new build. */
export const CACHE_PERSIST_PREFIX = "f1pw.cache.v3:";
export const BUILD_CACHE_KEY = "f1pw.buildCache";

const memory = new Map<string, CacheEntry>();
const queue: Array<() => Promise<unknown>> = [];
let lastSent = 0;
const sentAt: number[] = [];
let pumping = false;
let inFlight = 0;
const slotWaiters: Array<() => void> = [];
let cooldownUntil = 0;

/** Parse Retry-After (delta-seconds or HTTP-date). Caps at 60s. */
export function parseRetryAfterMs(header: string | null | undefined, fallback = 2000): number {
  if (!header) return fallback;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.min(60_000, Math.max(500, Math.round(Number(trimmed) * 1000)));
  }
  const when = Date.parse(trimmed);
  if (Number.isFinite(when)) return Math.min(60_000, Math.max(500, when - Date.now()));
  return fallback;
}

export function noteRateLimit(retryAfterMs: number): void {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.max(0, retryAfterMs));
}

export function activeRateLimits(): { minGapMs: number; perMinute: number; concurrency: number } {
  if (readRelayUrl()) {
    return { minGapMs: RELAY_RATE_MIN_GAP_MS, perMinute: RELAY_RATE_PER_MINUTE, concurrency: RELAY_CONCURRENCY };
  }
  return { minGapMs: RATE_MIN_GAP_MS, perMinute: RATE_PER_MINUTE, concurrency: 1 };
}

function cacheKey(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${path}?${q}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const { minGapMs, perMinute, concurrency } = activeRateLimits();
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] > 60_000) sentAt.shift();
    const cool = cooldownUntil - Date.now();
    if (cool > 0) await wait(cool);
    if (inFlight >= concurrency) {
      await new Promise<void>((resolve) => {
        slotWaiters.push(resolve);
      });
      continue;
    }
    const gap = minGapMs - (Date.now() - lastSent);
    const minuteWait = sentAt.length >= perMinute ? 60_000 - (Date.now() - sentAt[0]) : 0;
    const delay = Math.max(gap, minuteWait, 0);
    if (delay > 0) await wait(delay);
    const job = queue.shift();
    if (!job) break;
    lastSent = Date.now();
    sentAt.push(lastSent);
    inFlight += 1;
    void Promise.resolve()
      .then(job)
      .finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        const next = slotWaiters.shift();
        next?.();
      });
  }
  pumping = false;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    void pump();
  });
}

/** Empty live snapshots must not stick in localStorage for a week. */
export const EMPTY_BODY_TTL_MS = 15_000;

function isEmptyBody(body: unknown): boolean {
  return Array.isArray(body) && body.length === 0;
}

function persistKey(key: string): string {
  return `${CACHE_PERSIST_PREFIX}${key}`;
}

function listLocalStorageKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * Drop OpenF1 HTTP snapshots left over from a previous build (or the old
 * `f1pw.cache:` prefix). Rich cannot open DevTools, so a new deploy has to
 * forget the live-session empties by itself.
 */
export function purgeStaleClientCache(buildVersion: string): void {
  try {
    const prev = localStorage.getItem(BUILD_CACHE_KEY);
    const bump = prev !== buildVersion;
    for (const k of listLocalStorageKeys()) {
      const oldGen = k.startsWith("f1pw.cache:") && !k.startsWith(CACHE_PERSIST_PREFIX);
      const thisGen = k.startsWith(CACHE_PERSIST_PREFIX);
      if (oldGen || (bump && thisGen)) localStorage.removeItem(k);
    }
    if (bump) localStorage.setItem(BUILD_CACHE_KEY, buildVersion);
  } catch {
    /* private mode / node tests */
  }
}

/** Unregister a leftover SW / Cache Storage and wipe stale OpenF1 rows. */
export function dropStaleAppCaches(buildVersion: string): void {
  purgeStaleClientCache(buildVersion);
  try {
    const sw = (globalThis as { navigator?: Navigator }).navigator?.serviceWorker;
    void sw?.getRegistrations?.().then((regs) => {
      for (const r of regs) void r.unregister();
    });
  } catch {
    /* ignore */
  }
  try {
    const store = (globalThis as { caches?: CacheStorage }).caches;
    void store?.keys?.().then((keys) => {
      for (const k of keys) void store.delete(k);
    });
  } catch {
    /* ignore */
  }
}

async function persistGet(key: string): Promise<unknown | null> {
  try {
    const raw = localStorage.getItem(persistKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.expires < Date.now() || isEmptyBody(parsed.body)) {
      localStorage.removeItem(persistKey(key));
      return null;
    }
    return parsed.body;
  } catch {
    return null;
  }
}

function persistSet(key: string, entry: CacheEntry): void {
  if (isEmptyBody(entry.body)) return;
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > 400_000) return;
    localStorage.setItem(persistKey(key), raw);
  } catch {
    /* quota — ignore */
  }
}

async function httpError(
  res: Response,
  path: string,
  tokenAttached: boolean,
  authenticated: boolean,
): Promise<OpenF1Error> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    try {
      body = await res.text();
    } catch {
      body = null;
    }
  }
  return classifyOpenF1Failure({
    status: res.status,
    body,
    path,
    authenticated,
    tokenAttached,
  });
}

/** Live `latest` feeds must stay authenticated; every other session can fall back to public REST. */
export function shouldRetryWithoutAuth(url: string): boolean {
  try {
    const u = new URL(url, restBase());
    const session = u.searchParams.get("session_key");
    const meeting = u.searchParams.get("meeting_key");
    return session !== "latest" && meeting !== "latest";
  } catch {
    return true;
  }
}

export function isRetryableAuthFailure(err: unknown): boolean {
  if (err instanceof OpenF1Error) {
    if (err.kind === "live-lock") return true;
    if (err.status === 401 || err.status === 403) return true;
  }
  return isNetworkFailure(err);
}

export function resetClientForTests(): void {
  memory.clear();
  queue.length = 0;
  lastSent = 0;
  sentAt.length = 0;
  pumping = false;
  inFlight = 0;
  slotWaiters.length = 0;
  cooldownUntil = 0;
}

async function fetchJson(url: string, path: string, anonymous: boolean): Promise<unknown> {
  const tokenAttached = !anonymous && Boolean(peekAccessToken());
  const classifyOpts = {
    path,
    authenticated: !anonymous && hasUsableAuth(),
    tokenAttached,
  };
  try {
    const res = await authorizedFetch(url, {}, { anonymous });
    if (res.status === 404) return [];
    if (res.status === 429) {
      const waitMs = parseRetryAfterMs(res.headers.get("Retry-After"), 2000);
      noteRateLimit(waitMs);
      await wait(waitMs);
      const retry = await authorizedFetch(url, {}, { anonymous });
      if (retry.status === 404) return [];
      if (retry.status === 429) {
        noteRateLimit(parseRetryAfterMs(retry.headers.get("Retry-After"), 4000));
        throw await httpError(retry, path, tokenAttached, classifyOpts.authenticated);
      }
      if (!retry.ok) throw await httpError(retry, path, tokenAttached, classifyOpts.authenticated);
      return retry.json();
    }
    if (!res.ok) throw await httpError(res, path, tokenAttached, classifyOpts.authenticated);
    return res.json();
  } catch (err) {
    if (err instanceof OpenF1Error) throw err;
    throw classifyOpenF1Failure({ cause: err, ...classifyOpts });
  }
}

export async function apiGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  opts: { ttlMs?: number; force?: boolean } = {},
): Promise<T> {
  const ttl = opts.ttlMs ?? HISTORICAL_TTL_MS;
  const key = cacheKey(path, params);
  if (!opts.force) {
    const hit = memory.get(key);
    if (hit && hit.expires > Date.now()) return hit.body as T;
    const stored = await persistGet(key);
    if (stored != null) {
      memory.set(key, { expires: Date.now() + ttl, body: stored });
      return stored as T;
    }
  }

  const url = new URL(`${restBase()}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const body = await enqueue(async () => {
    try {
      return await fetchJson(url.toString(), path, false);
    } catch (err) {
      if (shouldRetryWithoutAuth(url.toString()) && isRetryableAuthFailure(err)) {
        return await fetchJson(url.toString(), path, true);
      }
      throw err;
    }
  });

  const keepMs = isEmptyBody(body) ? EMPTY_BODY_TTL_MS : ttl;
  const entry = { expires: Date.now() + keepMs, body };
  memory.set(key, entry);
  persistSet(key, { ...entry, expires: Date.now() + ttl });
  return body as T;
}

export function remember<T>(key: string, body: T, ttlMs = HISTORICAL_TTL_MS): T {
  memory.set(key, { expires: Date.now() + ttlMs, body });
  return body;
}
