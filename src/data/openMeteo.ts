import { interpolateMonotone } from "./interpolate";

export const OPEN_METEO_CREDIT = "Open-Meteo (CC BY 4.0)";
export const OPEN_METEO_HOME = "https://open-meteo.com/";
export const MINUTELY_NOTE =
  "Estimated 1 minute line, interpolated from Open-Meteo 15 minute forecast. Model data, not radar.";

export type ForecastHour = { t: number; prob: number | null };
export type MinutelySample = { t: number; precipMm: number | null; prob: number | null };
export type MinutePoint = { t: number; precipMm: number; prob: number };
export type ForecastPack = { hourly: ForecastHour[]; minutely: MinutelySample[] };
export type ArchiveHour = { t: number; precipMm: number | null; cloud: number | null; wind: number | null };

const MINUTE_MS = 60_000;

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
    minutely_15: "precipitation,precipitation_probability",
    forecast_days: "2",
    forecast_minutely_15: "8",
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

type Series = {
  time?: string[];
  precipitation_probability?: number[];
  precipitation?: number[];
  cloud_cover?: number[];
  wind_speed_10m?: number[];
};

function parseTimes(times: string[] | undefined): number[] {
  return (times ?? []).map((row) => Date.parse(row.endsWith("Z") ? row : `${row}Z`));
}

export function parseForecast(json: { hourly?: Series }): ForecastHour[] {
  const times = parseTimes(json.hourly?.time);
  const probs = json.hourly?.precipitation_probability ?? [];
  return times.map((t, i) => ({ t, prob: Number.isFinite(probs[i]) ? probs[i] : null }));
}

export function parseMinutely(json: { minutely_15?: Series }): MinutelySample[] {
  const times = parseTimes(json.minutely_15?.time);
  const probs = json.minutely_15?.precipitation_probability ?? [];
  const precip = json.minutely_15?.precipitation ?? [];
  return times.map((t, i) => ({
    t,
    precipMm: Number.isFinite(precip[i]) ? precip[i] : null,
    prob: Number.isFinite(probs[i]) ? probs[i] : null,
  }));
}

export function parseArchive(json: { hourly?: Series }): ArchiveHour[] {
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

/** Hourly bars after the first forecast hour (the 1-minute line covers the next 60 minutes). */
export function laterHourlyForecast(hours: ForecastHour[], now: number, count = 8): ForecastHour[] {
  return hours.filter((h) => h.t >= now + 45 * 60_000).slice(0, count);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function interpolateMinutePoints(samples: MinutelySample[], now: number, minutes = 60): MinutePoint[] {
  const xs: number[] = [];
  const probs: number[] = [];
  const mm: number[] = [];
  for (const s of samples.slice().sort((a, b) => a.t - b.t)) {
    if (!Number.isFinite(s.t) || (s.prob == null && s.precipMm == null)) continue;
    xs.push(s.t);
    probs.push(s.prob ?? 0);
    mm.push(s.precipMm ?? 0);
  }
  if (!xs.length) return [];
  const out: MinutePoint[] = [];
  for (let i = 0; i < minutes; i++) {
    const t = now + i * MINUTE_MS;
    out.push({
      t,
      precipMm: Math.max(0, interpolateMonotone(xs, mm, t)),
      prob: clamp(interpolateMonotone(xs, probs, t), 0, 100),
    });
  }
  return out;
}

export function nativeMinutelyInWindow(samples: MinutelySample[], now: number, minutes = 60): MinutelySample[] {
  const end = now + minutes * MINUTE_MS;
  return samples.filter((s) => s.t >= now - 30_000 && s.t <= end + 30_000);
}

export async function fetchForecast(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<ForecastPack> {
  const res = await fetchImpl(forecastUrl(lat, lon));
  if (!res.ok) throw new Error(`Open-Meteo forecast ${res.status}`);
  const json = (await res.json()) as { hourly?: Series; minutely_15?: Series };
  return { hourly: parseForecast(json), minutely: parseMinutely(json) };
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
  return parseArchive((await res.json()) as { hourly?: Series });
}
