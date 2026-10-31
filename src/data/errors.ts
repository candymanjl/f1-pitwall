export type ErrorKind = "live-lock" | "http" | "unknown";

export class OpenF1Error extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;
  readonly detail: string;

  constructor(kind: ErrorKind, message: string, status: number | null = null, detail = "") {
    super(message);
    this.name = "OpenF1Error";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const LIVE_LOCK_RE = /live f1 session in progress|restricted to authenticated users/i;
const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed/i;

export function extractDetail(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (typeof body === "object" && body && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
  }
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

export function isNetworkFailure(cause: unknown): boolean {
  if (!cause) return false;
  const name = cause instanceof Error ? cause.name : "";
  const msg = cause instanceof Error ? cause.message : String(cause);
  if (cause instanceof TypeError && NETWORK_RE.test(msg)) return true;
  if (name === "TypeError" && NETWORK_RE.test(msg)) return true;
  return NETWORK_RE.test(msg);
}

export function isLiveLock(err: unknown): boolean {
  if (err instanceof OpenF1Error) return err.kind === "live-lock";
  return classifyOpenF1Failure({ cause: err }).kind === "live-lock";
}

/**
 * Show the lock banner whenever REST is actually locked.
 * A stored token does not lift OpenF1's live lock in the browser: Authorization
 * triggers an OPTIONS preflight, and /v1 OPTIONS returns 401 with no CORS headers,
 * so the bearer never leaves the client.
 */
export function shouldShowLiveLockBanner(lock: "live" | null | undefined, _authed?: boolean): boolean {
  return lock === "live";
}

export function classifyOpenF1Failure(input: {
  status?: number | null;
  body?: unknown;
  cause?: unknown;
  path?: string;
  authenticated?: boolean;
  /** True when Authorization: Bearer was set on the request that failed. */
  tokenAttached?: boolean;
}): OpenF1Error {
  const detail = extractDetail(input.body);
  const causeMsg = input.cause instanceof Error ? input.cause.message : input.cause ? String(input.cause) : "";
  const text = `${detail} ${causeMsg}`;
  const status = input.status ?? null;
  const path = input.path ? ` on ${input.path}` : "";
  const prior = input.cause instanceof OpenF1Error ? input.cause : null;
  const looksLocked =
    LIVE_LOCK_RE.test(text) ||
    (status === 401 && !detail) ||
    isNetworkFailure(input.cause) ||
    prior?.kind === "live-lock";

  // Only blame a missing header when we truly did not attach one. A stored
  // token + CORS/401 is the live lock (OPTIONS /v1 dies before GET+Bearer).
  if (input.authenticated && looksLocked && !input.tokenAttached) {
    return new OpenF1Error(
      "http",
      "Signed in, but OpenF1 still rejected the request. The bearer token may not have been sent — retry.",
      status ?? prior?.status ?? 401,
      detail || causeMsg || prior?.detail || "",
    );
  }

  if (LIVE_LOCK_RE.test(text)) {
    return new OpenF1Error(
      "live-lock",
      "OpenF1 is locked while a live F1 session is running.",
      status ?? 401,
      detail || causeMsg,
    );
  }
  if (status === 401 && detail) {
    return new OpenF1Error("http", detail, 401, detail);
  }
  if (status === 401) {
    return new OpenF1Error(
      "live-lock",
      "OpenF1 is locked while a live F1 session is running.",
      401,
      detail || causeMsg,
    );
  }
  if (isNetworkFailure(input.cause)) {
    return new OpenF1Error(
      "live-lock",
      "OpenF1 is locked while a live F1 session is running.",
      status,
      "The request was blocked (often a 401 without CORS headers during a live session).",
    );
  }
  if (status && status >= 400) {
    return new OpenF1Error("http", `OpenF1 returned ${status}${path}.`, status, detail || causeMsg);
  }
  if (input.cause instanceof OpenF1Error) return input.cause;
  return new OpenF1Error("unknown", causeMsg || "Something went wrong talking to OpenF1.", status, detail);
}
