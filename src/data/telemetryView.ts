import { clamp } from "../lib/time";

export const TRACE_IDS = ["speed", "throttle", "brake", "gear", "rpm", "drs", "delta"] as const;
export type TraceId = (typeof TRACE_IDS)[number];

export type TracePrefs = {
  visible: Record<TraceId, boolean>;
  overlay: boolean;
};

const STORAGE_KEY = "f1pitwall.telemetryView";

const LABELS: Record<TraceId, string> = {
  speed: "Speed",
  throttle: "Throttle",
  brake: "Brake",
  gear: "Gear",
  rpm: "RPM",
  drs: "DRS",
  delta: "Delta",
};

/** Distinct dash pattern per channel. Color stays with the driver. */
const DASH: Record<TraceId, number[]> = {
  speed: [],
  throttle: [8, 4],
  brake: [2, 3],
  gear: [9, 3, 2, 3],
  rpm: [14, 4],
  drs: [4, 2],
  delta: [1, 3],
};

export type Brush = { start: number; end: number };

export const MIN_BRUSH = 0.02;

export function traceLabel(id: TraceId): string {
  return LABELS[id];
}

export function traceDash(id: TraceId): number[] {
  return DASH[id];
}

export function defaultTracePrefs(): TracePrefs {
  const visible = {} as Record<TraceId, boolean>;
  for (const id of TRACE_IDS) visible[id] = true;
  return { visible, overlay: false };
}

export function visibleTraces(prefs: TracePrefs): TraceId[] {
  return TRACE_IDS.filter((id) => prefs.visible[id]);
}

/** Each remaining channel takes an equal share of the chart height. */
export function laneHeight(totalHeight: number, count: number): number {
  if (count <= 0) return Math.max(0, totalHeight);
  return totalHeight / count;
}

export function resetBrush(): Brush {
  return { start: 0, end: 1 };
}

export function clampBrush(start: number, end: number): Brush {
  let a = clamp(Math.min(start, end), 0, 1);
  let b = clamp(Math.max(start, end), 0, 1);
  if (b - a < MIN_BRUSH) {
    const mid = (a + b) / 2;
    a = clamp(mid - MIN_BRUSH / 2, 0, 1 - MIN_BRUSH);
    b = a + MIN_BRUSH;
  }
  return { start: a, end: b };
}

/**
 * Move a brush from a pointer.
 * `move` keeps the width and slides it along the lap.
 */
export function brushFromPointer(
  mode: "start" | "end" | "move",
  origin: Brush,
  originFrac: number,
  pointerFrac: number,
): Brush {
  if (mode === "start") return clampBrush(pointerFrac, origin.end);
  if (mode === "end") return clampBrush(origin.start, pointerFrac);
  const width = Math.min(1, Math.max(MIN_BRUSH, origin.end - origin.start));
  const delta = pointerFrac - originFrac;
  let start = origin.start + delta;
  let end = start + width;
  if (start < 0) {
    start = 0;
    end = width;
  }
  if (end > 1) {
    end = 1;
    start = 1 - width;
  }
  return { start, end };
}

/** A window centered on a corner, as a fraction of the lap. */
export function cornerWindow(frac: number, half = 0.06): Brush {
  return clampBrush(frac - half, frac + half);
}

/** 0 at the low end of the window, 1 at the high end. A flat channel sits at 0.5. */
export function normalizeTrace(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0.5;
  if (Math.abs(max - min) < 1e-9) return 0.5;
  return (value - min) / (max - min);
}

export function slicePolyline(
  pts: [number, number][],
  startFrac: number,
  endFrac: number,
): [number, number][] {
  if (pts.length < 2) return [];
  const a = clamp(Math.min(startFrac, endFrac), 0, 1);
  const b = clamp(Math.max(startFrac, endFrac), 0, 1);
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  if (total <= 0) return [pts[0]];
  const d0 = a * total;
  const d1 = b * total;
  const out: [number, number][] = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const segStart = acc;
    const segEnd = acc + seg;
    if (segEnd >= d0 && segStart <= d1 && seg > 0) {
      const lerp = (t: number): [number, number] => [
        pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
        pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
      ];
      if (!out.length) out.push(lerp(clamp((d0 - segStart) / seg, 0, 1)));
      if (segEnd <= d1 + 1e-6) out.push(pts[i]);
      else {
        out.push(lerp(clamp((d1 - segStart) / seg, 0, 1)));
        break;
      }
    }
    acc = segEnd;
  }
  return out;
}

function sanitizePrefs(raw: Partial<TracePrefs> | null | undefined): TracePrefs {
  const base = defaultTracePrefs();
  if (!raw || typeof raw !== "object") return base;
  for (const id of TRACE_IDS) {
    if (typeof raw.visible?.[id] === "boolean") base.visible[id] = raw.visible[id];
  }
  base.overlay = !!raw.overlay;
  return base;
}

export function readTracePrefs(): TracePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTracePrefs();
    return sanitizePrefs(JSON.parse(raw) as Partial<TracePrefs>);
  } catch {
    return defaultTracePrefs();
  }
}

export function writeTracePrefs(prefs: TracePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizePrefs(prefs)));
  } catch {
    /* private mode */
  }
}
