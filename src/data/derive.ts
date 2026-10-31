import { asNumber, latestBefore, median, parseTs } from "../lib/time";
import type {
  FlagMode,
  Lap,
  Pit,
  SectorKind,
  SessionBundle,
  TimingSnapshot,
  TowerRow,
} from "./types";

function sortByDate<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => parseTs(a.date) - parseTs(b.date));
}

function flattenSegments(lap: Lap | null): number[] {
  if (!lap) return [];
  return [
    ...(lap.segments_sector_1 ?? []),
    ...(lap.segments_sector_2 ?? []),
    ...(lap.segments_sector_3 ?? []),
  ].filter((v): v is number => v != null);
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

function scBands(bundle: SessionBundle): TimingSnapshot["scBands"] {
  const events = [...bundle.raceControl].sort((a, b) => parseTs(a.date) - parseTs(b.date));
  const bands: TimingSnapshot["scBands"] = [];
  let open: { start: number; kind: "SC" | "VSC" } | null = null;
  const end = parseTs(bundle.session.date_end);
  for (const ev of events) {
    const msg = (ev.message ?? "").toUpperCase();
    const cat = (ev.category ?? "").toUpperCase();
    const isVsc = msg.includes("VIRTUAL SAFETY CAR") || msg.includes("VSC");
    const isSc = !isVsc && (cat === "SAFETYCAR" || msg.includes("SAFETY CAR"));
    const deployed = msg.includes("DEPLOYED") || msg.includes("IN THIS LAP");
    const ending = msg.includes("ENDING") || msg.includes("ENDING") || msg.includes("OVER");
    if ((isVsc || isSc) && deployed && !ending) {
      if (open) bands.push({ start: open.start, end: parseTs(ev.date), kind: open.kind });
      open = { start: parseTs(ev.date), kind: isVsc ? "VSC" : "SC" };
    } else if (open && (ending || msg.includes("SAFETY CAR IN") || ev.flag === "GREEN")) {
      if (msg.includes("GREEN LIGHT") && !msg.includes("SAFETY") && !msg.includes("VSC")) continue;
      if (ending || msg.includes("SAFETY CAR IN") || msg.includes("VIRTUAL SAFETY CAR ENDING")) {
        bands.push({ start: open.start, end: parseTs(ev.date), kind: open.kind });
        open = null;
      }
    }
  }
  if (open) bands.push({ start: open.start, end, kind: open.kind });
  return bands.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
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
    const lastPit = latestBefore(
      pits.filter((r) => r.driver_number === driver.driver_number),
      now,
      (r: Pit) => parseTs(r.date),
    );

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

    let gap: number | string | null = driverIv?.gap_to_leader ?? null;
    let interval: number | string | null = driverIv?.interval ?? null;

    const bestLap = best && best.lap < Infinity ? best.lap : null;
    drafts.push({
      pos: posEvt?.position ?? 99,
      driver,
      compound: stint?.compound ?? null,
      tyreAge,
      lastLap: last?.lap_duration ?? null,
      bestLap,
      interval,
      gap,
      status: retired ? "OUT" : inPit ? "IN PIT" : "ON TRACK",
      currentLap: cur?.lap_number ?? last?.lap_number ?? null,
      s1: cur?.duration_sector_1 ?? last?.duration_sector_1 ?? null,
      s2: cur?.duration_sector_2 ?? last?.duration_sector_2 ?? null,
      s3: cur?.duration_sector_3 ?? last?.duration_sector_3 ?? null,
      s1Kind: classify(cur?.duration_sector_1 ?? last?.duration_sector_1 ?? null, best?.s1 === Infinity ? null : best?.s1 ?? null, overallBest.s1 === Infinity ? null : overallBest.s1),
      s2Kind: classify(cur?.duration_sector_2 ?? last?.duration_sector_2 ?? null, best?.s2 === Infinity ? null : best?.s2 ?? null, overallBest.s2 === Infinity ? null : overallBest.s2),
      s3Kind: classify(cur?.duration_sector_3 ?? last?.duration_sector_3 ?? null, best?.s3 === Infinity ? null : best?.s3 ?? null, overallBest.s3 === Infinity ? null : overallBest.s3),
      segments: flattenSegments(cur ?? last),
      inPit,
      retired,
      progress: (() => {
        const start = parseTs(cur?.date_start);
        if (!Number.isFinite(start)) return 0;
        const dur = (cur?.lap_duration ?? medianGreenLap) * 1000;
        return Math.min(0.999, Math.max(0, (now - start) / dur));
      })(),
      bestForSort: bestLap ?? 9999,
    });

  }

  if (!hasIntervals) {
    drafts.sort((a, b) => a.bestForSort - b.bestForSort);
    const leaderBest = drafts[0]?.bestForSort ?? 0;
    drafts.forEach((row, i) => {
      row.pos = i + 1;
      row.gap = i === 0 ? null : row.bestForSort - leaderBest;
      row.interval = i === 0 ? null : row.bestForSort - drafts[i - 1].bestForSort;
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

  const weatherNow = latestBefore(weather, now, (w) => parseTs(w.date));
  const raceLaps = Math.max(leaderLap, ...bundle.laps.map((l) => l.lap_number), 1);

  return {
    now,
    rows: drafts.map(({ bestForSort: _b, ...row }) => row),
    leaderLap,
    medianGreenLap,
    weather: weatherNow,
    bestSectors,
    flagMode: flagAt(now, bands),
    scBands: bands,
    raceLaps,
  };
}

export function personalBests(bundle: SessionBundle, driverNumber: number, now: number): number[] {
  return bundle.laps
    .filter((l) => l.driver_number === driverNumber && l.lap_duration && parseTs(l.date_start) + (l.lap_duration ?? 0) * 1000 <= now)
    .map((l) => l.lap_number);
}
