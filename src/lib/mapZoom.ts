/** How much of the full map a follow window covers (3× = a third of the view). */
export const MAP_FOLLOW_ZOOM = 3;

export function followViewBox(
  cx: number,
  cy: number,
  fullW: number,
  fullH: number,
  zoom = MAP_FOLLOW_ZOOM,
): { x: number; y: number; w: number; h: number } {
  const z = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  const w = fullW / z;
  const h = fullH / z;
  const x = Math.min(Math.max(0, cx - w / 2), Math.max(0, fullW - w));
  const y = Math.min(Math.max(0, cy - h / 2), Math.max(0, fullH - h));
  return { x, y, w, h };
}
