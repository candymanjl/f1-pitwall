export function parseTs(value: string | null | undefined): number {
  if (!value) return NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function formatLap(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

export function formatSector(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return seconds.toFixed(3);
  return formatLap(seconds);
}

export function formatDelta(seconds: number | string | null | undefined, leader = false): string {
  if (leader) return "LEADER";
  if (seconds == null) return "—";
  if (typeof seconds === "string") {
    if (/lap/i.test(seconds)) return seconds.replace(/\s+/g, " ").toUpperCase();
    const n = Number(seconds);
    if (!Number.isFinite(n)) return seconds;
    return formatDelta(n);
  }
  const sign = seconds >= 0 ? "+" : "−";
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTimeOfDay(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().slice(11, 19);
}

export function latestBefore<T>(rows: T[], t: number, getT: (row: T) => number): T | null {
  if (!rows.length) return null;
  let lo = 0;
  let hi = rows.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const mt = getT(rows[mid]);
    if (mt <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? rows[best] : null;
}

export function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function linReg(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / den;
  return { slope, intercept: (sy - slope * sx) / n };
}

export function groupBy<T, K extends string | number>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function asNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (/lap/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
