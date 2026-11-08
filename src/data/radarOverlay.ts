import { teamColor } from "../lib/colors";
import { bracketIndexed, indexLocations } from "./carLocation";
import { geoCircuitFor, lngLatToMetres, metresToLngLat } from "./geoCircuit";
import { applySimilarity, describeFit, fitIsUsable, fitTrackToMetres } from "./trackFit";
import type { SessionBundle } from "./types";

export type RadarCar = { n: number; lat: number; lon: number; color: string; code: string };
export type RadarOverlay = {
  outline: [number, number][];
  cars: RadarCar[];
  fitLabel: string;
  note?: string | null;
};

export const NO_GEO_NOTE = "No geographic outline for this circuit — radar only.";
export const NO_TRACK_NOTE = "No OpenF1 track outline to georeference — radar only.";

export function withheldNote(rmsM: number | null): string {
  const rms = rmsM != null && Number.isFinite(rmsM) ? rmsM.toFixed(1) : "—";
  return `Track overlay withheld — outline fit RMS ${rms} m is too high.`;
}

/** GeoJSON outline + live cars mapped through the cached OpenF1→metres similarity. */
export function liveRadarOverlay(
  bundle: SessionBundle | null | undefined,
  now: number,
): { overlay: RadarOverlay | null; note: string | null } {
  if (!bundle) return { overlay: null, note: null };
  const geo = geoCircuitFor(bundle.session, bundle.meeting);
  if (!geo) return { overlay: null, note: NO_GEO_NOTE };
  const track = bundle.track ?? [];
  if (track.length < 8) return { overlay: null, note: NO_TRACK_NOTE };
  const metres = lngLatToMetres(geo.lngLat, geo.lat0, geo.lon0);
  const fit = fitTrackToMetres(geo.location, track, metres);
  if (!fit || !fitIsUsable(fit)) return { overlay: null, note: withheldNote(fit?.rmsM ?? null) };
  const locIndex = indexLocations(bundle.locations);
  const cars: RadarCar[] = [];
  for (const d of bundle.drivers ?? []) {
    const br = bracketIndexed(locIndex.get(d.driver_number), now);
    if (!br) continue;
    const x = br.prev.x + (br.next.x - br.prev.x) * br.u;
    const y = br.prev.y + (br.next.y - br.prev.y) * br.u;
    const [east, north] = applySimilarity(fit, x, y);
    const [lon, lat] = metresToLngLat(east, north, geo.lat0, geo.lon0);
    cars.push({
      n: d.driver_number,
      lat,
      lon,
      color: teamColor(d.team_colour),
      code: d.name_acronym,
    });
  }
  return {
    overlay: {
      outline: geo.lngLat,
      cars,
      fitLabel: describeFit(fit),
    },
    note: null,
  };
}
