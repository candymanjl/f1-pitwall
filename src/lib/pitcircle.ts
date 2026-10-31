/** One revolution, clockwise from S/F at 12 o'clock (SVG y-down). */

export function wrap01(frac: number): number {
  if (!Number.isFinite(frac)) return 0;
  return ((frac % 1) + 1) % 1;
}

/** Angle in radians: 0 frac = 12 o'clock, increasing frac travels clockwise. */
export function fracToAngle(frac: number): number {
  return -Math.PI / 2 + wrap01(frac) * Math.PI * 2;
}

export function pointOnCircle(
  cx: number,
  cy: number,
  r: number,
  frac: number,
): { x: number; y: number; a: number } {
  const a = fracToAngle(frac);
  return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a };
}

/** Midpoint travelling clockwise from `from` to `to`. */
export function midFracClockwise(from: number, to: number): number {
  const d = wrap01(to - from);
  return wrap01(from + d / 2);
}

export function clockwiseDelta(from: number, to: number): number {
  const d = wrap01(to - from);
  return d === 0 ? 0 : d;
}

export type CircleCar = {
  driver: number;
  code: string;
  frac: number;
  inPit: boolean;
  retired: boolean;
  pace: number | null;
};

/** Place a car from leader progress + gap (seconds), matching the track map. */
export function gapFrac(leaderProgress: number, gapSec: number, lapSec: number): number {
  return wrap01(leaderProgress - gapSec / Math.max(1, lapSec));
}

/** Map elapsed-lap progress onto the racing line. Pit-out laps start at pit exit. */
export function racingFrac(progress: number, pitOut: boolean, pitExit: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (!pitOut) return Math.min(0.999, p);
  const exit = wrap01(pitExit);
  return wrap01(exit + p * (1 - exit));
}

export type TrackGap = {
  behind: number;
  ahead: number;
  behindCode: string;
  aheadCode: string;
  from: number;
  to: number;
  mid: number;
  gap: number;
};

export const GAP_WEDGE_FILLS = [
  "rgba(225, 6, 0, 0.18)",
  "rgba(56, 189, 248, 0.16)",
  "rgba(250, 204, 21, 0.15)",
  "rgba(163, 230, 53, 0.14)",
  "rgba(192, 132, 252, 0.16)",
  "rgba(244, 114, 182, 0.14)",
  "rgba(45, 212, 191, 0.14)",
  "rgba(249, 115, 22, 0.15)",
];

/** Filled clockwise pie slice from `from` to `to` (S/F = 0 at 12 o'clock). */
export function wedgePath(cx: number, cy: number, r: number, from: number, to: number): string {
  const delta = clockwiseDelta(from, to);
  if (delta < 1e-6 || r <= 0) return "";
  const a = pointOnCircle(cx, cy, r, from);
  const b = pointOnCircle(cx, cy, r, to);
  const large = delta > 0.5 ? 1 : 0;
  return `M${cx.toFixed(1)},${cy.toFixed(1)} L${a.x.toFixed(1)},${a.y.toFixed(1)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(1)},${b.y.toFixed(1)} Z`;
}

/**
 * Gaps between consecutive cars on the racing line (physical order, including
 * lapped cars). Time = clockwise frac delta × the trailing car's pace.
 */
export function onTrackGaps(cars: CircleCar[], fallbackPace: number): TrackGap[] {
  const on = cars
    .filter((c) => !c.retired && !c.inPit && Number.isFinite(c.frac))
    .sort((a, b) => wrap01(a.frac) - wrap01(b.frac));
  if (on.length < 2) return [];
  const out: TrackGap[] = [];
  for (let i = 0; i < on.length; i++) {
    const behind = on[i];
    const ahead = on[(i + 1) % on.length];
    const dfrac = clockwiseDelta(behind.frac, ahead.frac);
    const pace = behind.pace && behind.pace > 0 ? behind.pace : fallbackPace;
    out.push({
      behind: behind.driver,
      ahead: ahead.driver,
      behindCode: behind.code,
      aheadCode: ahead.code,
      from: wrap01(behind.frac),
      to: wrap01(ahead.frac),
      mid: midFracClockwise(behind.frac, ahead.frac),
      gap: dfrac * pace,
    });
  }
  return out;
}

export function ghostFrac(current: number, pitLoss: number, lapTime: number): number {
  const lap = lapTime > 0 ? lapTime : 90;
  return wrap01(current - pitLoss / lap);
}

export function neighborsAt(
  cars: CircleCar[],
  frac: number,
): { ahead: CircleCar | null; behind: CircleCar | null } {
  const on = cars
    .filter((c) => !c.retired && !c.inPit)
    .sort((a, b) => wrap01(a.frac) - wrap01(b.frac));
  if (!on.length) return { ahead: null, behind: null };
  let ahead = on[0];
  let behind = on[on.length - 1];
  for (const c of on) {
    if (wrap01(c.frac) > wrap01(frac) + 1e-9) {
      ahead = c;
      break;
    }
    behind = c;
  }
  const idx = on.indexOf(ahead);
  behind = on[(idx - 1 + on.length) % on.length];
  if (ahead.driver === behind.driver && on.length === 1) return { ahead: on[0], behind: on[0] };
  return { ahead, behind };
}
