import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    snap: {
      rows: Array<{ status: string; bestLap: number | null }>;
      weather: { air_temperature: number | null } | null;
    } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
  setLapTimingDrivers: (ids: number[]) => void;
  applyLoadedClock: () => void;
};

function driver(
  n: number,
  code: string,
  team: string,
  colour: string,
  first: string,
  last: string,
) {
  return {
    driver_number: n,
    broadcast_name: `${first.toUpperCase()} ${last.toUpperCase()}`,
    full_name: `${first} ${last}`,
    name_acronym: code,
    team_name: team,
    team_colour: colour,
    first_name: first,
    last_name: last,
  };
}

function lap(
  dn: number,
  n: number,
  dateStart: string,
  duration: number | null,
  extra: Record<string, unknown> = {},
) {
  return {
    driver_number: dn,
    lap_number: n,
    date_start: dateStart,
    lap_duration: duration,
    duration_sector_1: duration ? 18.9 : null,
    duration_sector_2: duration ? 36.2 : null,
    duration_sector_3: duration ? 18.5 : null,
    is_pit_out_lap: extra.is_pit_out_lap ?? false,
    segments_sector_1: null,
    segments_sector_2: null,
    segments_sector_3: null,
    i1_speed: 280,
    i2_speed: 300,
    st_speed: duration ? 312 : null,
    ...extra,
  };
}

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

test("São Paulo FP1 session 11405 shows tower, laps, and map cars at 00:45", async ({ page }) => {
  const session = {
    session_key: 11405,
    meeting_key: 1299,
    session_name: "Practice 1",
    session_type: "Practice",
    date_start: "2026-11-06T15:30:00+00:00",
    date_end: "2026-11-06T16:30:00+00:00",
    circuit_short_name: "Interlagos",
    country_name: "Brazil",
    location: "São Paulo",
    year: 2026,
    gmt_offset: "-03:00:00",
  };
  const meeting = {
    meeting_key: 1299,
    meeting_name: "São Paulo Grand Prix",
    meeting_official_name: "FORMULA 1 MSC CRUISES GRANDE PRÊMIO DE SÃO PAULO 2026",
    circuit_short_name: "Interlagos",
    country_name: "Brazil",
    location: "São Paulo",
    date_start: "2026-11-06T15:30:00+00:00",
    year: 2026,
  };
  const drivers = [
    driver(1, "NOR", "McLaren", "FF8000", "Lando", "Norris"),
    driver(3, "VER", "Red Bull Racing", "3671C6", "Max", "Verstappen"),
    driver(5, "BOR", "Kick Sauber", "52E252", "Gabriel", "Bortoleto"),
    driver(6, "HAD", "Racing Bulls", "6692FF", "Isack", "Hadjar"),
  ];
  const laps = [
    lap(1, 1, "2026-11-06T15:31:02.019000+00:00", null, { is_pit_out_lap: true }),
    lap(1, 2, "2026-11-06T15:32:52.806000", 73.661),
    lap(1, 3, "2026-11-06T15:34:06.707000+00:00", 101.926),
    lap(1, 5, "2026-11-06T15:37:54.963000+00:00", 73.42),
    lap(1, 6, "2026-11-06T15:39:08.260000+00:00", 127.958),
    lap(1, 8, "2026-11-06T15:49:32.790000+00:00", 90.1, { is_pit_out_lap: true }),
    lap(1, 20, "2026-11-06T16:10:00.000000+00:00", 74.2, { st_speed: 318 }),
    lap(3, 2, "2026-11-06T15:33:01.100000+00:00", 74.01),
    lap(3, 20, "2026-11-06T16:10:04.000000+00:00", 74.55),
    lap(5, 2, "2026-11-06T15:33:10.200000+00:00", 74.8),
    lap(5, 20, "2026-11-06T16:10:08.000000+00:00", 75.1),
    lap(6, 2, "2026-11-06T15:33:14.500000+00:00", 75.2),
    lap(6, 20, "2026-11-06T16:10:12.000000+00:00", 75.4),
  ];
  const stints = [
    { driver_number: 1, stint_number: 1, lap_start: 1, lap_end: 3, compound: "MEDIUM", tyre_age_at_start: 0 },
    { driver_number: 1, stint_number: 2, lap_start: 4, lap_end: 7, compound: "MEDIUM", tyre_age_at_start: 0 },
    { driver_number: 1, stint_number: 3, lap_start: 8, lap_end: 14, compound: "MEDIUM", tyre_age_at_start: 0 },
    { driver_number: 1, stint_number: 4, lap_start: 15, lap_end: 17, compound: "SOFT", tyre_age_at_start: 0 },
    { driver_number: 1, stint_number: 5, lap_start: 18, lap_end: 33, compound: "SOFT", tyre_age_at_start: 0 },
    { driver_number: 3, stint_number: 1, lap_start: 1, lap_end: 20, compound: "MEDIUM", tyre_age_at_start: 0 },
    { driver_number: 5, stint_number: 1, lap_start: 1, lap_end: 20, compound: "HARD", tyre_age_at_start: 0 },
    { driver_number: 6, stint_number: 1, lap_start: 1, lap_end: 20, compound: "SOFT", tyre_age_at_start: 0 },
  ];
  const weather = [
    {
      date: "2026-11-06T15:15:20.741000+00:00",
      air_temperature: 22.1,
      track_temperature: 38.4,
      wind_speed: 1.2,
      wind_direction: 210,
      humidity: 55,
      rainfall: 0,
      pressure: 1013.2,
    },
    {
      date: "2026-11-06T16:16:00.000000+00:00",
      air_temperature: 21.8,
      track_temperature: 37.9,
      wind_speed: 1.4,
      wind_direction: 200,
      humidity: 56,
      rainfall: 0,
      pressure: 1012.8,
    },
  ];
  const track = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 47) * Math.PI * 2;
    return [Math.cos(a) * 4000, Math.sin(a) * 2200];
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#laptiming");
  await waitForApp(page);
  await page.evaluate(
    ({ session, meeting, drivers, laps, stints, weather, track }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.state.mode = "historical";
      Object.assign(api.state, {
        loading: "",
        error: "",
        lock: null,
        bundle: {
          meeting,
          session,
          weekendSessions: [session],
          drivers,
          laps,
          intervals: [],
          positions: [],
          stints,
          weekendStints: stints,
          pits: [],
          weather,
          raceControl: [],
          track,
          corners: [],
          sectorFracs: [0.28, 0.55, 1],
          locations: drivers.map((d, i) => {
            const a = (i / Math.max(1, drivers.length)) * Math.PI * 2;
            return {
              date: "2026-11-06T16:15:25.000Z",
              driver_number: d.driver_number,
              x: Math.cos(a) * 4000,
              y: Math.sin(a) * 2200,
            };
          }),
        },
      });
      api.applyLoadedClock();
      const start = Date.parse("2026-11-06T15:30:00.000Z");
      api.setClock(start + (45 * 60 + 29) * 1000);
      api.setPlaying(false);
      api.setLapTimingDrivers([1, 3, 5, 6]);
    },
    { session, meeting, drivers, laps, stints, weather, track },
  );

  const loaded = await page.evaluate(() => {
    const snap = (window as unknown as { __f1pw: Hooks }).__f1pw.state.snap;
    return {
      garage: snap?.rows.filter((r) => r.status === "GARAGE").length ?? -1,
      onTrack: snap?.rows.filter((r) => r.status !== "GARAGE").length ?? 0,
      weather: snap?.weather?.air_temperature ?? null,
      best: snap?.rows[0]?.bestLap ?? null,
    };
  });
  expect(loaded.onTrack).toBe(4);
  expect(loaded.garage).toBe(0);
  expect(loaded.weather).toBeCloseTo(22.1, 5);
  expect(loaded.best).toBeCloseTo(73.42, 5);

  await expect(page.locator(".session-clock")).toContainText("00:45:29");
  await expect(page.locator(".lt-table tbody tr").first()).toBeVisible();
  await expect(page.locator(".lt-card").first()).toContainText("NOR");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/saopaulo_fp1_11405_laptiming_0045.png",
    fullPage: true,
  });

  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.setClock(Date.parse("2026-11-06T15:30:00.000Z") + (12 * 60 + 23) * 1000);
  });
  await expect(page.locator(".session-clock")).toContainText("00:12:23");
  await expect(page.locator(".lt-table tbody tr").first()).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/saopaulo_fp1_11405_laptiming_0012.png",
    fullPage: true,
  });

  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.setClock(Date.parse("2026-11-06T15:30:00.000Z") + (45 * 60 + 29) * 1000);
  });
  await page.locator("nav button[data-page='timing']").click();
  await expect(page.locator(".tower tbody tr").first()).toBeVisible();
  await expect(page.locator(".tower .status.garage")).toHaveCount(0);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/saopaulo_fp1_11405_timing_0045.png",
    fullPage: true,
  });

  await page.locator("nav button[data-page='trackmap']").click();
  await expect(page.locator(".page.trackmap svg").first()).toBeVisible();
  await expect.poll(async () => page.locator(".page.trackmap svg .car-dot").count()).toBeGreaterThan(0);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/saopaulo_fp1_11405_trackmap_0045.png",
    fullPage: true,
  });
});
