import { isRaceOrSprint } from "./grid";
import type { Session } from "./types";

/** Official Grand Prix lap counts, keyed by OpenF1 `circuit_short_name`. */
const RACE_LAPS: Record<string, number> = {
  "albert park": 58,
  melbourne: 58,
  shanghai: 56,
  suzuka: 53,
  bahrain: 57,
  sakhir: 57,
  jeddah: 50,
  miami: 57,
  imola: 63,
  monaco: 78,
  "monte carlo": 78,
  catalunya: 66,
  barcelona: 66,
  montreal: 70,
  spielberg: 71,
  "red bull ring": 71,
  silverstone: 52,
  hungaroring: 70,
  "spa francorchamps": 44,
  spa: 44,
  zandvoort: 72,
  monza: 53,
  baku: 51,
  "marina bay": 62,
  singapore: 62,
  austin: 56,
  cota: 56,
  "mexico city": 71,
  mexico: 71,
  interlagos: 71,
  "sao paulo": 71,
  "las vegas": 50,
  lusail: 57,
  losail: 57,
  qatar: 57,
  "yas marina": 58,
  "abu dhabi": 58,
};

/** Typical sprint distances (~100 km). Unknown circuits omit the total. */
const SPRINT_LAPS: Record<string, number> = {
  shanghai: 19,
  miami: 19,
  spielberg: 24,
  "red bull ring": 24,
  "spa francorchamps": 15,
  spa: 15,
  austin: 19,
  cota: 19,
  interlagos: 24,
  "sao paulo": 24,
  lusail: 19,
  losail: 19,
  qatar: 19,
};

export function circuitKey(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Scheduled race/sprint distance — never the highest lap number already seen. */
export function scheduledRaceLaps(
  session: Pick<Session, "session_name" | "session_type" | "circuit_short_name"> | null | undefined,
): number | null {
  if (!session || !isRaceOrSprint(session)) return null;
  const key = circuitKey(session.circuit_short_name);
  if (!key) return null;
  const sprint = /^sprint$/i.test(session.session_name.trim());
  const n = (sprint ? SPRINT_LAPS : RACE_LAPS)[key] ?? null;
  return n && n > 0 ? n : null;
}
