import { asNumber, latestBefore, median, parseTs } from "../lib/time";
import { gridByDriver, isRaceOrSprint, positionChange } from "./grid";
import { scheduledRaceLaps } from "./raceDistance";
import { trackFlagAt } from "./trackFlag";
import type {
  FlagMode,
  Lap,
  Pit,
  RaceControl,
  SectorKind,
  SessionBundle,
  TimingSnapshot,
  TowerRow,
} from "./types";

function sortByDate<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => parseTs(a.date) - parseTs(b.date));
}

/** Pit stops for a driver whose /pit timestamp is at or before `now`. */
export function countPitsAt(pits: Pit[], now: number): number {
  let n = 0;
  for (const pit of pits) {
    const t = parseTs(pit.date);
    if (Number.isFinite(t) && t <= now) n += 1;
  }
  return n;
}

function nums(values: Array<number | null> | null | undefined): number[] {
  return (values ?? []).filter((v): v is number => v != null);
}

/** Sector times and mini-sectors that have actually elapsed by `now`. */
export function visibleLapTiming(lap: Lap | null, now: number): {
  s1: number | null;
  s2: number | null;
  s3: number | null;
  segments: number[];
} {
  if (!lap) return { s1: null, s2: null, s3: null, segments: [] };
  const start = parseTs(lap.date_start);
  if (!Number.isFinite(start)) return { s1: null, s2: null, s3: null, segments: [] };
  const s1 = lap.duration_sector_1;
  const s2 = lap.duration_sector_2;
  const s3 = lap.duration_sector_3;
  const lapDone = lap.lap_duration != null && start + lap.lap_duration * 1000 <= now;
  const s1Done = lapDone || (s1 != null && start + s1 * 1000 <= now);
  const s2Done = lapDone || (s1Done && s2 != null && start + (s1! + s2) * 1000 <= now);
  const s3Done = lapDone || (s2Done && s3 != null && start + (s1! + s2! + s3) * 1000 <= now);
  const segments: number[] = [];
  if (s1Done) segments.push(...nums(lap.segments_sector_1));
  if (s2Done) segments.push(...nums(lap.segments_sector_2));
  if (s3Done) segments.push(...nums(lap.segments_sector_3));
  return {
    s1: s1Done ? s1 : null,
    s2: s2Done ? s2 : null,
    s3: s3Done ? s3 : null,
    segments,
  };
}

function racingLap(lap: Lap, pitIn: Set<number>): boolean {
  return lap.lap_duration != null && Number.isFinite(lap.lap_duration) && lap.lap_duration > 0 && !lap.is_pit_out_lap && !pitIn.has(lap.lap_number);
}

/** Last completed lap minus the lap before it. Blank for lap 1, pit in/out, or a missing time. */
export function previousLapDelta(completed: Lap[], pitIn: Set<number>): number | null {
  let last: Lap | null = null;
  for (const lap of completed) {
    if (!last || lap.lap_number >= last.lap_number) last = lap;
  }
  if (!last || last.lap_number <= 1 || !racingLap(last, pitIn) || last.lap_duration == null) return null;
  const prev = completed.find((lap) => lap.lap_number === last.lap_number - 1) ?? null;
  if (!prev || !racingLap(prev, pitIn) || prev.lap_duration == null) return null;
  return last.lap_duration - prev.lap_duration;
}

function pitInLaps(pits: Pit[], driver: number, now: number): Set<number> {
  const laps = new Set<number>();
  for (const pit of pits) {
    if (pit.driver_number !== driver || pit.lap_number == null) continue;
    const t = parseTs(pit.date);
    if (Number.isFinite(t) && t <= now) laps.add(pit.lap_number);
  }
  return laps;
}

function completedBefore(laps: Lap[], t: number): Lap[] {
  return laps.filter((l) => {
    const start = parseTs(l.date_start);
    if (!Number.isFinite(start) || l.lap_duration == null) return false;
    return start + l.lap_duration * 1000 <= t;
  });
}

function currentLap(laps: Lap[], t: number): Lap | null {
  let best: Lap | null = null;
  let bestStart = -Infinity;
  for (const lap of laps) {
    const start = parseTs(lap.date_start);
    if (!Number.isFinite(start) || start > t) continue;
    if (start >= bestStart) {
      best = lap;
      bestStart = start;
    }
  }
  return best;
}

function classify(
  time: number | null,
  personalBest: number | null,
  overallBest: number | null,
): SectorKind {
  if (time == null) return "none";
  if (overallBest != null && Math.abs(time - overallBest) < 0.0006) return "overall";
  if (personalBest != null && Math.abs(time - personalBest) < 0.0006) return "personal";
  return "yellow";
}

function up(value: string | null | undefined): string {
  return (value ?? "").toUpperCase();
}

function isVscMessage(msg: string): boolean {
  return msg.includes("VIRTUAL SAFETY CAR") || /(^|[^A-Z])VSC([^A-Z]|$)/.test(msg);
}

function isScMessage(msg: string, cat: string): boolean {
  if (isVscMessage(msg)) return false;
  return cat === "SAFETYCAR" || msg.includes("SAFETY CAR");
}

/** Withdrawal / ending: SC still out or coming in — never a new deployment. */
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

/** Green-flag racing has resumed. Pit-exit green lights do not count. */
function isGreenResume(ev: RaceControl, msg: string): boolean {
  if (msg.includes("GREEN LIGHT") && (msg.includes("PIT") || msg.includes("EXIT"))) return false;
  if (msg.includes("GREEN FLAG") || msg.includes("TRACK CLEAR")) return true;
  if (ev.flag === "GREEN" && !msg.includes("GREEN LIGHT")) return true;
  return false;
}

function isExplicitEnding(msg: string): boolean {
  return msg.includes("ENDING") || /\b(SAFETY CAR|VIRTUAL SAFETY CAR|\bVSC\b).*\bOVER\b/.test(msg);
}

export function safetyCarBands(
  events: RaceControl[],
  sessionEnd: number,
): TimingSnapshot["scBands"] {
  const sorted = [...events].sort((a, b) => parseTs(a.date) - parseTs(b.date));
  const bands: TimingSnapshot["scBands"] = [];
  let open: { start: number; kind: "SC" | "VSC" } | null = null;
  for (const ev of sorted) {
    const msg = up(ev.message);
    const cat = up(ev.category);
    const t = parseTs(ev.date);
    if (!Number.isFinite(t)) continue;
    const vsc = isVscMessage(msg);
    const sc = isScMessage(msg, cat);
    const withdrawal = isWithdrawalOrEnding(msg);
    const deploy = isDeployment(msg, vsc || sc);
    const green = isGreenResume(ev, msg);
    const ending = isExplicitEnding(msg);

    if (open && (green || ending)) {
      bands.push({ start: open.start, end: t, kind: open.kind });
      open = null;
      continue;
    }
    if (withdrawal) continue;
    if (deploy) {
      if (open) bands.push({ start: open.start, end: t, kind: open.kind });
      open = { start: t, kind: vsc ? "VSC" : "SC" };
    }
  }
  if (open) bands.push({ start: open.start, end: sessionEnd, kind: open.kind });
  return bands.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
}

function scBands(bundle: SessionBundle): TimingSnapshot["scBands"] {
  return safetyCarBands(bundle.raceControl, parseTs(bundle.session.date_end));
}

function flagAt(t: number, bands: TimingSnapshot["scBands"]): FlagMode {
  const hit = bands.find((b) => t >= b.start && t <= b.end);
  if (!hit) return "green";
  return hit.kind === "VSC" ? "vsc" : "sc";
}

export function snapshotAt(bundle: SessionBundle, now: number): TimingSnapshot {
  const drivers = bundle.drivers;
  const lapsBy = new Map<number, Lap[]>();
  for (const lap of bundle.laps) {
    const list = lapsBy.get(lap.driver_number) ?? [];
    list.push(lap);
    lapsBy.set(lap.driver_number, list);
  }
  for (const list of lapsBy.values()) list.sort((a, b) => a.lap_number - b.lap_number);

  const intervals = sortByDate(bundle.intervals);
  const positions = sortByDate(bundle.positions);
  const pits = sortByDate(bundle.pits);
  const weather = [...bundle.weather].sort((a, b) => parseTs(a.date) - parseTs(b.date));
  const bands = scBands(bundle);
  const isRace = /race|sprint/i.test(bundle.session.session_name);

  const completedAll: Lap[] = [];
  const overallBest = { s1: Infinity, s2: Infinity, s3: Infinity, lap: Infinity };
  let leaderLap = 1;
  const greenLaps: number[] = [];

  for (const driver of drivers) {
    const completed = completedBefore(lapsBy.get(driver.driver_number) ?? [], now);
    completedAll.push(...completed);
    for (const lap of completed) {
      if (lap.lap_number > leaderLap) leaderLap = lap.lap_number;
      if (lap.duration_sector_1 && lap.duration_sector_1 < overallBest.s1) overallBest.s1 = lap.duration_sector_1;
      if (lap.duration_sector_2 && lap.duration_sector_2 < overallBest.s2) overallBest.s2 = lap.duration_sector_2;
      if (lap.duration_sector_3 && lap.duration_sector_3 < overallBest.s3) overallBest.s3 = lap.duration_sector_3;
      if (lap.lap_duration && lap.lap_duration < overallBest.lap) overallBest.lap = lap.lap_duration;
      if (lap.lap_duration && !lap.is_pit_out_lap) {
        const inSc = bands.some((b) => {
          const start = parseTs(lap.date_start);
          return start >= b.start && start <= b.end;
        });
        if (!inSc) greenLaps.push(lap.lap_duration);
      }
    }
  }

  const medianGreenLap = median(greenLaps) || 90;
  const hasIntervals = isRace && intervals.length > 0;

  const bestByDriver = new Map<number, { lap: number; s1: number; s2: number; s3: number }>();
  const lastByDriver = new Map<number, Lap>();
  for (const lap of completedAll) {
    const prev = bestByDriver.get(lap.driver_number) ?? {
      lap: Infinity,
      s1: Infinity,
      s2: Infinity,
      s3: Infinity,
    };
    if (lap.lap_duration && lap.lap_duration < prev.lap) prev.lap = lap.lap_duration;
    if (lap.duration_sector_1 && lap.duration_sector_1 < prev.s1) prev.s1 = lap.duration_sector_1;
    if (lap.duration_sector_2 && lap.duration_sector_2 < prev.s2) prev.s2 = lap.duration_sector_2;
    if (lap.duration_sector_3 && lap.duration_sector_3 < prev.s3) prev.s3 = lap.duration_sector_3;
    bestByDriver.set(lap.driver_number, prev);
    const prevLast = lastByDriver.get(lap.driver_number);
    if (!prevLast || lap.lap_number >= prevLast.lap_number) lastByDriver.set(lap.driver_number, lap);
  }

  type Draft = TowerRow & { bestForSort: number };
  const drafts: Draft[] = [];

  for (const driver of drivers) {
    const dlaps = lapsBy.get(driver.driver_number) ?? [];
    const cur = currentLap(dlaps, now);
    const last = lastByDriver.get(driver.driver_number) ?? null;
    const best = bestByDriver.get(driver.driver_number);
    const driverIv = latestBefore(
      intervals.filter((r) => r.driver_number === driver.driver_number),
      now,
      (r) => parseTs(r.date),
    );
    const posEvt = latestBefore(
      positions.filter((r) => r.driver_number === driver.driver_number),
      now,
      (r) => parseTs(r.date),
    );
    const driverPits = pits.filter((r) => r.driver_number === driver.driver_number);
    const lastPit = latestBefore(driverPits, now, (r: Pit) => parseTs(r.date));
    const pitCount = countPitsAt(driverPits, now);

    const stint = bundle.stints
      .filter((s) => s.driver_number === driver.driver_number)
      .sort((a, b) => (a.lap_start ?? 0) - (b.lap_start ?? 0))
      .reduce<(typeof bundle.stints)[number] | null>((acc, s) => {
        const startLap = s.lap_start ?? 1;
        const endLap = s.lap_end ?? 999;
        const lapNo = cur?.lap_number ?? last?.lap_number ?? 1;
        return lapNo >= startLap && lapNo <= endLap ? s : acc ?? s;
      }, null);

    const tyreAge =
      stint && stint.tyre_age_at_start != null
        ? stint.tyre_age_at_start + Math.max(0, (cur?.lap_number ?? last?.lap_number ?? stint.lap_start ?? 1) - (stint.lap_start ?? 1))
        : null;

    const lastStart = parseTs(cur?.date_start ?? last?.date_start);
    const inPit =
      !!lastPit &&
      now - parseTs(lastPit.date) < (lastPit.lane_duration ?? 28) * 1000 + 4000;
    const stale = Number.isFinite(lastStart) && now - lastStart > medianGreenLap * 2500;
    const retired = isRace && stale && !inPit && (cur?.lap_number ?? 0) + 2 < leaderLap;
    const lapActive =
      !!cur &&
      Number.isFinite(lastStart) &&
      (cur.lap_duration == null || lastStart + cur.lap_duration * 1000 > now);
    const inGarage = !inPit && !retired && !cur && !last;

    let gap: number | string | null = driverIv?.gap_to_leader ?? null;
    let interval: number | string | null = driverIv?.interval ?? null;

    const bestLap = best && best.lap < Infinity ? best.lap : null;
    const live = visibleLapTiming(cur, now);
    const pb = {
      s1: best?.s1 === Infinity ? null : best?.s1 ?? null,
      s2: best?.s2 === Infinity ? null : best?.s2 ?? null,
      s3: best?.s3 === Infinity ? null : best?.s3 ?? null,
    };
    const ob = {
      s1: overallBest.s1 === Infinity ? null : overallBest.s1,
      s2: overallBest.s2 === Infinity ? null : overallBest.s2,
      s3: overallBest.s3 === Infinity ? null : overallBest.s3,
    };
    drafts.push({
      pos: posEvt?.position ?? 99,
      driver,
      compound: stint?.compound ?? null,
      tyreAge,
      lastLap: last?.lap_duration ?? null,
      lastLapDelta: previousLapDelta(completedBefore(dlaps, now), pitInLaps(driverPits, driver.driver_number, now)),
      bestLap,
      interval,
      gap,
      status: retired ? "OUT" : inPit ? "IN PIT" : inGarage ? "GARAGE" : "ON TRACK",
      currentLap: cur?.lap_number ?? last?.lap_number ?? null,
      lapActive,
      inGarage,
      s1: live.s1,
      s2: live.s2,
      s3: live.s3,
      s1Kind: classify(live.s1, pb.s1, ob.s1),
      s2Kind: classify(live.s2, pb.s2, ob.s2),
      s3Kind: classify(live.s3, pb.s3, ob.s3),
      segments: live.segments,
      inPit,
      retired,
      pitOut: !!cur?.is_pit_out_lap,
      pits: pitCount,
      gridPos: null,
      posChange: null,
      progress: (() => {
        const start = parseTs(cur?.date_start);
        if (!Number.isFinite(start)) return 0;
        const dur = (cur?.lap_duration ?? medianGreenLap) * 1000;
        return Math.min(0.999, Math.max(0, (now - start) / dur));
      })(),
      bestForSort: bestLap ?? 9999,
    });

  }

  if (!hasIntervals && !isRace) {
    drafts.sort((a, b) => a.bestForSort - b.bestForSort);
    const leaderBest = drafts[0]?.bestForSort ?? 0;
    drafts.forEach((row, i) => {
      row.pos = i + 1;
      row.gap = i === 0 ? null : row.bestForSort - leaderBest;
      row.interval = i === 0 ? null : row.bestForSort - drafts[i - 1].bestForSort;
    });
  } else if (!hasIntervals && isRace) {
    drafts.sort((a, b) => {
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      return a.pos - b.pos;
    });
  } else {
    drafts.sort((a, b) => {
      if (a.retired !== b.retired) return a.retired ? 1 : -1;
      const ga = asNumber(a.gap);
      const gb = asNumber(b.gap);
      if (a.gap == null && typeof a.gap !== "string" && !a.retired && a.pos === 1) return -1;
      if (b.gap == null && typeof b.gap !== "string" && !b.retired && b.pos === 1) return 1;
      if (typeof a.gap === "string") return 1;
      if (typeof b.gap === "string") return -1;
      if (ga != null && gb != null && ga !== gb) return ga - gb;
      return a.pos - b.pos;
    });
    drafts.forEach((row, i) => {
      row.pos = i + 1;
    });
  }

  const bestSectors = {
    s1: null as TimingSnapshot["bestSectors"]["s1"],
    s2: null as TimingSnapshot["bestSectors"]["s2"],
    s3: null as TimingSnapshot["bestSectors"]["s3"],
  };
  for (const row of drafts) {
    const last = lastByDriver.get(row.driver.driver_number);
    if (!last) continue;
    if (last.duration_sector_1 && last.duration_sector_1 === overallBest.s1)
      bestSectors.s1 = { time: last.duration_sector_1, code: row.driver.name_acronym };
    if (last.duration_sector_2 && last.duration_sector_2 === overallBest.s2)
      bestSectors.s2 = { time: last.duration_sector_2, code: row.driver.name_acronym };
    if (last.duration_sector_3 && last.duration_sector_3 === overallBest.s3)
      bestSectors.s3 = { time: last.duration_sector_3, code: row.driver.name_acronym };
  }
  if (!bestSectors.s1 || !bestSectors.s2 || !bestSectors.s3) {
    for (const lap of completedAll) {
      const d = drivers.find((x) => x.driver_number === lap.driver_number);
      if (!d) continue;
      if (!bestSectors.s1 && lap.duration_sector_1 === overallBest.s1)
        bestSectors.s1 = { time: lap.duration_sector_1!, code: d.name_acronym };
      if (!bestSectors.s2 && lap.duration_sector_2 === overallBest.s2)
        bestSectors.s2 = { time: lap.duration_sector_2!, code: d.name_acronym };
      if (!bestSectors.s3 && lap.duration_sector_3 === overallBest.s3)
        bestSectors.s3 = { time: lap.duration_sector_3!, code: d.name_acronym };
    }
  }

  for (const row of drafts) {
    if (!row.inGarage) continue;
    row.gap = null;
    row.interval = null;
  }

  if (isRaceOrSprint(bundle.session)) {
    const grid = gridByDriver(bundle);
    for (const row of drafts) {
      const slot = grid.get(row.driver.driver_number) ?? null;
      row.gridPos = slot;
      row.posChange = positionChange(slot, row.pos);
    }
  }

  const weatherNow = latestBefore(weather, now, (w) => parseTs(w.date));
  const scheduled = scheduledRaceLaps(bundle.session);
  const seen = Math.max(leaderLap, ...bundle.laps.map((l) => l.lap_number), 1);
  const raceLaps = scheduled && scheduled > 0 ? scheduled : seen;

  return {
    now,
    rows: drafts.map(({ bestForSort: _b, ...row }) => row),
    leaderLap,
    medianGreenLap,
    weather: weatherNow,
    bestSectors,
    flagMode: flagAt(now, bands),
    trackFlag: trackFlagAt(bundle.raceControl, now),
    scBands: bands,
    raceLaps,
    scheduledLaps: scheduled,
  };
}

export function personalBests(bundle: SessionBundle, driverNumber: number, now: number): number[] {
  return bundle.laps
    .filter((l) => l.driver_number === driverNumber && l.lap_duration && parseTs(l.date_start) + (l.lap_duration ?? 0) * 1000 <= now)
    .map((l) => l.lap_number);
}
