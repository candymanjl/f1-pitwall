import { parseTs } from "../lib/time";
import type { Driver, Lap, LocationSample } from "./types";

export function buildOutline(samples: LocationSample[]): [number, number][] {
  if (samples.length < 8) return [];
  const pts: [number, number][] = [];
  let lastX = Infinity;
  let lastY = Infinity;
  for (const s of samples) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
    const dx = s.x - lastX;
    const dy = s.y - lastY;
    if (dx * dx + dy * dy < 80) continue;
    pts.push([s.x, s.y]);
    lastX = s.x;
    lastY = s.y;
  }
  return pts;
}

export function polylineLength(pts: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    d += Math.hypot(dx, dy);
  }
  return d;
}

export function pointAt(pts: [number, number][], frac: number): [number, number] {
  if (!pts.length) return [0, 0];
  if (pts.length === 1) return pts[0];
  const f = ((frac % 1) + 1) % 1;
  const total = polylineLength(pts);
  let remain = f * total;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dy);
    if (remain <= seg) {
      const t = seg === 0 ? 0 : remain / seg;
      return [pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t];
    }
    remain -= seg;
  }
  return pts[pts.length - 1];
}

export function detectCorners(pts: [number, number][]): { n: number; x: number; y: number; dist: number }[] {
  if (pts.length < 12) return [];
  const total = polylineLength(pts);
  const corners: { n: number; x: number; y: number; dist: number }[] = [];
  let acc = 0;
  let lastCornerDist = -1e9;
  let n = 1;
  for (let i = 2; i < pts.length - 1; i++) {
    const dx1 = pts[i - 1][0] - pts[i - 2][0];
    const dy1 = pts[i - 1][1] - pts[i - 2][1];
    const dx2 = pts[i][0] - pts[i - 1][0];
    const dy2 = pts[i][1] - pts[i - 1][1];
    acc += Math.hypot(dx2, dy2);
    const a1 = Math.atan2(dy1, dx1);
    const a2 = Math.atan2(dy2, dx2);
    let da = Math.abs(a2 - a1);
    if (da > Math.PI) da = 2 * Math.PI - da;
    const distFrac = acc / total;
    if (da > 0.38 && acc - lastCornerDist > total * 0.028) {
      corners.push({ n, x: pts[i][0], y: pts[i][1], dist: distFrac });
      lastCornerDist = acc;
      n += 1;
    }
  }
  return corners.slice(0, 20);
}

export function slicePolyline(pts: [number, number][], fromFrac: number, toFrac: number): [number, number][] {
  if (pts.length < 2) return pts.slice();
  const total = polylineLength(pts);
  if (total <= 0) return [pts[0]];
  const a = Math.max(0, Math.min(1, fromFrac));
  const b = Math.max(a, Math.min(1, toFrac));
  const out: [number, number][] = [pointAt(pts, a)];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const f = acc / total;
    if (f > a + 1e-9 && f < b - 1e-9) out.push(pts[i]);
  }
  const end = pointAt(pts, b);
  const last = out[out.length - 1];
  if (!last || last[0] !== end[0] || last[1] !== end[1]) out.push(end);
  return out;
}

/**
 * Distance-along-track fractions for S1/S2/S3 from one reference lap:
 * /location samples split by duration_sector_1/2/3 on the clock.
 */
export function sectorDistanceFractions(samples: LocationSample[], lap: Lap): [number, number, number] | null {
  const start = parseTs(lap.date_start);
  const s1 = lap.duration_sector_1;
  const s2 = lap.duration_sector_2;
  const s3 = lap.duration_sector_3;
  if (!Number.isFinite(start) || !s1 || !s2 || !s3) return null;
  const lapMs = (s1 + s2 + s3) * 1000;
  if (lapMs < 40_000) return null;
  const t1 = start + s1 * 1000;
  const t2 = t1 + s2 * 1000;
  const win = lapWindow(lap);
  const from = win ? parseTs(win.from) : start;
  const to = win ? parseTs(win.to) : start + (lap.lap_duration ?? s1 + s2 + s3) * 1000;
  const pts = samples
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y))
    .map((s) => ({ x: s.x, y: s.y, t: parseTs(s.date) }))
    .filter((s) => Number.isFinite(s.t) && s.t >= from && s.t <= to)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 8) return null;
  const span = pts[pts.length - 1].t - pts[0].t;
  if (span < lapMs * 0.6) return null;

  const cum: { t: number; d: number }[] = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    cum.push({ t: pts[i].t, d: dist });
  }
  if (dist <= 0) return null;
  const distAt = (t: number): number => {
    if (t <= cum[0].t) return cum[0].d;
    if (t >= cum[cum.length - 1].t) return cum[cum.length - 1].d;
    for (let i = 1; i < cum.length; i++) {
      if (cum[i].t >= t) {
        const spanT = cum[i].t - cum[i - 1].t;
        const u = spanT === 0 ? 1 : (t - cum[i - 1].t) / spanT;
        return cum[i - 1].d + (cum[i].d - cum[i - 1].d) * u;
      }
    }
    return dist;
  };
  const f1 = distAt(t1) / dist;
  const f2 = Math.max(0, (distAt(t2) - distAt(t1)) / dist);
  const f3 = Math.max(0, 1 - f1 - f2);
  if (f1 < 0.08 || f2 < 0.08 || f3 < 0.08) return null;
  return [f1, f2, f3];
}

export function pickSectorLap(laps: Lap[], drivers: Driver[]): Lap | null {
  return pickOutlineLap(laps.filter((l) => l.driver_number === drivers[0]?.driver_number)) ?? pickOutlineLap(laps);
}

export function sectorFracsFromLocations(
  samples: LocationSample[],
  laps: Lap[],
  drivers: Driver[],
): [number, number, number] | null {
  const preferred = pickSectorLap(laps, drivers);
  if (!preferred) return null;
  const ofDriver = samples.filter((s) => s.driver_number === preferred.driver_number);
  return sectorDistanceFractions(ofDriver.length ? ofDriver : samples, preferred);
}

export function sectorFractions(laps: Lap[]): [number, number, number] {
  const s1: number[] = [];
  const s2: number[] = [];
  const s3: number[] = [];
  for (const lap of laps) {
    if (!lap.duration_sector_1 || !lap.duration_sector_2 || !lap.duration_sector_3) continue;
    if (lap.is_pit_out_lap) continue;
    const tot = lap.duration_sector_1 + lap.duration_sector_2 + lap.duration_sector_3;
    if (tot < 40) continue;
    s1.push(lap.duration_sector_1 / tot);
    s2.push(lap.duration_sector_2 / tot);
    s3.push(lap.duration_sector_3 / tot);
  }
  const med = (xs: number[], fallback: number) => {
    if (!xs.length) return fallback;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return [med(s1, 0.28), med(s2, 0.4), med(s3, 0.32)];
}

export function pickOutlineLap(laps: Lap[]): Lap | null {
  const clean = laps.filter(
    (l) => l.lap_duration && l.lap_duration > 50 && !l.is_pit_out_lap && l.date_start,
  );
  if (!clean.length) return null;
  clean.sort((a, b) => (a.lap_duration ?? 999) - (b.lap_duration ?? 999));
  return clean[Math.min(3, clean.length - 1)];
}

export function lapWindow(lap: Lap): { from: string; to: string } | null {
  const start = parseTs(lap.date_start);
  if (!Number.isFinite(start) || !lap.lap_duration) return null;
  const from = new Date(start - 200).toISOString();
  const to = new Date(start + lap.lap_duration * 1000 + 400).toISOString();
  return { from, to };
}

/** Build a circuit outline from GPS already on the bundle (no extra fetch). */
export function outlineFromLocations(
  samples: LocationSample[],
  laps: Lap[],
  drivers: Driver[],
): [number, number][] {
  if (!samples.length) return [];
  const preferred =
    pickOutlineLap(laps.filter((l) => l.driver_number === drivers[0]?.driver_number)) ?? pickOutlineLap(laps);
  const driverNo = preferred?.driver_number ?? drivers[0]?.driver_number ?? samples[0]?.driver_number;
  if (driverNo == null) return [];
  const ofDriver = samples.filter((s) => s.driver_number === driverNo);
  const win = preferred ? lapWindow(preferred) : null;
  if (win) {
    const from = parseTs(win.from);
    const to = parseTs(win.to);
    const windowed = ofDriver.filter((s) => {
      const t = parseTs(s.date);
      return t >= from && t <= to;
    });
    const pts = buildOutline(windowed);
    if (pts.length >= 2) return pts;
  }
  return buildOutline(ofDriver);
}

export function project(
  pts: [number, number][],
  width: number,
  height: number,
  pad = 28,
): { map: (x: number, y: number) => [number, number]; sx: (x: number, y?: number) => number; sy: (y: number, x?: number) => number } {
  const origin = pts[0] ?? [0, 0];
  const heading = pts.length > 1 ? Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) : 0;
  const rot = -heading;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const rotate = (x: number, y: number): [number, number] => {
    const dx = x - origin[0];
    const dy = y - origin[1];
    return [dx * c - dy * s, dx * s + dy * c];
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    const [rx, ry] = rotate(x, y);
    minX = Math.min(minX, rx);
    minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx);
    maxY = Math.max(maxY, ry);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const ox = (width - spanX * scale) / 2;
  const oy = (height - spanY * scale) / 2;
  const map = (x: number, y: number): [number, number] => {
    const [rx, ry] = rotate(x, y);
    return [ox + (rx - minX) * scale, height - (oy + (ry - minY) * scale)];
  };
  return {
    map,
    sx: (x, y = 0) => map(x, y)[0],
    sy: (y, x = 0) => map(x, y)[1],
  };
}

/**
 * Wind arrow in the same projected frame as the track outline.
 * `windFromDeg` is meteorological (0 = from north, 90 = from east).
 * The arrow points the way the wind is blowing (opposite of FROM).
 * OpenF1 location x/y are treated as east/north.
 */
export function windArrowScreen(
  pts: [number, number][],
  windFromDeg: number,
  width: number,
  height: number,
): { from: [number, number]; to: [number, number] } | null {
  if (pts.length < 2 || !Number.isFinite(windFromDeg)) return null;
  const { map } = project(pts, width, height, 8);
  const rad = (windFromDeg * Math.PI) / 180;
  const toX = -Math.sin(rad);
  const toY = -Math.cos(rad);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let span = 1;
  for (const p of pts) span = Math.max(span, Math.hypot(p[0] - cx, p[1] - cy));
  const len = span * 0.42;
  return {
    from: map(cx - toX * len * 0.5, cy - toY * len * 0.5),
    to: map(cx + toX * len * 0.5, cy + toY * len * 0.5),
  };
}

export function cumulativeDistance(samples: LocationSample[]): { t: number; dist: number; x: number; y: number }[] {
  const out: { t: number; dist: number; x: number; y: number }[] = [];
  let dist = 0;
  let px = 0;
  let py = 0;
  samples.forEach((s, i) => {
    if (i > 0) dist += Math.hypot(s.x - px, s.y - py);
    px = s.x;
    py = s.y;
    out.push({ t: parseTs(s.date), dist, x: s.x, y: s.y });
  });
  return out;
}
