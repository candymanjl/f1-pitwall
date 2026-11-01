/** Shaft + flow stroke widths for the status-bar wind arrow. */
export const WIND_ARROW_WIDTH = 4.6;
export const WIND_FLOW_WIDTH = 2.6;
export const WIND_FLOW_DASH = "10 8";
/** One dash+gap cycle — used as the CSS dashoffset loop length. */
export const WIND_FLOW_CYCLE = 18;
export const WIND_HEAD_LEN = 13;

/** Closed shaft+head polygon and an open path that traces the whole arrow. */
export function windArrowPaths(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen = WIND_HEAD_LEN,
  shaftW = WIND_ARROW_WIDTH,
): { body: string; flow: string } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const tipX = x2;
  const tipY = y2;
  const neckX = x2 - ux * headLen;
  const neckY = y2 - uy * headLen;
  const half = shaftW / 2;
  const headHalf = headLen * 0.55;
  const tailLx = x1 + px * half;
  const tailLy = y1 + py * half;
  const tailRx = x1 - px * half;
  const tailRy = y1 - py * half;
  const neckLx = neckX + px * half;
  const neckLy = neckY + py * half;
  const neckRx = neckX - px * half;
  const neckRy = neckY - py * half;
  const leftX = neckX + px * headHalf;
  const leftY = neckY + py * headHalf;
  const rightX = neckX - px * headHalf;
  const rightY = neckY - py * headHalf;
  const body = [
    `M${tailLx.toFixed(1)},${tailLy.toFixed(1)}`,
    `L${neckLx.toFixed(1)},${neckLy.toFixed(1)}`,
    `L${leftX.toFixed(1)},${leftY.toFixed(1)}`,
    `L${tipX.toFixed(1)},${tipY.toFixed(1)}`,
    `L${rightX.toFixed(1)},${rightY.toFixed(1)}`,
    `L${neckRx.toFixed(1)},${neckRy.toFixed(1)}`,
    `L${tailRx.toFixed(1)},${tailRy.toFixed(1)}`,
    "Z",
  ].join(" ");
  const flow = [
    `M${x1.toFixed(1)},${y1.toFixed(1)}`,
    `L${tipX.toFixed(1)},${tipY.toFixed(1)}`,
    `L${leftX.toFixed(1)},${leftY.toFixed(1)}`,
    `M${tipX.toFixed(1)},${tipY.toFixed(1)}`,
    `L${rightX.toFixed(1)},${rightY.toFixed(1)}`,
  ].join(" ");
  return { body, flow };
}

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
