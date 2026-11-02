import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    page: string;
    playing: boolean;
    bundle: { track: [number, number][] } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  applyLoadedClock: () => void;
};

const START = Date.parse("2025-10-26T20:20:00.000Z");
const TABS = ["laptiming", "timing", "telemetry", "racetrace"] as const;

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function seedThenApplyOutline(page: Page): Promise<void> {
  await page.evaluate((start) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    const driver = {
      driver_number: 1,
      broadcast_name: "VER",
      full_name: "Max Verstappen",
      name_acronym: "VER",
      team_name: "Red Bull",
      team_colour: "3671C6",
      first_name: "Max",
      last_name: "Verstappen",
    };
    const meeting = {
      meeting_key: 1272,
      meeting_name: "Mexico City Grand Prix",
      meeting_official_name: "FORMULA 1 GRAN PREMIO DE LA CIUDAD DE MÉXICO 2025",
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      date_start: new Date(start).toISOString(),
      year: 2025,
    };
    const session = {
      session_key: 9877,
      meeting_key: 1272,
      session_name: "Race",
      session_type: "Race",
      date_start: new Date(start).toISOString(),
      date_end: new Date(start + 2 * 3600_000).toISOString(),
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      year: 2025,
    };
    const weather = {
      date: new Date(start).toISOString(),
      air_temperature: 21.4,
      track_temperature: 38.2,
      wind_speed: 3.6,
      wind_direction: 210,
      humidity: 44,
      rainfall: 0,
      pressure: 1013.1,
    };
    Object.assign(api.state, {
      year: 2025,
      meetingKey: 1272,
      sessionKey: 9877,
      playing: false,
      followLive: false,
      mode: "historical",
      loading: "",
      bundle: {
        meeting,
        session,
        weekendSessions: [session],
        drivers: [driver],
        laps: [
          {
            driver_number: 1,
            lap_number: 12,
            date_start: new Date(start).toISOString(),
            lap_duration: 80,
            duration_sector_1: 22,
            duration_sector_2: 29,
            duration_sector_3: 29,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          },
        ],
        intervals: [],
        positions: [{ driver_number: 1, position: 1, date: new Date(start).toISOString() }],
        stints: [],
        weekendStints: [],
        pits: [],
        weather: [weather],
        raceControl: [],
        track: [],
        corners: [],
        sectorFracs: [0.3, 0.4, 0.3],
        pitEntry: 0.96,
        pitExit: 0.06,
        locations: [],
      },
    });
    api.applyLoadedClock();
    api.setClock(start + 40_000, "code");
  }, START);

  await expect(page.locator("svg.wind-map")).toHaveAttribute("data-outline", "empty");

  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    if (!api.state.bundle) return;
    api.state.bundle = {
      ...api.state.bundle,
      track: [
        [0, 0],
        [120, 0],
        [140, 60],
        [40, 90],
        [0, 0],
      ],
    };
    api.setClock(api.state.t, "code");
  });
}

test.describe("footer wind outline without visiting Track map", () => {
  for (const tab of TABS) {
    test(`Load outline paints on #${tab} while paused`, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`/?e2e=1#${tab}`);
      await waitForApp(page);
      await seedThenApplyOutline(page);

      await expect(page.locator(`nav button[data-page='${tab}']`)).toHaveClass(/active/);
      await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.playing)).toBe(
        false,
      );
      await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.page)).toBe(
        tab,
      );
      await expect(page.locator("svg.wind-map")).toHaveAttribute("data-outline", "ready");
      await expect(page.locator("svg.wind-map path.wind-track")).toBeVisible();
      await expect(page.locator("svg.wind-map")).not.toContainText("No outline");
      await expect(page.locator("nav button[data-page='trackmap']")).not.toHaveClass(/active/);

      if (tab === "laptiming") {
        await page.screenshot({
          path: "/opt/cursor/artifacts/screenshots/outline_laptiming_never_trackmap.png",
          fullPage: true,
        });
        await page.locator("svg.wind-map").screenshot({
          path: "/opt/cursor/artifacts/screenshots/outline_laptiming_wind_closeup.png",
        });
      }
    });
  }
});
