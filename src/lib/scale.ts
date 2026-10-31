export type UiScalePref = "auto" | 100 | 125 | 150 | 175 | 200;

export const UI_SCALE_OPTIONS: UiScalePref[] = ["auto", 100, 125, 150, 175, 200];
export const UI_SCALE_STORAGE_KEY = "f1pitwall.uiScale";

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Auto scale so a 1920×1080 layout fills larger viewports, capped at 2×. */
export function autoScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return clamp(Math.min(width / 1920, height / 1080), 1, 2);
}

export function resolveScale(pref: UiScalePref, width: number, height: number): number {
  if (pref === "auto") return autoScale(width, height);
  return clamp(pref / 100, 1, 2);
}

export function parseUiScale(raw: string | null | undefined): UiScalePref {
  if (raw === "auto" || raw === "" || raw == null) return "auto";
  const n = Number(raw);
  if (n === 100 || n === 125 || n === 150 || n === 175 || n === 200) return n;
  return "auto";
}

export function readUiScale(): UiScalePref {
  try {
    return parseUiScale(localStorage.getItem(UI_SCALE_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

export function writeUiScale(pref: UiScalePref): void {
  localStorage.setItem(UI_SCALE_STORAGE_KEY, String(pref));
}

let applied = 1;

export function currentUiScale(): number {
  return applied;
}

export function applyUiScale(
  pref: UiScalePref,
  viewport: { width: number; height: number } = {
    width: typeof window !== "undefined" ? window.innerWidth : 1920,
    height: typeof window !== "undefined" ? window.innerHeight : 1080,
  },
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): number {
  applied = resolveScale(pref, viewport.width, viewport.height);
  if (root) {
    root.style.setProperty("--ui-scale", String(applied));
    root.style.fontSize = `${16 * applied}px`;
  }
  return applied;
}
