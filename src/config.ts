/** App config. Tokens stay in the browser (localStorage) or a local .env — never committed. */

export const API_BASE = "https://api.openf1.org/v1";

export const DEFAULT_YEAR = 2025;
export const DEFAULT_MEETING_KEY = 1272; // Mexico City GP
export const DEFAULT_SESSION_KEY = 9877; // Race

export const RATE_MIN_GAP_MS = 380;
export const RATE_PER_MINUTE = 28;
export const HISTORICAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LIVE_POLL_MS = 4000;
/** How often to retry OpenF1 after a live-session lock (or CORS 401). */
export const LIVE_LOCK_RETRY_MS = 3 * 60 * 1000;

export const SPEEDS = [1, 2, 4, 8, 16] as const;

export const TOKEN_STORAGE_KEY = "f1pitwall.openf1Token";
export const MODE_STORAGE_KEY = "f1pitwall.dataMode";
export const PIT_LOSS_STORAGE_KEY = "f1pitwall.pitLoss";

export const DEFAULT_PIT_LOSS = {
  green: 22,
  vsc: 13,
  sc: 10,
};

/** Typical dry/wet allocation — used only to estimate unused sets. */
export const TYRE_ALLOCATION: Record<string, number> = {
  SOFT: 8,
  MEDIUM: 3,
  HARD: 2,
  INTERMEDIATE: 4,
  WET: 3,
};

export type DataMode = "historical" | "live";

export function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function writeToken(token: string): void {
  if (token.trim()) localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function readMode(): DataMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "live" ? "live" : "historical";
  } catch {
    return "historical";
  }
}

export function writeMode(mode: DataMode): void {
  localStorage.setItem(MODE_STORAGE_KEY, mode);
}

export function readPitLoss(): typeof DEFAULT_PIT_LOSS {
  try {
    const raw = localStorage.getItem(PIT_LOSS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PIT_LOSS };
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_PIT_LOSS>;
    return {
      green: Number(parsed.green) || DEFAULT_PIT_LOSS.green,
      vsc: Number(parsed.vsc) || DEFAULT_PIT_LOSS.vsc,
      sc: Number(parsed.sc) || DEFAULT_PIT_LOSS.sc,
    };
  } catch {
    return { ...DEFAULT_PIT_LOSS };
  }
}

export function writePitLoss(loss: typeof DEFAULT_PIT_LOSS): void {
  localStorage.setItem(PIT_LOSS_STORAGE_KEY, JSON.stringify(loss));
}
