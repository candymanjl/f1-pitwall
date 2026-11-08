export const OPEN_METEO_CREDIT = "Open-Meteo (CC BY 4.0)";
export const OPEN_METEO_HOME = "https://open-meteo.com/";

export type ForecastHour = { t: number; prob: number | null };
export type ArchiveHour = { t: number; precipMm: number | null; cloud: number | null; wind: number | null };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDateUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "precipitation_probability",
    forecast_days: "2",
    timezone: "UTC",
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

export function archiveUrl(lat: number, lon: number, startMs: number, endMs: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: isoDateUtc(startMs),
    end_date: isoDateUtc(Math.max(startMs, endMs)),
    hourly: "precipitation,cloud_cover,wind_speed_10m",
    timezone: "UTC",
  });
  return `https://archive-api.open-meteo.com/v1/archive?${q.toString()}`;
}

type Hourly = { time?: string[]; precipitation_probability?: number[]; precipitation?: number[]; cloud_cover?: number[]; wind_speed_10m?: number[] };

function parseTimes(times: string[] | undefined): number[] {
  return (times ?? []).map((row) => Date.parse(row.endsWith("Z") ? row : `${row}Z`));
}

export function parseForecast(json: { hourly?: Hourly }): ForecastHour[] {
  const times = parseTimes(json.hourly?.time);
  const probs = json.hourly?.precipitation_probability ?? [];
  return times.map((t, i) => ({ t, prob: Number.isFinite(probs[i]) ? probs[i] : null }));
}

export function parseArchive(json: { hourly?: Hourly }): ArchiveHour[] {
  const times = parseTimes(json.hourly?.time);
  const precip = json.hourly?.precipitation ?? [];
  const cloud = json.hourly?.cloud_cover ?? [];
  const wind = json.hourly?.wind_speed_10m ?? [];
  return times.map((t, i) => ({
    t,
    precipMm: Number.isFinite(precip[i]) ? precip[i] : null,
    cloud: Number.isFinite(cloud[i]) ? cloud[i] : null,
    wind: Number.isFinite(wind[i]) ? wind[i] : null,
  }));
}

export function upcomingForecast(hours: ForecastHour[], now: number, count = 8): ForecastHour[] {
  const from = hours.filter((h) => h.t >= now - 30 * 60_000);
  return from.slice(0, count);
}

export async function fetchForecast(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<ForecastHour[]> {
  const res = await fetchImpl(forecastUrl(lat, lon));
  if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`);
  return parseForecast((await res.json()) as { hourly?: Hourly });
}

export async function fetchArchive(
  lat: number,
  lon: number,
  startMs: number,
  endMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ArchiveHour[]> {
  const res = await fetchImpl(archiveUrl(lat, lon, startMs, endMs));
  if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}`);
  return parseArchive((await res.json()) as { hourly?: Hourly });
}
