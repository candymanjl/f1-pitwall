import { polylineLength, project, slicePolyline } from "./track";

export type WindKind = "HEADWIND" | "TAILWIND" | "CROSSWIND";

export type DerivedWind = {
  label: string;
  kind: WindKind;
  speed: number;
};

function wrap180(deg: number): number {
  let d = ((deg + 180) % 360) + 360;
  d = d % 360;
  return d - 180;
}

/** Travel heading in degrees, 0 = north, 90 = east, assuming OpenF1 X=east Y=north. */
export function travelHeadingDeg(pts: [number, number][]): number | null {
  if (pts.length < 2) return null;
  let dx = 0;
  let dy = 0;
  for (let i = 1; i < pts.length; i++) {
    dx += pts[i][0] - pts[i - 1][0];
    dy += pts[i][1] - pts[i - 1][1];
  }
  if (dx === 0 && dy === 0) return null;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function windComponent(windFromDeg: number, travelDeg: number, speed: number): { kind: WindKind; speed: number } {
  const windTo = windFromDeg + 180;
  const rel = wrap180(windTo - travelDeg);
  const rad = (rel * Math.PI) / 180;
  const along = Math.cos(rad) * speed;
  const across = Math.abs(Math.sin(rad) * speed);
  if (Math.abs(along) >= across) {
    return { kind: along >= 0 ? "TAILWIND" : "HEADWIND", speed: Math.abs(along) };
  }
  return { kind: "CROSSWIND", speed: across };
}

/**
 * Three named stretches from the racing-line polyline.
 * Headings assume OpenF1 X/Y are east/north — same as windArrowScreen.
 */
export function derivedStraightWinds(
  pts: [number, number][],
  windFromDeg: number,
  speed: number,
  sectorFracs?: [number, number, number] | null,
): DerivedWind[] {
  if (pts.length < 2 || !Number.isFinite(windFromDeg) || !Number.isFinite(speed)) return [];
  const s1 = Math.max(0.08, Math.min(0.45, sectorFracs?.[0] ?? 0.3));
  const slices: { label: string; from: number; to: number }[] = [
    { label: "Main straight", from: 0, to: 0.08 },
    { label: "Back straight", from: 0.45, to: 0.58 },
    { label: "Sector 2 approach", from: Math.max(0.12, s1 - 0.06), to: s1 + 0.02 },
  ];
  return slices.flatMap((slice) => {
    const seg = slicePolyline(pts, slice.from, slice.to);
    const heading = travelHeadingDeg(seg);
    if (heading == null) return [];
    const hit = windComponent(windFromDeg, heading, speed);
    return [{ label: slice.label, kind: hit.kind, speed: hit.speed }];
  });
}

/** Screen vector toward geographic north under the X=east Y=north assumption. */
export function geoNorthScreen(
  pts: [number, number][],
  width: number,
  height: number,
): { from: [number, number]; to: [number, number] } | null {
  if (pts.length < 2) return null;
  const { map } = project(pts, width, height, 28);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const span = polylineLength(pts) * 0.04;
  return { from: map(cx, cy), to: map(cx, cy + span) };
}
