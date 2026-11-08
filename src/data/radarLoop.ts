export const RADAR_FRAME_MS = 500;
export const RADAR_HOLD_MS = 1500;
export const IEM_LOOP_WINDOW_MS = 60 * 60_000;

export type RadarSpeed = 1 | 2;

export function frameDelayMs(index: number, count: number, speed: RadarSpeed): number {
  if (count <= 1) return Math.round(RADAR_HOLD_MS / Math.max(1, speed));
  const last = index >= count - 1;
  return Math.round((last ? RADAR_HOLD_MS : RADAR_FRAME_MS) / speed);
}

export function nextRadarIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index + 1) % count;
}

export function playStartIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  if (current >= count - 1) return 0;
  return Math.max(0, Math.min(count - 1, current));
}

export function nearestRadarIndex(times: number[], want: number): number {
  if (!times.length) return 0;
  let best = times.length - 1;
  let dist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i] - want);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

export function formatRadarTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mo}-${da} ${hh}:${mm} UTC`;
}
