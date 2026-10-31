import { describe, expect, it } from "vitest";
import { parseTs } from "../lib/time";
import { countPitsAt, safetyCarBands, snapshotAt, visibleLapTiming } from "./derive";
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
    expect(snap.scBands).toHaveLength(1);
    expect(snap.scBands[0].end).toBe(parseTs(T_GREEN));
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
    i1_speed: null,
    i2_speed: null,
    st_speed: null,
  };
  const start = parseTs(lap.date_start);

  it("hides all sectors one second into the lap", () => {
    const vis = visibleLapTiming(lap, start + 1000);
    expect(vis.s1).toBeNull();
    expect(vis.s2).toBeNull();
    expect(vis.s3).toBeNull();
    expect(vis.segments).toEqual([]);
  });

  it("reveals S1 and its mini-sectors only after sector 1 completes", () => {
    const vis = visibleLapTiming(lap, start + 30_000);
    expect(vis.s1).toBe(30);
    expect(vis.s2).toBeNull();
    expect(vis.s3).toBeNull();
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
    expect(done.segments).toEqual([2049, 2049, 2048, 2048, 2051, 2051]);
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
});
