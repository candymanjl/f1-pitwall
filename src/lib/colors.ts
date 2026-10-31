import type { SectorKind } from "../data/types";

export const TYRE: Record<string, string> = {
  SOFT: "#e10600",
  MEDIUM: "#f4d20c",
  HARD: "#f2f2f2",
  INTERMEDIATE: "#43b02a",
  WET: "#0072de",
  UNKNOWN: "#6b7280",
};

export const SEGMENT: Record<number, string> = {
  0: "#1f2430",
  2048: "#eab308",
  2049: "#22c55e",
  2051: "#c084fc",
  2064: "#9ca3af",
};

export function teamColor(hex: string | undefined): string {
  if (!hex) return "#94a3b8";
  return hex.startsWith("#") ? hex : `#${hex}`;
}

export function tyreColor(compound: string | null | undefined): string {
  return TYRE[(compound ?? "").toUpperCase()] ?? TYRE.UNKNOWN;
}

export function segmentColor(code: number | null | undefined): string {
  if (code == null) return SEGMENT[0];
  return SEGMENT[code] ?? SEGMENT[0];
}

export function sectorColor(kind: SectorKind): string {
  if (kind === "overall") return "#c084fc";
  if (kind === "personal") return "#22c55e";
  if (kind === "yellow") return "#eab308";
  return "#64748b";
}

export const TRACE = ["#e10600", "#f97316", "#38bdf8", "#a3e635", "#c084fc", "#f472b6", "#facc15", "#2dd4bf"];
