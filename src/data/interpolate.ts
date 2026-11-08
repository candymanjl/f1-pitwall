/** Fritsch–Carlson monotone cubic Hermite slopes. */
function monotoneSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const delta: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    delta[i] = dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx;
  }
  if (n === 1) return m;
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] === 0 || delta[i] === 0 || Math.sign(delta[i - 1]) !== Math.sign(delta[i])) m[i] = 0;
    else m[i] = (delta[i - 1] + delta[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / delta[i];
    const b = m[i + 1] / delta[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * delta[i];
      m[i + 1] = t * b * delta[i];
    }
  }
  return m;
}

function hermite(x: number, x0: number, y0: number, m0: number, x1: number, y1: number, m1: number): number {
  const h = x1 - x0;
  if (h === 0) return y0;
  const s = (x - x0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * y0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * y1 + (s3 - s2) * h * m1;
}

export function interpolateMonotone(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (!n) return 0;
  if (n === 1 || x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const m = monotoneSlopes(xs, ys);
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  return hermite(x, xs[i], ys[i], m[i], xs[i + 1], ys[i + 1], m[i + 1]);
}
