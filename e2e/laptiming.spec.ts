import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    mode: string;
    followLive: boolean;
    playing: boolean;
    lapTimingDrivers: number[];
    lapTimingView: string;
    sessionKey: number;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setLapTimingDrivers: (ids: number[]) => void;
  setLapTimingView: (view: string) => void;
};

const START = Date.parse("2026-11-01T20:00:00.000Z");

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadMexicoLapTiming(page: Page): Promise<void> {
  await page.evaluate(
    ({ start }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const drivers = [
        { driver_number: 4, broadcast_name: "NOR", full_name: "Lando Norris", name_acronym: "NOR", team_name: "McLaren", team_colour: "FF8000", first_name: "Lando", last_name: "Norris" },
        { driver_number: 16, broadcast_name: "LEC", full_name: "Charles Leclerc", name_acronym: "LEC", team_name: "Ferrari", team_colour: "E8002D", first_name: "Charles", last_name: "Leclerc" },
        { driver_number: 81, broadcast_name: "PIA", full_name: "Oscar Piastri", name_acronym: "PIA", team_name: "McLaren", team_colour: "FF8000", first_name: "Oscar", last_name: "Piastri" },
        { driver_number: 1, broadcast_name: "VER", full_name: "Max Verstappen", name_acronym: "VER", team_name: "Red Bull", team_colour: "3671C6", first_name: "Max", last_name: "Verstappen" },
        { driver_number: 44, broadcast_name: "HAM", full_name: "Lewis Hamilton", name_acronym: "HAM", team_name: "Ferrari", team_colour: "E8002D", first_name: "Lewis", last_name: "Hamilton" },
      ];
      const lapAt = (dn: number, n: number, dur: number, s1: number, s2: number, s3: number, extra: Record<string, unknown> = {}) => ({
        driver_number: dn,
        lap_number: n,
        date_start: new Date(start + n * 82_000).toISOString(),
        lap_duration: dur,
        duration_sector_1: s1,
        duration_sector_2: s2,
        duration_sector_3: s3,
        is_pit_out_lap: n === 26,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
        i1_speed: 275 + (n % 5),
        i2_speed: 305 + (n % 4),
        st_speed: 330 + (n % 7),
        ...extra,
      });
      const times: Record<number, number[]> = {
        4: [81.4, 80.2, 79.95, 79.81, 79.7, 79.65, 79.62, 79.58, 79.55, 79.51, 79.48, 79.2, 110.2, 108.4, 80.9, 79.4],
        16: [81.6, 80.1, 79.99, 79.84, 79.72, 79.68, 79.6, 79.57, 79.52, 79.5, 79.47, 79.31, 109.8, 107.9, 81.1, 79.5],
        81: [81.5, 80.3, 80.05, 79.9, 79.8, 79.74, 79.7, 79.66, 79.61, 79.55, 79.5, 79.28, 110.5, 108.1, 81.0, 79.45],
      };
      const laps = [];
      const nums = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33, 34, 35, 36];
      for (const dn of [4, 16, 81]) {
        times[dn].forEach((dur, i) => {
          const n = nums[i];
          const s1 = 21.8 + (dur - 79.2) * 0.15;
          const s2 = 36.4 + (dur - 79.2) * 0.4;
          const s3 = dur - s1 - s2;
          laps.push(lapAt(dn, n, dur, s1, s2, s3));
        });
      }
      const stints = [
        { driver_number: 4, stint_number: 1, lap_start: 1, lap_end: 25, compound: "MEDIUM", tyre_age_at_start: 0 },
        { driver_number: 4, stint_number: 2, lap_start: 26, lap_end: 71, compound: "HARD", tyre_age_at_start: 0 },
        { driver_number: 16, stint_number: 1, lap_start: 1, lap_end: 29, compound: "HARD", tyre_age_at_start: 0 },
        { driver_number: 81, stint_number: 1, lap_start: 1, lap_end: 22, compound: "MEDIUM", tyre_age_at_start: 0 },
        { driver_number: 81, stint_number: 2, lap_start: 23, lap_end: 71, compound: "HARD", tyre_age_at_start: 0 },
      ];
      const bundle = {
        meeting: {
          meeting_key: 1,
          meeting_name: "Mexico City Grand Prix",
          circuit_short_name: "Mexico City",
          country_name: "Mexico",
          location: "Mexico City",
          date_start: new Date(start).toISOString(),
          year: 2026,
        },
        session: {
          session_key: 99,
          meeting_key: 1,
          session_name: "Race",
          session_type: "Race",
          date_start: new Date(start).toISOString(),
          date_end: new Date(start + 90 * 60 * 1000).toISOString(),
          circuit_short_name: "Mexico City",
          country_name: "Mexico",
          location: "Mexico City",
          year: 2026,
        },
        weekendSessions: [],
        drivers,
        laps,
        intervals: [
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 4, gap_to_leader: 0, interval: 0 },
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 16, gap_to_leader: 2.1, interval: 2.1 },
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 81, gap_to_leader: 3.2, interval: 1.1 },
        ],
        positions: [
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 4, position: 1 },
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 16, position: 2 },
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 81, position: 5 },
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 1, position: 3 },
          { date: new Date(start + 32 * 82_000).toISOString(), driver_number: 44, position: 8 },
        ],
        stints,
        weekendStints: [],
        pits: [
          { date: new Date(start + 25 * 82_000).toISOString(), driver_number: 4, lap_number: 25, lane_duration: 22, pit_duration: 22, stop_duration: 2.4 },
          { date: new Date(start + 22 * 82_000).toISOString(), driver_number: 81, lap_number: 22, lane_duration: 21, pit_duration: 21, stop_duration: 2.2 },
        ],
        weather: [],
        raceControl: [
          { date: new Date(start + 33 * 82_000).toISOString(), category: "SafetyCar", flag: null, scope: null, message: "SAFETY CAR DEPLOYED", lap_number: 33, driver_number: null },
          { date: new Date(start + 36 * 82_000).toISOString(), category: "Flag", flag: "GREEN", scope: "Track", message: "GREEN FLAG", lap_number: 36, driver_number: null },
        ],
        track: [
          [0, 0],
          [100, 0],
          [100, 80],
          [0, 80],
          [0, 0],
        ],
        corners: [],
        sectorFracs: [0.3, 0.4, 0.3],
      };
      const end = start + 36 * 82_000;
      Object.assign(api.state, {
        bundle,
        start,
        end,
        t: end,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 99,
        year: 2026,
        meetingKey: 1,
      });
      api.setLapTimingDrivers([4, 16, 81]);
      api.setLapTimingView("both");
      api.setClock(end, "code");
    },
    { start: START },
  );
}

test("lap timing three views and teammate stripe on Mexico 2026 replay", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#laptiming");
  await waitForApp(page);
  await loadMexicoLapTiming(page);

  await expect(page.locator("nav button[data-page='laptiming']")).toHaveClass(/active/);
  await expect(page.locator(".lt-drv.lt-stripe")).toContainText("PIA");
  await expect(page.locator(".lt-chip.lt-stripe")).toContainText("PIA");
  await expect(page.locator(".lt-card.lt-stripe")).toBeVisible();
  await expect(page.locator(".lt-views button.on")).toContainText("CHART + TABLE");
  await expect(page.locator(".lt-chart")).toBeVisible();
  await expect(page.locator(".lt-table")).toBeVisible();
  await expect(page.locator(".lt-table")).toContainText("Δ PIA−NOR");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/laptiming_both_teammates_1920.png" });

  await page.locator(".lt-views button[data-view='chart']").click();
  await expect(page.locator(".lt-chart")).toBeVisible();
  await expect(page.locator(".lt-table-panel")).toBeHidden();
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/laptiming_chart_1920.png" });

  await page.locator(".lt-views button[data-view='table']").click();
  await expect(page.locator(".lt-table-panel")).toBeVisible();
  await expect(page.locator(".lt-chart")).toBeHidden();
  await expect(page.locator(".lt-table")).toContainText("SC");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/laptiming_table_1920.png" });
});
