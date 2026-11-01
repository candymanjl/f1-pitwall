import { wrap01 } from "./pitcircle";

/**
 * Map a lap fraction onto the footer strip: S/F sits at 0.5 (center),
 * cars travel left → right, and wrap from the right edge back to the left.
 */
export function stripFrac(lapFrac: number): number {
  return wrap01(lapFrac + 0.5);
}

export function stripX(lapFrac: number, width: number, pad = 8): number {
  const span = Math.max(1, width - pad * 2);
  return pad + stripFrac(lapFrac) * span;
}

export function nearestStripCar<T extends { n: number; x: number }>(
  cars: T[],
  x: number,
  radius = 16,
): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const car of cars) {
    const d = Math.abs(car.x - x);
    if (d <= bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}
