import { circuitCoord } from "./circuitCoords";
import raw from "./f1Circuits.json";
import { latLonToTile } from "./rainViewer";
import type { Meeting, Session } from "./types";

/** Bundled copy of https://github.com/bacinger/f1-circuits (MIT). */
export const F1_CIRCUITS_CREDIT = "bacinger/f1-circuits (MIT)";
export const F1_CIRCUITS_HOME = "https://github.com/bacinger/f1-circuits";

export type GeoCircuit = {
  id: string;
  location: string;
  name: string;
  lngLat: [number, number][];
  lat0: number;
  lon0: number;
};

function norm(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function featureToCircuit(feat: (typeof raw)["features"][number]): GeoCircuit | null {
  const coords = feat.geometry?.coordinates;
  if (!coords || coords.length < 8) return null;
  const lngLat = coords.map((c) => [c[0], c[1]] as [number, number]);
  let lat0 = 0;
  let lon0 = 0;
  for (const [lon, lat] of lngLat) {
    lon0 += lon;
    lat0 += lat;
  }
  lat0 /= lngLat.length;
  lon0 /= lngLat.length;
  return {
    id: String(feat.properties?.id ?? feat.properties?.Location ?? ""),
    location: feat.properties?.Location ?? "",
    name: feat.properties?.Name ?? "",
    lngLat,
    lat0,
    lon0,
  };
}

const CIRCUITS: GeoCircuit[] = raw.features.map(featureToCircuit).filter((row): row is GeoCircuit => !!row);

export function metresPerDegree(lat0: number): { mLat: number; mLon: number } {
  const mLat = 110_540;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  return { mLat, mLon };
}

export function lngLatToMetres(lngLat: [number, number][], lat0: number, lon0: number): [number, number][] {
  const { mLat, mLon } = metresPerDegree(lat0);
  return lngLat.map(([lon, lat]) => [(lon - lon0) * mLon, (lat - lat0) * mLat]);
}

export function metresToLngLat(east: number, north: number, lat0: number, lon0: number): [number, number] {
  const { mLat, mLon } = metresPerDegree(lat0);
  return [lon0 + east / mLon, lat0 + north / mLat];
}

export function geoCircuitFor(
  session?: Pick<Session, "circuit_key" | "circuit_short_name" | "location" | "country_name"> | null,
  meeting?: Pick<Meeting, "circuit_key" | "circuit_short_name" | "location"> | null,
): GeoCircuit | null {
  const coord = circuitCoord(session, meeting);
  const needles = [
    coord?.name,
    session?.circuit_short_name,
    session?.location,
    meeting?.circuit_short_name,
    meeting?.location,
  ]
    .map(norm)
    .filter(Boolean);
  if (!needles.length) return null;
  for (const row of CIRCUITS) {
    const aliases = [row.location, row.name, row.id].map(norm);
    if (needles.some((n) => aliases.some((a) => n === a || n.includes(a) || a.includes(n)))) return row;
  }
  return null;
}

export type TileWindow = { z: number; x0: number; y0: number; size: number };

export function lngLatToMosaicPct(lat: number, lon: number, win: TileWindow): { x: number; y: number } {
  const t = latLonToTile(lat, lon, win.z);
  return {
    x: ((t.x - win.x0) / win.size) * 100,
    y: ((t.y - win.y0) / win.size) * 100,
  };
}
