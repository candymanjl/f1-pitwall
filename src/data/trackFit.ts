import { pointAt, polylineLength } from "./track";

export const FIT_SAMPLE_N = 72;
export const FIT_MAX_RMS_M = 120;

export type Similarity2D = {
  scale: number;
  theta: number;
  tx: number;
  ty: number;
  flipX: boolean;
  rmsM: number;
  n: number;
};

export type TrackFit = Similarity2D & {
  lengthM: number;
};

function dropClose(pts: [number, number][]): [number, number][] {
  if (pts.length < 2) return pts.slice();
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - out[out.length - 1][0];
    const dy = pts[i][1] - out[out.length - 1][1];
    if (dx * dx + dy * dy > 1e-6) out.push(pts[i]);
  }
  if (out.length > 2) {
    const dx = out[0][0] - out[out.length - 1][0];
    const dy = out[0][1] - out[out.length - 1][1];
    if (dx * dx + dy * dy < 1e-6) out.pop();
  }
  return out;
}

export function resampleClosed(pts: [number, number][], n = FIT_SAMPLE_N): [number, number][] {
  const clean = dropClose(pts);
  if (clean.length < 3 || n < 3) return clean;
  const loop: [number, number][] = [...clean, clean[0]];
  const total = polylineLength(loop);
  if (total <= 0) return clean.slice(0, n);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push(pointAt(loop, i / n));
  return out;
}

function centroid(pts: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  const n = Math.max(1, pts.length);
  return [x / n, y / n];
}

function shift<T>(pts: T[], offset: number): T[] {
  const n = pts.length;
  const k = ((offset % n) + n) % n;
  if (k === 0) return pts;
  return pts.slice(k).concat(pts.slice(0, k));
}

function reversePts(pts: [number, number][]): [number, number][] {
  return pts.slice().reverse();
}

function flipXPts(pts: [number, number][]): [number, number][] {
  return pts.map(([x, y]) => [-x, y]);
}

/** 2D similarity (rotation, uniform scale, translation) via complex Procrustes. */
export function procrustes(src: [number, number][], dst: [number, number][]): Omit<Similarity2D, "flipX" | "rmsM"> & { rmsM: number } {
  const n = Math.min(src.length, dst.length);
  const cs = centroid(src.slice(0, n));
  const cd = centroid(dst.slice(0, n));
  let num = 0;
  let den = 0;
  let srcVar = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i][0] - cs[0];
    const ay = src[i][1] - cs[1];
    const bx = dst[i][0] - cd[0];
    const by = dst[i][1] - cd[1];
    den += ax * bx + ay * by;
    num += ax * by - ay * bx;
    srcVar += ax * ax + ay * ay;
  }
  const theta = Math.atan2(num, den);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[i][0] - cs[0];
    const ay = src[i][1] - cs[1];
    const bx = dst[i][0] - cd[0];
    const by = dst[i][1] - cd[1];
    dot += (c * ax - s * ay) * bx + (s * ax + c * ay) * by;
  }
  const scale = srcVar > 0 ? dot / srcVar : 1;
  const tx = cd[0] - scale * (c * cs[0] - s * cs[1]);
  const ty = cd[1] - scale * (s * cs[0] + c * cs[1]);
  let err = 0;
  for (let i = 0; i < n; i++) {
    const x = scale * (c * src[i][0] - s * src[i][1]) + tx;
    const y = scale * (s * src[i][0] + c * src[i][1]) + ty;
    err += (x - dst[i][0]) ** 2 + (y - dst[i][1]) ** 2;
  }
  return { scale, theta, tx, ty, n, rmsM: Math.sqrt(err / n) };
}

export function applySimilarity(fit: Pick<Similarity2D, "scale" | "theta" | "tx" | "ty" | "flipX">, x: number, y: number): [number, number] {
  const px = fit.flipX ? -x : x;
  const c = Math.cos(fit.theta);
  const s = Math.sin(fit.theta);
  return [fit.scale * (c * px - s * y) + fit.tx, fit.scale * (s * px + c * y) + fit.ty];
}

export function fitSimilarity(
  srcPts: [number, number][],
  dstPts: [number, number][],
  n = FIT_SAMPLE_N,
): Similarity2D | null {
  const src = resampleClosed(srcPts, n);
  const dst = resampleClosed(dstPts, n);
  if (src.length < 8 || dst.length < 8 || src.length !== dst.length) return null;
  let best: Similarity2D | null = null;
  for (const flip of [false, true]) {
    const flipped = flip ? flipXPts(src) : src;
    for (const rev of [false, true]) {
      const oriented = rev ? reversePts(flipped) : flipped;
      for (let offset = 0; offset < n; offset++) {
        const shifted = shift(oriented, offset);
        const fit = procrustes(shifted, dst);
        if (!best || fit.rmsM < best.rmsM) best = { ...fit, flipX: flip };
      }
    }
  }
  return best;
}

const cache = new Map<string, TrackFit | null>();

function keyFor(circuit: string, src: [number, number][], dst: [number, number][]): string {
  const a = src[0];
  const b = src[Math.floor(src.length / 2)] ?? a;
  const c = dst[0];
  return `${circuit}|${src.length}|${a[0].toFixed(1)},${a[1].toFixed(1)}|${b[0].toFixed(1)},${b[1].toFixed(1)}|${dst.length}|${c[0].toFixed(4)},${c[1].toFixed(4)}`;
}

export function fitTrackToMetres(
  circuit: string,
  openf1Xy: [number, number][],
  geoMetres: [number, number][],
): TrackFit | null {
  const key = keyFor(circuit, openf1Xy, geoMetres);
  if (cache.has(key)) return cache.get(key) ?? null;
  const sim = fitSimilarity(openf1Xy, geoMetres);
  const fitted = sim ? { ...sim, lengthM: polylineLength(dropClose(geoMetres).concat([geoMetres[0]])) } : null;
  cache.set(key, fitted);
  return fitted;
}

export function fitIsUsable(fit: TrackFit | null | undefined): boolean {
  return !!fit && Number.isFinite(fit.rmsM) && fit.rmsM <= FIT_MAX_RMS_M && fit.scale > 0;
}

export function describeFit(fit: TrackFit): string {
  const deg = (fit.theta * 180) / Math.PI;
  const rot = `${deg >= 0 ? "+" : ""}${deg.toFixed(1)}°`;
  return `Fit RMS ${fit.rmsM.toFixed(1)} m · rot ${rot} · scale ${fit.scale.toFixed(3)} · ${fit.flipX ? "mirrored" : "not mirrored"}`;
}

export function resetTrackFitCache(): void {
  cache.clear();
}
