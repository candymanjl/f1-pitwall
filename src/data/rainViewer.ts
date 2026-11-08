export const RAINVIEWER_CATALOG = "https://api.rainviewer.com/public/weather-maps.json";
export const RAINVIEWER_CREDIT = "RainViewer";
export const RAINVIEWER_HOME = "https://www.rainviewer.com/";
/** Regional view only — RainViewer public tiles max out at zoom 7. */
export const RAINVIEWER_ZOOM = 6;

export type RainViewerFrame = {
  time: number;
  path: string;
  host: string;
};

type Catalog = {
  host?: string;
  radar?: { past?: Array<{ time: number; path: string }> };
};

export function parseRainViewerCatalog(json: Catalog): RainViewerFrame[] {
  const host = (json.host ?? "https://tilecache.rainviewer.com").replace(/\/$/, "");
  return (json.radar?.past ?? [])
    .filter((row) => Number.isFinite(row.time) && row.path)
    .map((row) => ({ time: row.time, path: row.path, host }));
}

export function rainViewerTileUrl(frame: RainViewerFrame, z: number, x: number, y: number): string {
  const zc = Math.max(0, Math.min(7, Math.floor(z)));
  return `${frame.host}${frame.path}/256/${zc}/${x}/${y}/2/1_1.png`;
}

export function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function radarTileWindow(lat: number, lon: number, z = RAINVIEWER_ZOOM, size = 3): { z: number; x0: number; y0: number; size: number; pinX: number; pinY: number } {
  const t = latLonToTile(lat, lon, z);
  const half = Math.floor(size / 2);
  const x0 = Math.floor(t.x) - half;
  const y0 = Math.floor(t.y) - half;
  return { z, x0, y0, size, pinX: t.x - x0, pinY: t.y - y0 };
}

export async function fetchRainViewerCatalog(fetchImpl: typeof fetch = fetch): Promise<RainViewerFrame[]> {
  const res = await fetchImpl(RAINVIEWER_CATALOG);
  if (!res.ok) throw new Error(`RainViewer catalog ${res.status}`);
  return parseRainViewerCatalog((await res.json()) as Catalog);
}
