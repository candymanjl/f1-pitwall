/** Web Mercator equator, WGS84. */
export const EARTH_EQUATOR_M = 40_075_016.68557849;
export const METERS_PER_MILE = 1609.344;
export const RAINVIEWER_MAX_ZOOM = 7;
export const RADAR_TILES = 3;
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
