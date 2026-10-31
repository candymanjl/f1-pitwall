import { API_BASE, HISTORICAL_TTL_MS, RATE_MIN_GAP_MS, RATE_PER_MINUTE } from "../config";
import { hasUsableAuth } from "./auth";
import { authorizedFetch } from "./clientAuth";
import { classifyOpenF1Failure, OpenF1Error } from "./errors";

type CacheEntry = { expires: number; body: unknown };

const memory = new Map<string, CacheEntry>();
const queue: Array<() => void> = [];
let lastSent = 0;
const sentAt: number[] = [];
let pumping = false;

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
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] > 60_000) sentAt.shift();
    const gap = RATE_MIN_GAP_MS - (now - lastSent);
    const minuteWait = sentAt.length >= RATE_PER_MINUTE ? 60_000 - (now - sentAt[0]) : 0;
    const delay = Math.max(gap, minuteWait, 0);
    if (delay > 0) await wait(delay);
    lastSent = Date.now();
    sentAt.push(lastSent);
    const job = queue.shift();
    job?.();
  }
  pumping = false;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => {
      fn().then(resolve, reject);
    });
    void pump();
  });
}

async function persistGet(key: string): Promise<unknown | null> {
  try {
    const raw = localStorage.getItem(`f1pw.cache:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.expires < Date.now()) {
      localStorage.removeItem(`f1pw.cache:${key}`);
      return null;
    }
    return parsed.body;
  } catch {
    return null;
  }
}

function persistSet(key: string, entry: CacheEntry): void {
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > 400_000) return;
    localStorage.setItem(`f1pw.cache:${key}`, raw);
  } catch {
    /* quota — ignore */
  }
}

async function httpError(res: Response, path: string): Promise<OpenF1Error> {
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
  return classifyOpenF1Failure({ status: res.status, body, path, authenticated: hasUsableAuth() });
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

  const url = new URL(`${API_BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const body = await enqueue(async () => {
    try {
      const res = await authorizedFetch(url.toString());
      if (res.status === 429) {
        await wait(1500);
        const retry = await authorizedFetch(url.toString());
        if (!retry.ok) throw await httpError(retry, path);
        return retry.json();
      }
      if (!res.ok) throw await httpError(res, path);
      return res.json();
    } catch (err) {
      if (err instanceof OpenF1Error) throw err;
      throw classifyOpenF1Failure({ cause: err, path, authenticated: hasUsableAuth() });
    }
  });

  const entry = { expires: Date.now() + ttl, body };
  memory.set(key, entry);
  persistSet(key, entry);
  return body as T;
}

export function remember<T>(key: string, body: T, ttlMs = HISTORICAL_TTL_MS): T {
  memory.set(key, { expires: Date.now() + ttlMs, body });
  return body;
}
