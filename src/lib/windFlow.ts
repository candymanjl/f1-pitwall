/** Shaft + flow stroke widths for the status-bar wind arrow. */
export const WIND_ARROW_WIDTH = 4.6;
export const WIND_FLOW_WIDTH = 3.2;
export const WIND_FLOW_DASH = "10 8";
/** One dash+gap cycle — used as the CSS dashoffset loop length. */
export const WIND_FLOW_CYCLE = 18;

/**
 * CSS animation period from OpenF1 `wind_speed` (m/s).
 * Calm ≈ 9s (near-still). A stiff 10 m/s breeze ≈ 0.6s.
 */
export function windFlowPeriodMs(speed: number | null | undefined): number {
  const s = typeof speed === "number" && Number.isFinite(speed) ? Math.max(0, speed) : 0;
  return Math.round(9000 / (1 + s * 1.35));
}

export function prefersReducedMotion(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(globalThis),
): boolean {
  try {
    return Boolean(matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  } catch {
    return false;
  }
}
