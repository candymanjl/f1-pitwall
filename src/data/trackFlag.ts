import { parseTs } from "../lib/time";
import type { RaceControl } from "./types";

export type TrackFlagKind =
  | "green"
  | "yellow"
  | "doubleYellow"
  | "red"
  | "blue"
  | "white"
  | "black"
  | "blackWhite"
  | "blackOrange"
  | "slippery"
  | "chequered"
  | "sc"
  | "vsc";

export type TrackFlagState = {
  kind: TrackFlagKind;
  label: string;
  scope: "Track" | "Sector" | "Driver" | null;
  sector: number | null;
  driverNumber: number | null;
  badge: string | null;
};

export const FLAG_LABEL: Record<TrackFlagKind, string> = {
  green: "GREEN",
  yellow: "YELLOW",
  doubleYellow: "DOUBLE YELLOW",
  red: "RED FLAG",
  blue: "BLUE",
  white: "WHITE",
  black: "BLACK",
  blackWhite: "BLACK AND WHITE",
  blackOrange: "BLACK AND ORANGE",
  slippery: "SLIPPERY",
  chequered: "CHEQUERED",
  sc: "SAFETY CAR",
  vsc: "VSC",
};

const SEVERITY: Record<TrackFlagKind, number> = {
  red: 100,
  chequered: 90,
  sc: 80,
  vsc: 74,
  doubleYellow: 60,
  yellow: 50,
  black: 40,
  blackOrange: 38,
  blackWhite: 36,
  slippery: 28,
  blue: 18,
  white: 12,
  green: 0,
};

export const FLAG_SHEET_KINDS: TrackFlagKind[] = [
  "green",
  "yellow",
  "doubleYellow",
  "red",
  "blue",
  "white",
  "black",
  "blackWhite",
  "blackOrange",
  "slippery",
  "chequered",
  "sc",
  "vsc",
];

function up(value: string | null | undefined): string {
  return (value ?? "").toUpperCase();
}

function normFlag(raw: string | null | undefined): string {
  return up(raw)
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVscMessage(msg: string, cat = ""): boolean {
  return cat === "VSC" || msg.includes("VIRTUAL SAFETY CAR") || /(^|[^A-Z])VSC([^A-Z]|$)/.test(msg);
}

function isScMessage(msg: string, cat: string): boolean {
  if (isVscMessage(msg, cat)) return false;
  return cat === "SAFETYCAR" || msg.includes("SAFETY CAR");
}

function isWithdrawalOrEnding(msg: string): boolean {
  if (msg.includes("IN THIS LAP")) return true;
  if (msg.includes("ENDING")) return true;
  if (msg.includes("SAFETY CAR IN")) return true;
  if (/\b(SAFETY CAR|VIRTUAL SAFETY CAR|\bVSC\b).*\bOVER\b/.test(msg)) return true;
  return false;
}

function isDeployment(msg: string, vscOrSc: boolean): boolean {
  return vscOrSc && msg.includes("DEPLOYED") && !isWithdrawalOrEnding(msg);
}

function isPitGreen(msg: string): boolean {
  return msg.includes("GREEN LIGHT") && (msg.includes("PIT") || msg.includes("EXIT"));
}

function isTrackGreen(ev: RaceControl, msg: string, flag: string): boolean {
  if (isPitGreen(msg)) return false;
  if (msg.includes("GREEN FLAG") || msg.includes("TRACK CLEAR")) return true;
  if (flag === "GREEN" && up(ev.scope) !== "SECTOR") return true;
  return false;
}

export function racingSector(ev: Pick<RaceControl, "sector" | "message" | "scope">): number | null {
  const n = Number(ev.sector);
  if (Number.isFinite(n) && n >= 1 && n <= 3) return n;
  if (Number.isFinite(n) && n >= 4 && n <= 24) return Math.min(3, Math.max(1, Math.ceil(n / 8)));
  const fromMsg = /SECTOR\s*([123])\b/i.exec(ev.message ?? "");
  if (fromMsg) return Number(fromMsg[1]);
  return null;
}

function kindFromFlag(flag: string): TrackFlagKind | "clear" | null {
  if (flag === "GREEN") return "green";
  if (flag === "DOUBLE YELLOW" || flag === "DOUBLE YELLOW FLAG") return "doubleYellow";
  if (flag === "YELLOW") return "yellow";
  if (flag === "RED" || flag === "RED FLAG") return "red";
  if (flag === "BLUE") return "blue";
  if (flag === "WHITE") return "white";
  if (flag === "BLACK AND WHITE" || flag === "BLACK WHITE") return "blackWhite";
  if (flag === "BLACK AND ORANGE" || flag === "BLACK ORANGE" || flag === "MEATBALL") return "blackOrange";
  if (flag === "YELLOW AND RED" || flag === "YELLOW RED" || flag === "SLIPPERY") return "slippery";
  if (flag === "CHEQUERED" || flag === "CHECKERED") return "chequered";
  if (flag === "BLACK") return "black";
  if (flag === "CLEAR") return "clear";
  return null;
}

function badgeFor(kind: TrackFlagKind, scope: TrackFlagState["scope"], sector: number | null, driver: number | null, sectors: number[]): string | null {
  if (kind === "yellow" || kind === "doubleYellow") {
    if (scope === "Sector" || sectors.length) {
      const list = sectors.length ? [...new Set(sectors)].sort((a, b) => a - b) : sector ? [sector] : [];
      if (list.length === 1) return `S${list[0]}`;
      if (list.length > 1) return list.map((n) => `S${n}`).join("+");
    }
  }
  if (driver != null && (scope === "Driver" || ["blue", "black", "blackWhite", "blackOrange", "white"].includes(kind))) {
    return `CAR ${driver}`;
  }
  return null;
}

export function emptyTrackFlag(): TrackFlagState {
  return { kind: "green", label: FLAG_LABEL.green, scope: "Track", sector: null, driverNumber: null, badge: null };
}

/**
 * Current flag at `now`: track-wide state plus uncleared sector yellows.
 * CLEAR for that sector, or a later track GREEN, drops the local yellow.
 * The most severe remaining flag is shown.
 */
export function trackFlagAt(events: RaceControl[] | null | undefined, now: number): TrackFlagState {
  const sorted = [...(events ?? [])]
    .map((ev) => ({ ev, t: parseTs(ev.date) }))
    .filter((row) => Number.isFinite(row.t) && row.t <= now)
    .sort((a, b) => a.t - b.t);

  let track: TrackFlagKind = "green";
  let trackDriver: number | null = null;
  const sectors = new Map<number, "yellow" | "doubleYellow">();
  let driverKind: TrackFlagKind | null = null;
  let driverNumber: number | null = null;

  for (const { ev } of sorted) {
    const msg = up(ev.message);
    const cat = up(ev.category);
    const flag = normFlag(ev.flag);
    const scope = up(ev.scope);
    const sector = racingSector(ev);
    const kind = kindFromFlag(flag);
    const vsc = isVscMessage(msg, cat);
    const sc = isScMessage(msg, cat);

    if (isDeployment(msg, vsc || sc)) {
      track = vsc ? "vsc" : "sc";
      trackDriver = null;
    } else if ((vsc || sc) && (isWithdrawalOrEnding(msg) || msg.includes("ENDING"))) {
      if (track === "sc" || track === "vsc") track = "green";
    }

    if (kind === "clear") {
      if (scope === "SECTOR" && sector) sectors.delete(sector);
      else if (scope !== "DRIVER") {
        sectors.clear();
        if (track === "yellow" || track === "doubleYellow") track = "green";
      }
      continue;
    }

    if (isTrackGreen(ev, msg, flag)) {
      sectors.clear();
      if (track !== "chequered") {
        track = "green";
        trackDriver = null;
      }
      if (driverKind === "blue" || driverKind === "white") {
        driverKind = null;
        driverNumber = null;
      }
      continue;
    }

    if (!kind || kind === "green") continue;

    if (scope === "SECTOR" && (kind === "yellow" || kind === "doubleYellow") && sector) {
      sectors.set(sector, kind);
      continue;
    }

    if (scope === "DRIVER" || (ev.driver_number != null && ["blue", "black", "blackWhite", "blackOrange", "white"].includes(kind))) {
      driverKind = kind;
      driverNumber = ev.driver_number != null ? Number(ev.driver_number) : null;
      continue;
    }

    if (kind === "red" || kind === "chequered" || kind === "yellow" || kind === "doubleYellow" || kind === "slippery") {
      const holdSc = (track === "sc" || track === "vsc") && kind !== "red" && kind !== "chequered";
      if (!holdSc) {
        track = kind;
        trackDriver = ev.driver_number != null ? Number(ev.driver_number) : null;
      }
      if (kind === "red" || kind === "chequered") sectors.clear();
    }
  }

  let best: TrackFlagState = {
    kind: track,
    label: FLAG_LABEL[track],
    scope: "Track",
    sector: null,
    driverNumber: trackDriver,
    badge: null,
  };

  let worstSector: "yellow" | "doubleYellow" | null = null;
  const activeSectors: number[] = [];
  for (const [n, k] of sectors) {
    activeSectors.push(n);
    if (!worstSector || SEVERITY[k] > SEVERITY[worstSector]) worstSector = k;
  }
  if (worstSector && SEVERITY[worstSector] > SEVERITY[best.kind]) {
    const sector = [...sectors.entries()].find(([, k]) => k === worstSector)?.[0] ?? null;
    best = {
      kind: worstSector,
      label: FLAG_LABEL[worstSector],
      scope: "Sector",
      sector,
      driverNumber: null,
      badge: null,
    };
  }

  if (driverKind && SEVERITY[driverKind] > SEVERITY[best.kind]) {
    best = {
      kind: driverKind,
      label: FLAG_LABEL[driverKind],
      scope: "Driver",
      sector: null,
      driverNumber,
      badge: null,
    };
  }

  best.badge = badgeFor(best.kind, best.scope, best.sector, best.driverNumber, best.scope === "Sector" ? activeSectors : []);
  return best;
}

export function sheetFlagState(kind: TrackFlagKind): TrackFlagState {
  const driver = kind === "blue" || kind === "black" || kind === "blackWhite" || kind === "blackOrange" ? 44 : null;
  const sector = kind === "yellow" ? 2 : kind === "doubleYellow" ? 1 : null;
  const scope = driver ? "Driver" : sector ? "Sector" : "Track";
  return {
    kind,
    label: FLAG_LABEL[kind],
    scope,
    sector,
    driverNumber: driver,
    badge: badgeFor(kind, scope, sector, driver, sector ? [sector] : []),
  };
}
