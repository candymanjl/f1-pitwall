import type { Meeting, Session } from "./types";

export type CircuitCoord = {
  lat: number;
  lon: number;
  name: string;
  /** NEXRAD coverage — Austin, Miami, Las Vegas only. */
  usNexrad: boolean;
};

type CircuitEntry = CircuitCoord & {
  keys?: number[];
  names: string[];
  locations?: string[];
};

function norm(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Published circuit coordinates for radar / Open-Meteo.
 * Keys are optional OpenF1 `circuit_key` values when known.
 */
const CIRCUITS: CircuitEntry[] = [
  { name: "Melbourne", lat: -37.8497, lon: 144.968, names: ["melbourne", "albert park"], locations: ["melbourne"], usNexrad: false },
  { name: "Shanghai", lat: 31.3389, lon: 121.22, names: ["shanghai"], locations: ["shanghai"], usNexrad: false },
  { name: "Suzuka", lat: 34.8431, lon: 136.541, names: ["suzuka"], locations: ["suzuka"], usNexrad: false },
  { name: "Bahrain", lat: 26.0325, lon: 50.5106, names: ["sakhir", "bahrain"], locations: ["sakhir"], usNexrad: false },
  { name: "Jeddah", lat: 21.6319, lon: 39.1044, names: ["jeddah"], locations: ["jeddah"], usNexrad: false },
  { name: "Miami", lat: 25.9581, lon: -80.2389, names: ["miami"], locations: ["miami"], usNexrad: true },
  { name: "Imola", lat: 44.3439, lon: 11.7167, names: ["imola"], locations: ["imola"], usNexrad: false },
  { name: "Monaco", lat: 43.7347, lon: 7.4206, names: ["monaco", "monte carlo"], locations: ["monte carlo", "monaco"], usNexrad: false },
  { name: "Barcelona", lat: 41.57, lon: 2.2611, names: ["barcelona", "catalunya"], locations: ["barcelona", "montmelo"], usNexrad: false },
  { name: "Montreal", lat: 45.5006, lon: -73.5228, names: ["montreal", "gilles villeneuve"], locations: ["montreal"], usNexrad: false },
  { name: "Spielberg", lat: 47.2197, lon: 14.7647, names: ["spielberg", "red bull ring"], locations: ["spielberg"], usNexrad: false },
  { name: "Silverstone", lat: 52.0786, lon: -1.0169, names: ["silverstone"], locations: ["silverstone"], usNexrad: false },
  { name: "Spa-Francorchamps", lat: 50.4372, lon: 5.9714, names: ["spa", "spa francorchamps"], locations: ["spa"], usNexrad: false },
  { name: "Hungaroring", lat: 47.5789, lon: 19.2486, names: ["hungaroring", "budapest"], locations: ["budapest"], usNexrad: false },
  { name: "Zandvoort", lat: 52.3888, lon: 4.5409, names: ["zandvoort"], locations: ["zandvoort"], usNexrad: false },
  { name: "Monza", lat: 45.6156, lon: 9.2811, names: ["monza"], locations: ["monza"], usNexrad: false },
  { name: "Baku", lat: 40.3725, lon: 49.8533, names: ["baku"], locations: ["baku"], usNexrad: false },
  { name: "Singapore", lat: 1.2914, lon: 103.864, names: ["singapore", "marina bay"], locations: ["marina bay", "singapore"], usNexrad: false },
  { name: "Austin", lat: 30.1328, lon: -97.6411, names: ["austin", "cota", "americas", "circuit of the americas"], locations: ["austin"], usNexrad: true },
  { name: "Mexico City", lat: 19.4042, lon: -99.0907, names: ["mexico city", "hermanos rodriguez"], locations: ["mexico city", "mexico"], usNexrad: false },
  { name: "Interlagos", lat: -23.7036, lon: -46.6997, keys: [14], names: ["interlagos", "sao paulo"], locations: ["sao paulo", "são paulo"], usNexrad: false },
  { name: "Las Vegas", lat: 36.1147, lon: -115.173, names: ["las vegas"], locations: ["las vegas"], usNexrad: true },
  { name: "Lusail", lat: 25.49, lon: 51.4542, names: ["lusail", "losail", "qatar"], locations: ["lusail"], usNexrad: false },
  { name: "Yas Marina", lat: 24.4672, lon: 54.6031, names: ["yas marina", "abu dhabi"], locations: ["yas island", "abu dhabi"], usNexrad: false },
];

export function circuitCoord(
  session?: Pick<Session, "circuit_key" | "circuit_short_name" | "location" | "country_name"> | null,
  meeting?: Pick<Meeting, "circuit_key" | "circuit_short_name" | "location"> | null,
): CircuitCoord | null {
  const key = session?.circuit_key ?? meeting?.circuit_key;
  if (key != null && Number.isFinite(key)) {
    const byKey = CIRCUITS.find((row) => row.keys?.includes(key));
    if (byKey) return byKey;
  }
  const names = [session?.circuit_short_name, meeting?.circuit_short_name, session?.location, meeting?.location].map(norm).filter(Boolean);
  for (const row of CIRCUITS) {
    const aliases = [...row.names, ...(row.locations ?? [])].map(norm);
    if (names.some((n) => aliases.some((a) => n === a || n.includes(a) || a.includes(n)))) return row;
  }
  return null;
}

export function hasIemRadar(
  session?: Pick<Session, "circuit_key" | "circuit_short_name" | "location" | "country_name"> | null,
  meeting?: Pick<Meeting, "circuit_key" | "circuit_short_name" | "location"> | null,
): boolean {
  return circuitCoord(session, meeting)?.usNexrad === true;
}
