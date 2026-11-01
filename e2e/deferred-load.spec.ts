import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    sessionKey: number;
    loading: string;
    listsBusy: boolean;
    bundle: { session: { session_key: number; session_name: string }; meeting: { meeting_name: string } } | null;
    meetings: { meeting_key: number; meeting_name: string }[];
    sessions: { session_key: number; session_name: string }[];
    page: string;
  };
  changeSession: (key: number) => void;
  applyLoadedClock: () => void;
  setClock: (t: number) => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const PAGES = ["trackmap", "timing", "telemetry", "racetrace", "pitcircle", "tyres", "strategy"] as const;
const SIZES = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "1366", width: 1366, height: 768 },
  { name: "ipad", width: 1024, height: 768 },
] as const;

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function seedSession(page: Page): Promise<void> {
  await page.evaluate((start) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    const drivers = [
      {
        driver_number: 1,
        broadcast_name: "VER",
        full_name: "Max Verstappen",
        name_acronym: "VER",
        team_name: "Red Bull",
        team_colour: "3671C6",
        first_name: "Max",
        last_name: "Verstappen",
      },
      {
        driver_number: 4,
        broadcast_name: "NOR",
        full_name: "Lando Norris",
        name_acronym: "NOR",
        team_name: "McLaren",
        team_colour: "FF8000",
        first_name: "Lando",
        last_name: "Norris",
      },
    ];
    const laps = drivers.map((d) => ({
      driver_number: d.driver_number,
      lap_number: 1,
      date_start: new Date(start + 12_000).toISOString(),
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
    }));
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
    const race = {
      session_key: 9877,
      meeting_key: 1272,
      session_name: "Race",
      session_type: "Race",
      date_start: new Date(start).toISOString(),
      date_end: new Date(start + 2 * 60 * 60 * 1000).toISOString(),
      circuit_short_name: "Mexico City",
      country_name: "Mexico",
      location: "Mexico City",
      year: 2025,
    };
    const fp1 = { ...race, session_key: 9871, session_name: "Practice 1", session_type: "Practice" };
    Object.assign(api.state, {
      year: 2025,
      meetingKey: 1272,
      sessionKey: 9877,
      meetings: [meeting],
      sessions: [fp1, race],
      loading: "",
      listsBusy: false,
      bundle: {
        meeting,
        session: race,
        weekendSessions: [fp1, race],
        drivers,
        laps,
        intervals: [],
        positions: drivers.map((d) => ({
          driver_number: d.driver_number,
          position: d.driver_number === 1 ? 1 : 2,
          date: new Date(start + 12_000).toISOString(),
        })),
        stints: [],
        weekendStints: [],
        pits: [],
        weather: [],
        raceControl: [],
        track: [
          [0, 0],
          [100, 0],
          [100, 80],
          [0, 80],
        ],
        corners: [],
        sectorFracs: [0.3, 0.6, 1],
        pitEntry: 0.96,
        pitExit: 0.06,
        locations: [],
      },
    });
    api.state.page = "trackmap";
    api.applyLoadedClock();
    api.setClock(start + 40_000);
  }, START);
}

test.describe("deferred session Load button", () => {
  for (const size of SIZES) {
    test(`pickers do not fetch; Load stays next to them at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/?e2e=1#trackmap");
      await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
        true,
      );
      await seedSession(page);
      await page.locator("nav button[data-page='trackmap']").click();
      await expect(page.locator("#load-session")).toBeVisible();
      await expect(page.locator("#load-session")).toHaveText("Load");
      await expect(page.locator("#load-session")).toBeEnabled();

      const before = (await hooks(page)).state.bundle?.session.session_key;
      await page.locator("#session").selectOption("9871");
      const after = await hooks(page);
      expect(after.state.sessionKey).toBe(9871);
      expect(after.state.bundle?.session.session_key).toBe(before);
      expect(after.state.loading).toBe("");
      await expect(page.locator("#load-session")).toHaveClass(/pending/);
      await expect(page.locator(".session-title")).toContainText("MÉXICO");

      await page.screenshot({
        path: `/opt/cursor/artifacts/screenshots/deferred_load_dirty_${size.name}.png`,
        fullPage: true,
      });

      await page.evaluate(() => {
        const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
        api.state.loading = "Loading timing…";
        api.setClock(api.state.t);
      });
      await expect(page.locator("#load-session")).toBeDisabled();
      await expect(page.locator("#load-session")).toHaveText("Loading timing…");
      await expect(page.locator(".overlay.is-visible")).toHaveCount(0);
      await page.screenshot({
        path: `/opt/cursor/artifacts/screenshots/deferred_load_progress_${size.name}.png`,
        fullPage: true,
      });

      await page.evaluate(() => {
        const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
        api.state.loading = "";
        api.setClock(api.state.t);
      });

      for (const id of PAGES) {
        await page.locator(`nav button[data-page='${id}']`).click();
        await expect(page.locator("#load-session")).toBeVisible();
        const box = await page.locator("#load-session").boundingBox();
        expect(box?.width).toBeGreaterThan(40);
        expect(box?.y).toBeLessThan(size.height / 2);
      }
      await page.screenshot({
        path: `/opt/cursor/artifacts/screenshots/deferred_load_strategy_${size.name}.png`,
        fullPage: true,
      });
    });
  }
});
