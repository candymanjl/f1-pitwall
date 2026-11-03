import { slicePolyline } from "../data/track";

/** Track-map sector strokes: S1 red, S2 yellow, S3 blue. */
export const SECTOR_STROKES = ["#e10600", "#eab308", "#3b82f6"] as const;

export function pathD(
  pts: [number, number][],
  map: (x: number, y: number) => [number, number],
): string {
  return pts
    .map((p, i) => {
      const [px, py] = map(p[0], p[1]);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
}

export function sectorCuts(fracs: [number, number, number] | undefined | null): [number, number, number, number] {
  const f1 = Math.max(0.05, Math.min(0.9, fracs?.[0] ?? 0.28));
  const f2 = Math.max(0.05, Math.min(0.9 - f1, fracs?.[1] ?? 0.4));
  return [0, f1, Math.min(0.98, f1 + f2), 1];
}

export function appendSectorOutline(
  parent: SVGElement,
  pts: [number, number][],
  map: (x: number, y: number) => [number, number],
  fracs: [number, number, number] | undefined | null,
  opts: { width: number; className?: string },
): SVGPathElement[] {
  const cuts = sectorCuts(fracs);
  const paths: SVGPathElement[] = [];
  for (let i = 0; i < 3; i++) {
    const seg = slicePolyline(pts, cuts[i], cuts[i + 1]);
    if (seg.length < 2) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", [opts.className, `track-s${i + 1}`].filter(Boolean).join(" "));
    path.setAttribute("data-sector", String(i + 1));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", SECTOR_STROKES[i]);
    path.setAttribute("stroke-width", String(opts.width));
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("d", pathD(seg, map));
    parent.append(path);
    paths.push(path);
  }
  return paths;
}
