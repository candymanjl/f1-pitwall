import { describe, expect, it } from "vitest";
import { parseTs } from "../lib/time";
import { countPitsAt, previousLapDelta, safetyCarBands, snapshotAt, visibleLapTiming } from "./derive";
import type { Driver, Lap, Pit, Position, RaceControl, Session, SessionBundle } from "./types";

const T0 = "2025-10-26T20:00:00.000Z";
const T_DEPLOY = "2025-10-26T20:10:00.000Z";
const T_IN_LAP = "2025-10-26T20:12:00.000Z";
const T_GREEN = "2025-10-26T20:13:30.000Z";
const T_END = "2025-10-26T22:00:00.000Z";

function rc(partial: Partial<RaceControl> & { date: string; message: string }): RaceControl {
  return {
    category: null,
    flag: null,
    scope: null,
    lap_number: null,
    driver_number: null,
    ...partial,
  };
}

function driver(n: number, code: string): Driver {
  return {
    driver_number: n,
    broadcast_name: code,
    full_name: code,
    name_acronym: code,
    team_name: "Test",
    team_colour: "ffffff",
    first_name: code,
    last_name: code,
  };
}

function session(name = "Race"): Session {
  return {
    session_key: 1,
    meeting_key: 1,
    session_name: name,
    session_type: name,
    date_start: T0,
    date_end: T_END,
    circuit_short_name: "Test",
    country_name: "Test",
    location: "Test",
    year: 2025,
  };
}

function bundle(over: Partial<SessionBundle> = {}): SessionBundle {
  return {
    meeting: {
      meeting_key: 1,
      meeting_name: "Test GP",
      circuit_short_name: "Test",
      country_name: "Test",
      location: "Test",
      date_start: T0,
      year: 2025,
    },
    session: session(),
    weekendSessions: [],
    drivers: [driver(1, "AAA"), driver(44, "BBB")],
    laps: [],
    intervals: [],
    positions: [],
    stints: [],
    weekendStints: [],
    pits: [],
    weather: [],
    raceControl: [],
    track: [],
    corners: [],
    sectorFracs: [0.3, 0.4, 0.3],
    ...over,
  };
}

describe("safetyCarBands", () => {
  it("closes an SC band on GREEN FLAG after SAFETY CAR IN THIS LAP (not a redeploy)", () => {
    const events = [
      rc({ date: T_DEPLOY, category: "SafetyCar", message: "SAFETY CAR DEPLOYED" }),
      rc({ date: T_IN_LAP, category: "SafetyCar", message: "SAFETY CAR IN THIS LAP" }),
      rc({ date: T_GREEN, category: "Flag", flag: "GREEN", scope: "Track", message: "GREEN FLAG" }),
    ];
    const bands = safetyCarBands(events, parseTs(T_END));
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("SC");
    expect(bands[0].start).toBe(parseTs(T_DEPLOY));
    expect(bands[0].end).toBe(parseTs(T_GREEN));
  });

  it("closes on track-clear green regardless of VSC vs SC mode", () => {
    const events = [
      rc({ date: T_DEPLOY, category: "SafetyCar", message: "VIRTUAL SAFETY CAR DEPLOYED" }),
      rc({ date: T_GREEN, category: "Flag", flag: "GREEN", scope: "Track", message: "TRACK CLEAR" }),
    ];
    const bands = safetyCarBands(events, parseTs(T_END));
    expect(bands).toHaveLength(1);
    expect(bands[0].kind).toBe("VSC");
    expect(bands[0].end).toBe(parseTs(T_GREEN));
  });

  it("closes VSC on ENDING and ignores pit-exit green lights", () => {
    const events = [
      rc({ date: "2025-10-26T19:20:00.000Z", category: "Flag", flag: "GREEN", message: "GREEN LIGHT - PIT EXIT OPEN" }),
      rc({ date: T_DEPLOY, category: "SafetyCar", message: "VIRTUAL SAFETY CAR DEPLOYED" }),
      rc({ date: T_GREEN, category: "SafetyCar", message: "VIRTUAL SAFETY CAR ENDING" }),
    ];
    const bands = safetyCarBands(events, parseTs(T_END));
    expect(bands).toHaveLength(1);
    expect(bands[0].start).toBe(parseTs(T_DEPLOY));
    expect(bands[0].end).toBe(parseTs(T_GREEN));
  });

  it("leaves flagMode green after the green flag in a full snapshot", () => {
    const snap = snapshotAt(
      bundle({
        raceControl: [
          rc({ date: T_DEPLOY, category: "SafetyCar", message: "SAFETY CAR DEPLOYED" }),
          rc({ date: T_IN_LAP, category: "SafetyCar", message: "SAFETY CAR IN THIS LAP" }),
          rc({ date: T_GREEN, category: "Flag", flag: "GREEN", message: "GREEN FLAG" }),
        ],
      }),
      parseTs("2025-10-26T20:20:00.000Z"),
    );
    expect(snap.flagMode).toBe("green");
    expect(snap.trackFlag?.kind).toBe("green");
    expect(snap.scBands).toHaveLength(1);
    expect(snap.scBands[0].end).toBe(parseTs(T_GREEN));
  });

  it("puts the current race-control flag on the snapshot at the playhead", () => {
    const snap = snapshotAt(
      bundle({
        raceControl: [
          rc({
            date: T_DEPLOY,
            category: "Flag",
            flag: "YELLOW",
            scope: "Sector",
            sector: 2,
            message: "YELLOW FLAG IN SECTOR 2",
          }),
        ],
      }),
      parseTs("2025-10-26T20:11:00.000Z"),
    );
    expect(snap.trackFlag?.kind).toBe("yellow");
    expect(snap.trackFlag?.badge).toBe("S2");
    expect(snap.trackFlag?.label).toBe("YELLOW");
  });
});

describe("visibleLapTiming", () => {
  const lap: Lap = {
    driver_number: 1,
    lap_number: 5,
    date_start: "2025-10-26T20:05:00.000Z",
    lap_duration: 90,
    duration_sector_1: 30,
    duration_sector_2: 30,
    duration_sector_3: 30,
    is_pit_out_lap: false,
    segments_sector_1: [2049, 2049],
    segments_sector_2: [2048, 2048],
    segments_sector_3: [2051, 2051],
    i1_speed: 280,
    i2_speed: 300,
    st_speed: 330,
  };
  const start = parseTs(lap.date_start);

  it("hides all sectors one second into the lap", () => {
    const vis = visibleLapTiming(lap, start + 1000);
    expect(vis.s1).toBeNull();
    expect(vis.s2).toBeNull();
    expect(vis.s3).toBeNull();
    expect(vis.time).toBeNull();
    expect(vis.i1).toBeNull();
    expect(vis.i2).toBeNull();
    expect(vis.st).toBeNull();
    expect(vis.lapDone).toBe(false);
    expect(vis.segments).toEqual([]);
  });

  it("reveals S1 and I1 only after sector 1 completes", () => {
    const vis = visibleLapTiming(lap, start + 30_000);
    expect(vis.s1).toBe(30);
    expect(vis.s2).toBeNull();
    expect(vis.s3).toBeNull();
    expect(vis.time).toBeNull();
    expect(vis.i1).toBe(280);
    expect(vis.i2).toBeNull();
    expect(vis.st).toBeNull();
    expect(vis.segments).toEqual([2049, 2049]);
  });

  it("does not leak completed sector times onto the tower at lap start", () => {
    const start = "2025-10-26T20:05:00.000Z";
    const snap = snapshotAt(
      bundle({
        laps: [lap],
        drivers: [driver(1, "AAA")],
      }),
      parseTs(start) + 1000,
    );
    expect(snap.rows[0].s1).toBeNull();
    expect(snap.rows[0].s2).toBeNull();
    expect(snap.rows[0].s3).toBeNull();
    expect(snap.rows[0].segments).toEqual([]);
  });

  it("reveals S3 only after the full lap elapsed", () => {
    const midS3 = visibleLapTiming(lap, start + 75_000);
    expect(midS3.s1).toBe(30);
    expect(midS3.s2).toBe(30);
    expect(midS3.s3).toBeNull();
    expect(midS3.segments).toEqual([2049, 2049, 2048, 2048]);
    const done = visibleLapTiming(lap, start + 90_000);
    expect(done.s3).toBe(30);
    expect(done.time).toBe(90);
    expect(done.st).toBe(330);
    expect(done.lapDone).toBe(true);
    expect(done.segments).toEqual([2049, 2049, 2048, 2048, 2051, 2051]);
  });

  it("does not put unrevealed in-progress sectors on the best-sectors footer", () => {
    const prev: Lap = {
      ...lap,
      lap_number: 4,
      date_start: "2025-10-26T20:03:00.000Z",
      lap_duration: 90,
      duration_sector_1: 31,
      duration_sector_2: 40,
      duration_sector_3: 31,
    };
    const snap = snapshotAt(
      bundle({
        laps: [prev, lap],
        drivers: [driver(1, "AAA")],
      }),
      parseTs(lap.date_start) + 45_000,
    );
    expect(snap.rows[0].s1).toBe(30);
    expect(snap.rows[0].s2).toBeNull();
    expect(snap.bestSectors.s1?.time).toBe(31);
    expect(snap.bestSectors.s2?.time).toBe(40);
    expect(snap.bestSectors.s3?.time).toBe(31);
  });
});

describe("snapshotAt race order without intervals", () => {
  const laps: Lap[] = [
    {
      driver_number: 44,
      lap_number: 2,
      date_start: "2025-10-26T20:04:00.000Z",
      lap_duration: 70,
      duration_sector_1: 20,
      duration_sector_2: 25,
      duration_sector_3: 25,
      is_pit_out_lap: false,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
      i1_speed: null,
      i2_speed: null,
      st_speed: null,
    },
    {
      driver_number: 1,
      lap_number: 2,
      date_start: "2025-10-26T20:04:05.000Z",
      lap_duration: 80,
      duration_sector_1: 25,
      duration_sector_2: 28,
      duration_sector_3: 27,
      is_pit_out_lap: false,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
      i1_speed: null,
      i2_speed: null,
      st_speed: null,
    },
  ];
  const positions: Position[] = [
    { date: "2025-10-26T20:03:00.000Z", driver_number: 1, position: 1 },
    { date: "2025-10-26T20:03:00.000Z", driver_number: 44, position: 2 },
  ];

  it("keeps /position order and leaves gaps blank in a race", () => {
    const snap = snapshotAt(
      bundle({ laps, positions, intervals: [] }),
      parseTs("2025-10-26T20:08:00.000Z"),
    );
    expect(snap.rows.map((r) => r.driver.driver_number)).toEqual([1, 44]);
    expect(snap.rows[0].pos).toBe(1);
    expect(snap.rows[1].pos).toBe(2);
    expect(snap.rows[0].gap).toBeNull();
    expect(snap.rows[1].gap).toBeNull();
    expect(snap.rows[0].interval).toBeNull();
    expect(snap.rows[1].interval).toBeNull();
  });

  it("uses /starting_grid for positions gained and lost", () => {
    const snap = snapshotAt(
      bundle({
        laps,
        positions,
        startingGrid: [
          { driver_number: 1, position: 3 },
          { driver_number: 44, position: 1 },
        ],
      }),
      parseTs("2025-10-26T20:08:00.000Z"),
    );
    const a = snap.rows.find((r) => r.driver.driver_number === 1)!;
    const b = snap.rows.find((r) => r.driver.driver_number === 44)!;
    expect(a.gridPos).toBe(3);
    expect(a.posChange).toBe(2);
    expect(b.gridPos).toBe(1);
    expect(b.posChange).toBe(-1);
  });

  it("falls back to the first /position when the grid is missing", () => {
    const snap = snapshotAt(
      bundle({
        laps,
        positions: [
          { date: "2025-10-26T20:00:00.000Z", driver_number: 1, position: 2 },
          { date: "2025-10-26T20:00:00.000Z", driver_number: 44, position: 1 },
          { date: "2025-10-26T20:05:00.000Z", driver_number: 1, position: 1 },
          { date: "2025-10-26T20:05:00.000Z", driver_number: 44, position: 2 },
        ],
      }),
      parseTs("2025-10-26T20:08:00.000Z"),
    );
    const a = snap.rows.find((r) => r.driver.driver_number === 1)!;
    expect(a.gridPos).toBe(2);
    expect(a.pos).toBe(1);
    expect(a.posChange).toBe(1);
  });

  it("still ranks practice by best lap when intervals are absent", () => {
    const snap = snapshotAt(
      bundle({
        session: session("Practice 1"),
        laps,
        positions,
        intervals: [],
      }),
      parseTs("2025-10-26T20:08:00.000Z"),
    );
    expect(snap.rows[0].driver.driver_number).toBe(44);
    expect(snap.rows[0].pos).toBe(1);
    expect(snap.rows[1].gap).toBeCloseTo(10);
    expect(snap.rows.every((r) => r.posChange == null)).toBe(true);
  });

  it("marks cars that have never left the garage and blanks +9876-style gaps", () => {
    const snap = snapshotAt(
      bundle({
        session: session("Practice 1"),
        drivers: [driver(1, "AAA"), driver(44, "BBB"), driver(14, "ALO"), driver(18, "SLA")],
        laps,
        positions: [],
        intervals: [],
      }),
      parseTs("2025-10-26T20:08:00.000Z"),
    );
    const onTrack = snap.rows.filter((r) => !r.inGarage);
    const garage = snap.rows.filter((r) => r.inGarage);
    expect(onTrack.map((r) => r.driver.name_acronym).sort()).toEqual(["AAA", "BBB"]);
    expect(garage.map((r) => r.driver.name_acronym).sort()).toEqual(["ALO", "SLA"]);
    expect(garage.every((r) => r.status === "GARAGE")).toBe(true);
    expect(garage.every((r) => r.gap == null && r.interval == null && r.currentLap == null)).toBe(true);
    expect(onTrack.every((r) => r.status !== "GARAGE")).toBe(true);
    expect(onTrack.every((r) => r.gap == null || (typeof r.gap === "number" && r.gap < 100))).toBe(true);
  });

  it("does not leave São Paulo FP1 cars in the garage at 00:45 when OpenF1 uses microseconds", () => {
    const start = parseTs("2026-11-06T15:30:00+00:00");
    const snap = snapshotAt(
      bundle({
        session: session("Practice 1"),
        drivers: [driver(1, "NOR"), driver(62, "MIN")],
        weather: [
          {
            date: "2026-11-06T15:15:20.741000+00:00",
            air_temperature: 22.1,
            track_temperature: 38.4,
            wind_speed: 1.2,
            wind_direction: 210,
            humidity: 55,
            rainfall: 0,
            pressure: 1013,
          },
        ],
        stints: [
          { driver_number: 1, stint_number: 1, lap_start: 1, lap_end: 33, compound: "MEDIUM", tyre_age_at_start: 0 },
        ],
        laps: [
          {
            driver_number: 1,
            lap_number: 2,
            date_start: "2026-11-06T15:32:52.806000",
            lap_duration: 73.661,
            duration_sector_1: 18.926,
            duration_sector_2: 36.2,
            duration_sector_3: 18.535,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: 280,
            i2_speed: 300,
            st_speed: 312,
          },
          {
            driver_number: 1,
            lap_number: 20,
            date_start: "2026-11-06T16:10:00.000000+00:00",
            lap_duration: 74.2,
            duration_sector_1: 19.1,
            duration_sector_2: 36.0,
            duration_sector_3: 19.1,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: 282,
            i2_speed: 301,
            st_speed: 318,
          },
        ],
      }),
      start + (45 * 60 + 29) * 1000,
    );
    const nor = snap.rows.find((r) => r.driver.driver_number === 1)!;
    expect(nor.status).not.toBe("GARAGE");
    expect(nor.inGarage).toBe(false);
    expect(nor.bestLap).toBeCloseTo(73.661, 5);
    expect(snap.weather?.air_temperature).toBeCloseTo(22.1, 5);
    expect(snap.bestSectors.s1?.time).toBeCloseTo(18.926, 5);
    const min = snap.rows.find((r) => r.driver.driver_number === 62)!;
    expect(min.status).toBe("GARAGE");
  });
});

describe("previous lap delta", () => {
  function timed(partial: Partial<Lap> & Pick<Lap, "lap_number" | "date_start" | "lap_duration">): Lap {
    return {
      driver_number: 1,
      duration_sector_1: 28,
      duration_sector_2: 32,
      duration_sector_3: 20,
      is_pit_out_lap: false,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
      i1_speed: null,
      i2_speed: null,
      st_speed: null,
      ...partial,
    };
  }

  const lap1 = timed({ lap_number: 1, date_start: "2025-10-26T20:00:00.000Z", lap_duration: 80 });
  const lap2 = timed({ lap_number: 2, date_start: "2025-10-26T20:01:20.000Z", lap_duration: 80.312 });
  const lap3 = timed({ lap_number: 3, date_start: "2025-10-26T20:02:40.312Z", lap_duration: 80.097 });

  it("is blank on lap 1 and when the neighbouring lap is a pit in or pit out", () => {
    expect(previousLapDelta([lap1], new Set())).toBeNull();
    expect(previousLapDelta([lap1, { ...lap2, is_pit_out_lap: true }], new Set())).toBeNull();
    expect(previousLapDelta([{ ...lap1, is_pit_out_lap: true }, lap2], new Set())).toBeNull();
    expect(previousLapDelta([lap1, lap2], new Set([2]))).toBeNull();
    expect(previousLapDelta([lap1, lap2, lap3], new Set([2]))).toBeNull();
    expect(previousLapDelta([lap1, lap3], new Set())).toBeNull();
  });

  it("subtracts the previous lap, slower positive and faster negative", () => {
    expect(previousLapDelta([lap1, lap2], new Set())).toBeCloseTo(0.312, 3);
    expect(previousLapDelta([lap1, { ...lap2, lap_duration: 79.785 }], new Set())).toBeCloseTo(-0.215, 3);
  });

  it("puts that gap on the timing row and ignores a pit that has not happened yet", () => {
    const now = parseTs("2025-10-26T20:02:41.000Z");
    const snap = snapshotAt(
      bundle({
        laps: [lap1, lap2],
        drivers: [driver(1, "AAA")],
        pits: [{ date: "2025-10-26T20:10:00.000Z", driver_number: 1, lap_number: 2, lane_duration: 20, pit_duration: 22, stop_duration: 2 }],
      }),
      now,
    );
    expect(snap.rows[0].lastLap).toBeCloseTo(80.312, 3);
    expect(snap.rows[0].lastLapDelta).toBeCloseTo(0.312, 3);
  });
});

describe("scheduled race distance", () => {
  it("reports Mexico 71 even when the leader is only on lap 12", () => {
    const snap = snapshotAt(
      bundle({
        session: { ...session("Race"), circuit_short_name: "Mexico City" },
        laps: [
          {
            driver_number: 1,
            lap_number: 12,
            date_start: "2025-10-26T20:16:00.000Z",
            lap_duration: null,
            duration_sector_1: 28,
            duration_sector_2: null,
            duration_sector_3: null,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          },
        ],
        positions: [{ date: "2025-10-26T20:16:00.000Z", driver_number: 1, position: 1 }],
      }),
      parseTs("2025-10-26T20:16:10.000Z"),
    );
    expect(snap.rows[0].currentLap).toBe(12);
    expect(snap.scheduledLaps).toBe(71);
    expect(snap.raceLaps).toBe(71);
  });
});

describe("pit stop count at current time", () => {
  const pits: Pit[] = [
    { date: "2025-10-26T20:10:00.000Z", driver_number: 1, lap_number: 8, lane_duration: 24, pit_duration: 22, stop_duration: 2.4 },
    { date: "2025-10-26T20:40:00.000Z", driver_number: 1, lap_number: 28, lane_duration: 23, pit_duration: 21, stop_duration: 2.2 },
    { date: "2025-10-26T20:12:00.000Z", driver_number: 44, lap_number: 9, lane_duration: 25, pit_duration: 23, stop_duration: 2.5 },
  ];

  it("counts only /pit rows at or before now", () => {
    expect(countPitsAt(pits.filter((p) => p.driver_number === 1), parseTs("2025-10-26T20:09:59.000Z"))).toBe(0);
    expect(countPitsAt(pits.filter((p) => p.driver_number === 1), parseTs("2025-10-26T20:10:00.000Z"))).toBe(1);
    expect(countPitsAt(pits.filter((p) => p.driver_number === 1), parseTs("2025-10-26T20:40:00.000Z"))).toBe(2);
  });

  it("puts the live count on each snapshot row", () => {
    const snap = snapshotAt(bundle({ pits }), parseTs("2025-10-26T20:20:00.000Z"));
    const one = snap.rows.find((r) => r.driver.driver_number === 1);
    const forty = snap.rows.find((r) => r.driver.driver_number === 44);
    expect(one?.pits).toBe(1);
    expect(forty?.pits).toBe(1);
  });

  it("caps IN PIT to 60s of lane time and shows STOPPED under a red flag", () => {
    const pit: Pit = {
      date: "2025-10-26T20:10:00.000Z",
      driver_number: 1,
      lap_number: 8,
      lane_duration: 600,
      pit_duration: 22,
      stop_duration: 2,
    };
    const during = snapshotAt(bundle({ pits: [pit], drivers: [driver(1, "AAA")] }), parseTs("2025-10-26T20:10:30.000Z"));
    expect(during.rows[0].inPit).toBe(true);
    expect(during.rows[0].status).toBe("IN PIT");

    const afterCap = snapshotAt(bundle({ pits: [pit], drivers: [driver(1, "AAA")] }), parseTs("2025-10-26T20:11:10.000Z"));
    expect(afterCap.rows[0].inPit).toBe(false);

    const red = snapshotAt(
      bundle({
        pits: [pit],
        drivers: [driver(1, "AAA")],
        raceControl: [rc({ date: "2025-10-26T20:10:05.000Z", flag: "RED", scope: "Track", message: "RED FLAG" })],
      }),
      parseTs("2025-10-26T20:10:30.000Z"),
    );
    expect(red.rows[0].status).toBe("STOPPED");
    expect(red.trackFlag?.kind).toBe("red");
  });

  it("excludes laps over 3x the green median from last-lap display", () => {
    const base = {
      driver_number: 1,
      duration_sector_1: 28,
      duration_sector_2: 32,
      duration_sector_3: 20,
      is_pit_out_lap: false,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
      i1_speed: null,
      i2_speed: null,
      st_speed: null,
    };
    const laps: Lap[] = [
      { ...base, lap_number: 1, date_start: "2025-10-26T20:00:00.000Z", lap_duration: 80 },
      { ...base, lap_number: 2, date_start: "2025-10-26T20:01:20.000Z", lap_duration: 80.2 },
      { ...base, lap_number: 3, date_start: "2025-10-26T20:02:40.000Z", lap_duration: 79.8 },
      { ...base, lap_number: 4, date_start: "2025-10-26T20:04:00.000Z", lap_duration: 400 },
    ];
    const snap = snapshotAt(bundle({ laps, drivers: [driver(1, "AAA")] }), parseTs("2025-10-26T20:12:00.000Z"));
    expect(snap.rows[0].lastLap).toBeNull();
    expect(snap.rows[0].lastLapDelta).toBeNull();
  });
});

describe("snapshotAt race order with intervals uses /position", () => {
  function raceLap(dn: number, n: number, startIso: string, dur = 80): Lap {
    return {
      driver_number: dn,
      lap_number: n,
      date_start: startIso,
      lap_duration: dur,
      duration_sector_1: 20,
      duration_sector_2: 38,
      duration_sector_3: 22,
      is_pit_out_lap: false,
      segments_sector_1: null,
      segments_sector_2: null,
      segments_sector_3: null,
      i1_speed: null,
      i2_speed: null,
      st_speed: null,
    };
  }

  const tPos = "2026-11-08T18:16:00.000Z";
  const tNow = parseTs("2026-11-08T18:16:20.000Z");
  const tLaterPos = "2026-11-08T18:16:25.000Z";

  it("keeps a +2 LAPS car at official P19 below +1 LAP cars and does not renumber", () => {
    const nor = driver(4, "NOR");
    const bor = driver(5, "BOR");
    const gas = driver(10, "GAS");
    const per = driver(11, "PER");
    const ham = driver(44, "HAM");
    const snap = snapshotAt(
      bundle({
        drivers: [nor, bor, gas, per, ham],
        laps: [
          raceLap(4, 68, "2026-11-08T18:14:00.000Z"),
          raceLap(44, 68, "2026-11-08T18:14:20.000Z"),
          raceLap(5, 67, "2026-11-08T18:14:40.000Z"),
          raceLap(10, 67, "2026-11-08T18:14:50.000Z"),
          raceLap(11, 67, "2026-11-08T18:15:10.000Z"),
        ],
        intervals: [
          { date: tPos, driver_number: 4, gap_to_leader: 0, interval: 0 },
          { date: tPos, driver_number: 44, gap_to_leader: "+1 LAP", interval: 23.88 },
          { date: tPos, driver_number: 5, gap_to_leader: "+1 LAP", interval: "+1 LAP" },
          { date: tPos, driver_number: 10, gap_to_leader: "+1 LAP", interval: "+1 LAP" },
          { date: tPos, driver_number: 11, gap_to_leader: "+2 LAPS", interval: 28.14 },
        ],
        positions: [
          { date: tPos, driver_number: 4, position: 1 },
          { date: tPos, driver_number: 44, position: 9 },
          { date: tPos, driver_number: 5, position: 10 },
          { date: tPos, driver_number: 10, position: 11 },
          { date: tPos, driver_number: 11, position: 19 },
        ],
      }),
      tNow,
    );
    expect(snap.rows.map((r) => r.driver.name_acronym)).toEqual(["NOR", "HAM", "BOR", "GAS", "PER"]);
    expect(snap.rows.map((r) => r.pos)).toEqual([1, 9, 10, 11, 19]);
    const p = snap.rows.find((r) => r.driver.name_acronym === "PER")!;
    expect(p.pos).toBe(19);
    expect(p.gap).toBe("+2 LAPS");
    expect(p.interval).toBe(28.14);
    const borRow = snap.rows.find((r) => r.driver.name_acronym === "BOR")!;
    expect(borRow.gap).toBe("+1 LAP");
    expect(snap.rows.findIndex((r) => r.driver.name_acronym === "PER")).toBeGreaterThan(
      snap.rows.findIndex((r) => r.driver.name_acronym === "GAS"),
    );
  });

  it("ignores a /position row after the clock so live delay is respected", () => {
    const nor = driver(4, "NOR");
    const per = driver(11, "PER");
    const early = snapshotAt(
      bundle({
        drivers: [nor, per],
        laps: [raceLap(4, 68, "2026-11-08T18:14:00.000Z"), raceLap(11, 67, "2026-11-08T18:15:10.000Z")],
        intervals: [
          { date: tPos, driver_number: 4, gap_to_leader: 0, interval: 0 },
          { date: tPos, driver_number: 11, gap_to_leader: "+2 LAPS", interval: 28.14 },
        ],
        positions: [
          { date: tPos, driver_number: 4, position: 1 },
          { date: tPos, driver_number: 11, position: 11 },
          { date: tLaterPos, driver_number: 11, position: 19 },
        ],
      }),
      tNow,
    );
    expect(early.rows.map((r) => r.driver.name_acronym)).toEqual(["NOR", "PER"]);
    expect(early.rows[1].pos).toBe(11);
    expect(early.rows[1].gap).toBe("+2 LAPS");

    const late = snapshotAt(
      bundle({
        drivers: [nor, per],
        laps: [raceLap(4, 68, "2026-11-08T18:14:00.000Z"), raceLap(11, 67, "2026-11-08T18:15:10.000Z")],
        intervals: [
          { date: tPos, driver_number: 4, gap_to_leader: 0, interval: 0 },
          { date: tPos, driver_number: 11, gap_to_leader: "+2 LAPS", interval: 28.14 },
        ],
        positions: [
          { date: tPos, driver_number: 4, position: 1 },
          { date: tPos, driver_number: 11, position: 11 },
          { date: tLaterPos, driver_number: 11, position: 19 },
        ],
      }),
      parseTs(tLaterPos),
    );
    expect(late.rows[1].pos).toBe(19);
    expect(late.rows[1].gap).toBe("+2 LAPS");
  });

  it("appends a driver with no /position row at the bottom and keeps practice best-lap order", () => {
    const nor = driver(4, "NOR");
    const per = driver(11, "PER");
    const str = driver(18, "STR");
    const race = snapshotAt(
      bundle({
        drivers: [str, per, nor],
        laps: [
          raceLap(4, 68, "2026-11-08T18:14:00.000Z"),
          raceLap(11, 67, "2026-11-08T18:15:10.000Z"),
          raceLap(18, 66, "2026-11-08T18:15:00.000Z"),
        ],
        intervals: [
          { date: tPos, driver_number: 4, gap_to_leader: 0, interval: 0 },
          { date: tPos, driver_number: 11, gap_to_leader: "+2 LAPS", interval: 28.14 },
          { date: tPos, driver_number: 18, gap_to_leader: "+1 LAP", interval: "+1 LAP" },
        ],
        positions: [
          { date: tPos, driver_number: 4, position: 1 },
          { date: tPos, driver_number: 11, position: 19 },
        ],
      }),
      tNow,
    );
    expect(race.rows.map((r) => r.driver.name_acronym)).toEqual(["NOR", "PER", "STR"]);
    expect(race.rows[2].pos).toBe(99);
    expect(race.rows[1].pos).toBe(19);

    const practice = snapshotAt(
      bundle({
        session: session("Practice 1"),
        drivers: [driver(1, "AAA"), driver(44, "BBB")],
        laps: [
          raceLap(1, 2, "2025-10-26T20:04:05.000Z", 80),
          raceLap(44, 2, "2025-10-26T20:04:00.000Z", 70),
        ],
        intervals: [],
        positions: [
          { date: T0, driver_number: 1, position: 1 },
          { date: T0, driver_number: 44, position: 2 },
        ],
      }),
      parseTs("2025-10-26T20:08:00.000Z"),
    );
    expect(practice.rows[0].driver.driver_number).toBe(44);
    expect(practice.rows[0].pos).toBe(1);
    expect(practice.rows[1].gap).toBeCloseTo(10);
  });
});
