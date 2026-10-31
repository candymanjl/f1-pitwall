export type Meeting = {
  meeting_key: number;
  meeting_name: string;
  meeting_official_name?: string;
  circuit_short_name: string;
  country_name: string;
  location: string;
  date_start: string;
  year: number;
};

export type Session = {
  session_key: number;
  meeting_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  circuit_short_name: string;
  country_name: string;
  location: string;
  year: number;
  gmt_offset?: string;
};

export type Driver = {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  first_name: string;
  last_name: string;
};

export type Lap = {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean | null;
  segments_sector_1: Array<number | null> | null;
  segments_sector_2: Array<number | null> | null;
  segments_sector_3: Array<number | null> | null;
  i1_speed: number | null;
  i2_speed: number | null;
  st_speed: number | null;
};

export type Interval = {
  date: string;
  driver_number: number;
  gap_to_leader: number | string | null;
  interval: number | string | null;
};

export type Position = {
  date: string;
  driver_number: number;
  position: number;
};

export type StartingGrid = {
  driver_number: number;
  position?: number;
  grid_position?: number;
  session_key?: number;
  meeting_key?: number;
  lap_duration?: number | null;
};

export type Stint = {
  driver_number: number;
  stint_number: number;
  lap_start: number | null;
  lap_end: number | null;
  compound: string | null;
  tyre_age_at_start: number | null;
  session_key?: number;
};

export type Pit = {
  date: string;
  driver_number: number;
  lap_number: number | null;
  lane_duration: number | null;
  pit_duration: number | null;
  stop_duration: number | null;
};

export type Weather = {
  date: string;
  air_temperature: number | null;
  track_temperature: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  humidity: number | null;
  rainfall: number | null;
};

export type RaceControl = {
  date: string;
  category: string | null;
  flag: string | null;
  scope: string | null;
  message: string | null;
  lap_number: number | null;
  driver_number: number | null;
};

export type LocationSample = {
  date: string;
  driver_number: number;
  x: number;
  y: number;
  z?: number;
};

export type CarSample = {
  date: string;
  driver_number: number;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  n_gear: number | null;
  rpm: number | null;
  drs: number | null;
};

export type SessionBundle = {
  meeting: Meeting;
  session: Session;
  weekendSessions: Session[];
  drivers: Driver[];
  laps: Lap[];
  intervals: Interval[];
  positions: Position[];
  startingGrid?: StartingGrid[];
  stints: Stint[];
  weekendStints: Stint[];
  pits: Pit[];
  weather: Weather[];
  raceControl: RaceControl[];
  track: [number, number][];
  corners: { n: number; x: number; y: number; dist: number }[];
  sectorFracs: [number, number, number];
  /** Racing-line fraction of pit-lane entry, 0 = S/F. */
  pitEntry?: number;
  /** Racing-line fraction of pit-lane exit, 0 = S/F. */
  pitExit?: number;
};

export type FlagMode = "green" | "vsc" | "sc";

export type SectorKind = "overall" | "personal" | "yellow" | "none";

export type TowerRow = {
  pos: number;
  driver: Driver;
  compound: string | null;
  tyreAge: number | null;
  lastLap: number | null;
  bestLap: number | null;
  interval: number | string | null;
  gap: number | string | null;
  status: "ON TRACK" | "IN PIT" | "OUT" | "PIT";
  currentLap: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  s1Kind: SectorKind;
  s2Kind: SectorKind;
  s3Kind: SectorKind;
  segments: number[];
  inPit: boolean;
  retired: boolean;
  pitOut: boolean;
  pits: number;
  progress: number;
  /** Starting grid slot when the session is a race/sprint. */
  gridPos: number | null;
  /** Grid minus current; + gained, − lost, 0 unchanged. Null when not a race/sprint. */
  posChange: number | null;
};

export type TimingSnapshot = {
  now: number;
  rows: TowerRow[];
  leaderLap: number;
  medianGreenLap: number;
  weather: Weather | null;
  bestSectors: {
    s1: { time: number; code: string } | null;
    s2: { time: number; code: string } | null;
    s3: { time: number; code: string } | null;
  };
  flagMode: FlagMode;
  scBands: { start: number; end: number; kind: "SC" | "VSC" }[];
  raceLaps: number;
};

export type PageId =
  | "trackmap"
  | "timing"
  | "telemetry"
  | "racetrace"
  | "pitcircle"
  | "tyres"
  | "strategy";

export const PAGES: { id: PageId; label: string }[] = [
  { id: "trackmap", label: "Track map" },
  { id: "timing", label: "Timing" },
  { id: "telemetry", label: "Telemetry" },
  { id: "racetrace", label: "Race trace" },
  { id: "pitcircle", label: "Pit circle" },
  { id: "tyres", label: "Tyres" },
  { id: "strategy", label: "Strategy" },
];
