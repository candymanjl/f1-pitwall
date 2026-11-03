import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    loading: string;
    loadProgress: { done: number; total: number; label: string; pct: number } | null;
    playing: boolean;
    followLive: boolean;
    mode: string;
    lapTimingDrivers: number[];
    lapTimingView: string;
    bundle: { meeting: { meeting_name: string }; session: { session_name: string } } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setLapTimingDrivers: (ids: number[]) => void;
  setLapTimingView: (view: string) => void;
};

const START = Date.parse("2026-10-25T20:00:00.000Z");

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadAustinRace(page: Page): Promise<void> {
  await page.evaluate(
    ({ start }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const drivers = [
        { driver_number: 4, broadcast_name: "NOR", full_name: "Lando Norris", name_acronym: "NOR", team_name: "McLaren", team_colour: "FF8000", first_name: "Lando", last_name: "Norris" },
        { driver_number: 16, broadcast_name: "LEC", full_name: "Charles Leclerc", name_acronym: "LEC", team_name: "Ferrari", team_colour: "E8002D", first_name: "Charles", last_name: "Leclerc" },
        { driver_number: 1, broadcast_name: "VER", full_name: "Max Verstappen", name_acronym: "VER", team_name: "Red Bull", team_colour: "3671C6", first_name: "Max", last_name: "Verstappen" },
        { driver_number: 44, broadcast_name: "HAM", full_name: "Lewis Hamilton", name_acronym: "HAM", team_name: "Ferrari", team_colour: "E8002D", first_name: "Lewis", last_name: "Hamilton" },
        { driver_number: 81, broadcast_name: "PIA", full_name: "Oscar Piastri", name_acronym: "PIA", team_name: "McLaren", team_colour: "FF8000", first_name: "Oscar", last_name: "Piastri" },
      ];
      const laps = drivers.flatMap((d) =>
        Array.from({ length: 12 }, (_, i) => {
          const n = i + 20;
          const dur = 96.2 + d.driver_number / 80 + i * 0.02;
          return {
            driver_number: d.driver_number,
            lap_number: n,
            date_start: new Date(start + n * 97_000).toISOString(),
            lap_duration: dur,
            duration_sector_1: 25.1,
            duration_sector_2: 38.4,
            duration_sector_3: dur - 63.5,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: 280,
            i2_speed: 300,
            st_speed: 330,
          };
        }),
      );
      const bundle = {
        meeting: {
          meeting_key: 1295,
          meeting_name: "United States Grand Prix",
          circuit_short_name: "Austin",
          country_name: "United States",
          location: "Austin",
          date_start: new Date(start).toISOString(),
          year: 2026,
        },
        session: {
          session_key: 11400,
          meeting_key: 1295,
          session_name: "Race",
          session_type: "Race",
          date_start: new Date(start).toISOString(),
          date_end: new Date(start + 90 * 60 * 1000).toISOString(),
          circuit_short_name: "Austin",
          country_name: "United States",
          location: "Austin",
          year: 2026,
        },
        weekendSessions: [],
        drivers,
        laps,
        intervals: [],
        positions: drivers.map((d, i) => ({
          date: new Date(start + 32 * 97_000).toISOString(),
          driver_number: d.driver_number,
          position: i + 1,
        })),
        stints: drivers.map((d) => ({
          driver_number: d.driver_number,
          stint_number: 1,
          lap_start: 1,
          lap_end: 56,
          compound: "HARD",
          tyre_age_at_start: 0,
        })),
        weekendStints: [],
        pits: [],
        weather: [],
        raceControl: [],
        track: [
          [0, 0],
          [100, 0],
          [100, 80],
          [0, 80],
          [0, 0],
        ],
        corners: [],
        sectorFracs: [0.3, 0.4, 0.3],
        pitEntry: 0.96,
        pitExit: 0.06,
        locations: [],
      };
      const end = start + 32 * 97_000;
      Object.assign(api.state, {
        bundle,
        start,
        end,
        t: end,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 11400,
        year: 2026,
        meetingKey: 1295,
        meetings: [bundle.meeting],
        sessions: [bundle.session],
        loading: "",
        loadProgress: null,
        listsBusy: false,
      });
      api.setLapTimingDrivers([]);
      api.setLapTimingView("both");
      api.setClock(end, "code");
    },
    { start: START },
  );
}

async function cycleOverlay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.state.loading = "Loading session…";
    api.state.loadProgress = { done: 4, total: 10, label: "laps", pct: 40 };
    api.setClock(api.state.t, "code");
  });
  await expect(page.locator(".overlay.is-visible")).toHaveCount(1);
  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.state.loading = "";
    api.state.loadProgress = null;
    api.setClock(api.state.t, "code");
  });
  await expect(page.locator(".overlay.is-visible")).toHaveCount(0);
  await expect(page.locator(".overlay")).toHaveAttribute("inert", "");
}

test("Lap Timing compare checkboxes work after the loading overlay on USGP 2026 Race", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#laptiming");
  await waitForApp(page);
  await loadAustinRace(page);
  await cycleOverlay(page);

  await expect(page.locator(".session-title")).toContainText("UNITED STATES");
  await expect(page.locator(".lt-drv")).toHaveCount(5);

  const hit = await page.evaluate(() => {
    const row = document.querySelector(".lt-drv") as HTMLElement | null;
    if (!row) return "missing";
    const box = row.getBoundingClientRect();
    const el = document.elementFromPoint(box.left + 8, box.top + box.height / 2);
    return el ? `${el.className} ${el.tagName}` : "none";
  });
  expect(hit.toLowerCase()).not.toContain("overlay");

  await page.locator(".lt-drv", { hasText: "LEC" }).click();
  await page.locator(".lt-drv", { hasText: "VER" }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.lapTimingDrivers)).toEqual([
    4, 16, 1,
  ]);
  await expect(page.locator(".lt-count")).toContainText("3 SELECTED");
  await expect(page.locator(".lt-chip")).toHaveCount(3);
  await expect(page.locator(".lt-card")).toHaveCount(3);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/laptiming_usgp_compare_3drivers_1920.png",
    fullPage: true,
  });

  for (const view of ["chart", "table", "both"] as const) {
    await page.locator(`.lt-views button[data-view='${view}']`).click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.lapTimingDrivers)).toEqual([
      4, 16, 1,
    ]);
    await expect(page.locator(".lt-chip")).toHaveCount(3);
  }

  await page.locator("nav button[data-page='trackmap']").click();
  await expect(page.locator(".page.trackmap")).toBeVisible();
  await expect(page.locator("#load-session")).toBeEnabled();
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.playing)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Pause" }).click();
  await page.locator("nav button[data-page='timing']").click();
  await expect(page.locator(".page.timing")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".modal")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".modal")).toHaveCount(0);

  await page.locator("nav button[data-page='laptiming']").click();
  await expect(page.locator(".lt-chip")).toHaveCount(3);
  await page.locator(".lt-drv", { hasText: "HAM" }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.lapTimingDrivers)).toEqual([
    4, 16, 1, 44,
  ]);
});
