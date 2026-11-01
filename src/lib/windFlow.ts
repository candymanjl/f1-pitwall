/** Solid head size and chevron spacing for the footer wind arrow. */
export const WIND_HEAD_LEN = 13;
export const WIND_CHEVRON_STEP = 9;
export const WIND_CHEVRON_ARM = 5.6;
export const WIND_CHEVRON_WIDTH = 2.5;
/** Keep enough shaft on the 96×72 footer for several readable chevrons. */
export const WIND_ARROW_MIN_LEN = 52;
/** One chevron+gap cycle — CSS translate distance for a seamless loop. */
export const WIND_CHEVRON_CYCLE = WIND_CHEVRON_STEP;

function unit(x1: number, y1: number, x2: number, y2: number): {
  ux: number;
  uy: number;
  px: number;
  py: number;
  len: number;
} {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { ux, uy, px: -uy, py: ux, len };
}

function pt(x: number, y: number): string {
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}

/** Stretch a short bearing so the chevron shaft stays readable, then clamp. */
export function fitWindArrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  height: number,
  minLen = WIND_ARROW_MIN_LEN,
): { x1: number; y1: number; x2: number; y2: number } {
  const { ux, uy, len } = unit(x1, y1, x2, y2);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const half = Math.max(len, minLen) / 2;
  const pad = 6;
  let ax = cx - ux * half;
  let ay = cy - uy * half;
  let bx = cx + ux * half;
  let by = cy + uy * half;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  ax = clamp(ax, pad, Math.max(pad, width - pad));
  ay = clamp(ay, pad, Math.max(pad, height - pad));
  bx = clamp(bx, pad, Math.max(pad, width - pad));
  by = clamp(by, pad, Math.max(pad, height - pad));
  return { x1: ax, y1: ay, x2: bx, y2: by };
}

/** Solid triangular head pointing from (x1,y1) toward (x2,y2). */
export function windArrowHeadPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen = WIND_HEAD_LEN,
): string {
  const { ux, uy, px, py } = unit(x1, y1, x2, y2);
  const tipX = x2;
  const tipY = y2;
  const neckX = x2 - ux * headLen;
  const neckY = y2 - uy * headLen;
  const half = headLen * 0.55;
  return [
    `M${pt(neckX + px * half, neckY + py * half)}`,
    `L${pt(tipX, tipY)}`,
    `L${pt(neckX - px * half, neckY - py * half)}`,
    "Z",
  ].join(" ");
}

function chevronAt(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  px: number,
  py: number,
  arm: number,
): string {
  const tipX = cx + ux * arm * 0.55;
  const tipY = cy + uy * arm * 0.55;
  const back = arm * 0.4;
  return [
    `M${pt(cx - ux * back + px * arm, cy - uy * back + py * arm)}`,
    `L${pt(tipX, tipY)}`,
    `L${pt(cx - ux * back - px * arm, cy - uy * back - py * arm)}`,
  ].join(" ");
}

export type WindChevronGeometry = {
  head: string;
  chevrons: string;
  clip: string;
  count: number;
  cycle: number;
  cycleX: number;
  cycleY: number;
};

/**
 * Complete Option 2 arrow: solid head + repeating chevrons along the shaft.
 * Extra chevrons sit behind the tail so a one-step translate loops cleanly
 * inside `clip` (tail → neck).
 */
export function windChevronGeometry(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headLen = WIND_HEAD_LEN,
  step = WIND_CHEVRON_STEP,
  arm = WIND_CHEVRON_ARM,
): WindChevronGeometry {
  const { ux, uy, px, py, len } = unit(x1, y1, x2, y2);
  const shaft = Math.max(0, len - headLen);
  const extras = 2;
  const bits: string[] = [];
  let count = 0;
  for (let t = -extras * step; t <= shaft + extras * step + 0.01; t += step) {
    bits.push(chevronAt(x1 + ux * t, y1 + uy * t, ux, uy, px, py, arm));
    count += 1;
  }
  const half = arm + 1.4;
  const neckX = x1 + ux * shaft;
  const neckY = y1 + uy * shaft;
  const clip = [
    `M${pt(x1 + px * half, y1 + py * half)}`,
    `L${pt(neckX + px * half, neckY + py * half)}`,
    `L${pt(neckX - px * half, neckY - py * half)}`,
    `L${pt(x1 - px * half, y1 - py * half)}`,
    "Z",
  ].join(" ");
  return {
    head: windArrowHeadPath(x1, y1, x2, y2, headLen),
    chevrons: bits.join(" "),
    clip,
    count,
    cycle: step,
    cycleX: ux * step,
    cycleY: uy * step,
  };
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
