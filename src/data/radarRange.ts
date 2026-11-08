import { latLonToTile } from "./rainViewer";

/** Web Mercator equator, WGS84. */
export const EARTH_EQUATOR_M = 40_075_016.68557849;
export const METERS_PER_MILE = 1609.344;
export const RAINVIEWER_MAX_ZOOM = 7;
export const RADAR_TILES = 3;
/** Extra tile fraction so a view that ends on a boundary still has a neighbour. */
const TILE_PAD = 0.04;
export const RADAR_RANGE_50 = 50;
export const RADAR_RANGE_15 = 15;
export type RadarRangeMi = typeof RADAR_RANGE_50 | typeof RADAR_RANGE_15;
export const RADAR_RANGE_KEY = "f1pitwall.radarRange";

export function metersPerTile(lat: number, z: number): number {
  const c = Math.cos((lat * Math.PI) / 180);
  return (EARTH_EQUATOR_M * Math.abs(c)) / 2 ** z;
}

export function mosaicWidthMiles(lat: number, z = RAINVIEWER_MAX_ZOOM, size = RADAR_TILES): number {
  return (metersPerTile(lat, z) * size) / METERS_PER_MILE;
}

/** CSS scale so a mosaic that fills the panel shows `targetMiles` across. */
export function rangeScale(lat: number, targetMiles: number, z = RAINVIEWER_MAX_ZOOM, size = RADAR_TILES): number {
  const native = mosaicWidthMiles(lat, z, size);
  if (!(native > 0) || !(targetMiles > 0)) return 1;
  return native / targetMiles;
}

export function visibleWidthMiles(lat: number, scale: number, z = RAINVIEWER_MAX_ZOOM, size = RADAR_TILES): number {
  if (!(scale > 0)) return mosaicWidthMiles(lat, z, size);
  return mosaicWidthMiles(lat, z, size) / scale;
}

export function scaleBarMiles(range: RadarRangeMi): number {
  return range === RADAR_RANGE_15 ? 3 : 10;
}

export function parseRadarRange(raw: string | null | undefined): RadarRangeMi {
  return raw === "15" || raw === String(RADAR_RANGE_15) ? RADAR_RANGE_15 : RADAR_RANGE_50;
}

export function readRadarRange(): RadarRangeMi {
  try {
    return parseRadarRange(typeof localStorage !== "undefined" ? localStorage.getItem(RADAR_RANGE_KEY) : null);
  } catch {
    return RADAR_RANGE_50;
  }
}

export function writeRadarRange(mi: RadarRangeMi): void {
  try {
    localStorage.setItem(RADAR_RANGE_KEY, String(mi));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Tiles that fill the panel. pinX/pinY are in tile units from the window origin. */
export type RadarMosaic = {
  z: number;
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  pinX: number;
  pinY: number;
};

/**
 * Smallest tile window that contains the chosen ground range around the circuit.
 * A circuit near a tile edge pulls in the neighbouring tile. The wider 50 mile
 * range is what the player loads, so the 15 mile zoom is a subset of the same grid.
 */
export function radarMosaicFor(lat: number, lon: number, rangeMiles: number, z = RAINVIEWER_MAX_ZOOM): RadarMosaic {
  const t = latLonToTile(lat, lon, z);
  const tileMi = metersPerTile(lat, z) / METERS_PER_MILE;
  const half = rangeMiles / 2 / Math.max(tileMi, 1e-6) + TILE_PAD;
  const x0 = Math.floor(t.x - half);
  const y0 = Math.floor(t.y - half);
  const cols = Math.floor(t.x + half) - x0 + 1;
  const rows = Math.floor(t.y + half) - y0 + 1;
  return { z, x0, y0, cols, rows, pinX: t.x - x0, pinY: t.y - y0 };
}

/** CSS translate that puts the circuit tile point at the centre of the panel. Origin is the top left. */
export function radarZoomTransform(
  panelW: number,
  panelH: number,
  mosaic: Pick<RadarMosaic, "pinX" | "pinY" | "cols" | "rows">,
  scale: number,
): { tx: number; ty: number; scale: number } {
  const w = panelW > 0 ? panelW : 1;
  const h = panelH > 0 ? panelH : 1;
  const pinPx = (mosaic.pinX / mosaic.cols) * w;
  const pinPy = (mosaic.pinY / mosaic.rows) * h;
  return { scale, tx: w / 2 - pinPx * scale, ty: h / 2 - pinPy * scale };
}

/** Screen position of a lat/lon on the stretched grid after the zoom. */
export function radarScreenPoint(
  lat: number,
  lon: number,
  mosaic: RadarMosaic,
  panelW: number,
  panelH: number,
  scale: number,
): { x: number; y: number } {
  const t = latLonToTile(lat, lon, mosaic.z);
  const w = panelW > 0 ? panelW : 1;
  const h = panelH > 0 ? panelH : 1;
  const { tx, ty } = radarZoomTransform(w, h, mosaic, scale);
  const lx = ((t.x - mosaic.x0) / mosaic.cols) * w;
  const ly = ((t.y - mosaic.y0) / mosaic.rows) * h;
  return { x: lx * scale + tx, y: ly * scale + ty };
}

/** Degrees of longitude that cover `miles` of east west ground at this latitude. */
export function milesToLonDelta(lat: number, miles: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  return (miles * METERS_PER_MILE * 360) / (EARTH_EQUATOR_M * Math.max(Math.abs(cos), 1e-6));
}
