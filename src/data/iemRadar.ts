import { IEM_LOOP_WINDOW_MS } from "./radarLoop";

export const IEM_CREDIT = "IEM / NOAA";
export const IEM_HOME = "https://mesonet.agron.iastate.edu/";
export const IEM_STEP_MS = 5 * 60_000;

const SPAN_DEG = 1.15;

export function roundToRadarStep(ms: number): number {
  return Math.floor(ms / IEM_STEP_MS) * IEM_STEP_MS;
}

/** Past hour of 5-minute NEXRAD frames, never after the replay playhead. */
export function iemLoopTimes(playheadMs: number, windowMs = IEM_LOOP_WINDOW_MS): number[] {
  const end = roundToRadarStep(playheadMs);
  const start = roundToRadarStep(playheadMs - windowMs);
  const out: number[] = [];
  for (let t = start; t <= end; t += IEM_STEP_MS) {
    if (t <= playheadMs) out.push(t);
  }
  if (!out.length) out.push(end);
  return out;
}

export function iemWmsUrl(lat: number, lon: number, whenMs: number, size = 512): string {
  const t = roundToRadarStep(whenMs);
  const iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  const q = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: "nexrad-n0q-wmst",
    styles: "",
    format: "image/png",
    transparent: "true",
    srs: "EPSG:4326",
    bbox: `${(lon - SPAN_DEG).toFixed(4)},${(lat - SPAN_DEG).toFixed(4)},${(lon + SPAN_DEG).toFixed(4)},${(lat + SPAN_DEG).toFixed(4)}`,
    width: String(size),
    height: String(size),
    time: iso,
  });
  return `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?${q.toString()}`;
}
