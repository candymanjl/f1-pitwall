import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    mode: string;
    followLive: boolean;
    playing: boolean;
    snap: { now: number; weather: { pressure?: number | null } | null } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
  setPlaying: (on: boolean) => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const T_EARLY = Date.parse("2025-10-26T20:08:00.000Z");
const T_UP = Date.parse("2025-10-26T20:20:00.000Z");
const T_STEADY = Date.parse("2025-10-26T20:32:00.000Z");
const T_DOWN = Date.parse("2025-10-26T20:45:00.000Z");
const END = Date.parse("2025-10-26T21:28:00.000Z");

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function loadSession(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, end, tEarly, tUp, tSteady, tDown }) => {
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
      ];
      const weather = [
        {
          date: new Date(start).toISOString(),
          air_temperature: 20.8,
          track_temperature: 36.1,
          wind_speed: 2.4,
          wind_direction: 190,
          humidity: 48,
          rainfall: 0,
          pressure: 1010,
        },
        {
          date: new Date(tEarly).toISOString(),
          air_temperature: 21.0,
          track_temperature: 37.0,
          wind_speed: 3.0,
          wind_direction: 200,
          humidity: 46,
          rainfall: 0,
          pressure: 1010.2,
        },
        {
          date: new Date(tUp).toISOString(),
          air_temperature: 21.4,
          track_temperature: 38.2,
          wind_speed: 4.2,
          wind_direction: 210,
          humidity: 44,
          rainfall: 0,
          pressure: 1013.1,
        },
        {
          date: new Date(tSteady).toISOString(),
          air_temperature: 21.2,
          track_temperature: 37.8,
          wind_speed: 3.8,
          wind_direction: 208,
          humidity: 45,
          rainfall: 0,
          pressure: 1012.8,
        },
        {
          date: new Date(tDown).toISOString(),
          air_temperature: 20.6,
          track_temperature: 36.4,
          wind_speed: 3.1,
          wind_direction: 200,
          humidity: 49,
          rainfall: 0,
          pressure: 1008,
        },
      ];
      Object.assign(api.state, {
        bundle: {
          meeting: {
            meeting_key: 1272,
            meeting_name: "Mexico City Grand Prix",
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            date_start: new Date(start).toISOString(),
            year: 2025,
          },
          session: {
            session_key: 9877,
            meeting_key: 1272,
            session_name: "Race",
            session_type: "Race",
            date_start: new Date(start).toISOString(),
            date_end: new Date(end).toISOString(),
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2025,
          },
          weekendSessions: [],
          drivers,
          laps: [
            {
              driver_number: 1,
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
            },
          ],
          intervals: [],
          positions: [],
          stints: [],
          weekendStints: [],
          pits: [],
          weather,
          raceControl: [],
          track: [
            [0, 0],
            [140, 0],
            [140, 90],
            [0, 90],
            [0, 0],
          ],
          corners: [],
          sectorFracs: [0.3, 0.4, 0.3],
          pitEntry: 0.96,
          pitExit: 0.06,
        },
        start,
        end,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 9877,
        meetingKey: 1272,
        year: 2025,
        selectedDriver: null,
        selectedDrivers: [],
      });
      api.setClock(tUp, "code");
    },
    { start: START, end: END, tEarly: T_EARLY, tUp: T_UP, tSteady: T_STEADY, tDown: T_DOWN },
  );
}

async function waitApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function pressureRow(page: Page) {
  const row = page.locator(".statusbar .wx-pressure");
  await expect(row).toBeVisible();
  return row;
}

async function expectPressure(page: Page, text: string, trend: string, mark: string): Promise<void> {
  const row = await pressureRow(page);
  await expect(row).toContainText(text);
  await expect(row).toHaveAttribute("data-trend", trend);
  await expect(row.locator(".wx-trend")).toHaveText(mark);
}

async function footerFits(page: Page): Promise<void> {
  const fit = await page.locator(".statusbar").evaluate((el) => {
    const host = el.getBoundingClientRect();
    const wx = el.querySelector(".wx-text") as HTMLElement | null;
    const press = el.querySelector(".wx-pressure") as HTMLElement | null;
    const wind = el.querySelector("svg.wind-map")?.getBoundingClientRect();
    const lines = [...(wx?.querySelectorAll(":scope > div") ?? [])].map((node) => {
      const r = node.getBoundingClientRect();
      return { text: node.textContent, w: r.width, h: r.height, wrap: node.scrollWidth - node.clientWidth };
    });
    return {
      hostRight: host.right,
      hostBottom: host.bottom,
      wxRight: wx?.getBoundingClientRect().right ?? 0,
      windRight: wind?.right ?? 0,
      overflowX: el.scrollWidth - el.clientWidth,
      overflowY: el.scrollHeight - el.clientHeight,
      viewW: window.innerWidth,
      viewH: window.innerHeight,
      pressWrap: press ? press.scrollWidth - press.clientWidth : 99,
      lines,
    };
  });
  expect(fit.overflowX).toBeLessThan(8);
  expect(fit.overflowY).toBeLessThan(12);
  expect(fit.wxRight).toBeLessThanOrEqual(fit.hostRight + 4);
  expect(fit.windRight).toBeLessThanOrEqual(fit.hostRight + 4);
  expect(fit.hostBottom).toBeLessThanOrEqual(fit.viewH);
  expect(fit.pressWrap).toBeLessThanOrEqual(1);
  expect(fit.lines.every((line) => line.wrap <= 1)).toBe(true);
}

test("footer air pressure follows scrubbing and live weather", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitApp(page);
  await loadSession(page);

  await expectPressure(page, "1013.1 mbar", "up", "↑");
  await footerFits(page);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_pressure_up_1920.png",
    fullPage: true,
  });
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_pressure_footer_up_1920.png",
  });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_STEADY);
  await expectPressure(page, "1012.8 mbar", "steady", "–");

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_DOWN);
  await expectPressure(page, "1008 mbar", "down", "↓");

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_EARLY);
  await expectPressure(page, "1010.2 mbar", "none", "–");

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), T_UP);
  await expectPressure(page, "1013.1 mbar", "up", "↑");

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), T_UP);
  await expectPressure(page, "1013.1 mbar", "up", "↑");
  await footerFits(page);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_pressure_up_1366.png",
    fullPage: true,
  });
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_pressure_footer_up_1366.png",
  });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_DOWN);
  await expectPressure(page, "1008 mbar", "down", "↓");
  await footerFits(page);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_pressure_down_1366.png",
    fullPage: true,
  });
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_pressure_footer_down_1366.png",
  });

  const liveAt = T_DOWN + 12 * 60_000;
  await page.evaluate(
    ({ liveAt }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      Object.assign(api.state, { mode: "live", followLive: true, playing: true });
      api.ingestLive("v1/weather", [
        {
          date: new Date(liveAt).toISOString(),
          air_temperature: 20.4,
          track_temperature: 36.0,
          wind_speed: 2.8,
          wind_direction: 198,
          humidity: 50,
          rainfall: 0,
          pressure: 1015,
          session_key: 9877,
        },
      ]);
    },
    { liveAt },
  );
  await expectPressure(page, "1015 mbar", "up", "↑");
});
