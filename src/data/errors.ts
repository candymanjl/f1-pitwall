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

export function classifyOpenF1Failure(input: {
  status?: number | null;
  body?: unknown;
  cause?: unknown;
  path?: string;
}): OpenF1Error {
  const detail = extractDetail(input.body);
  const causeMsg = input.cause instanceof Error ? input.cause.message : input.cause ? String(input.cause) : "";
  const text = `${detail} ${causeMsg}`;
  const status = input.status ?? null;
  const path = input.path ? ` on ${input.path}` : "";

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
