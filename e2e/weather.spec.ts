import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    mode: string;
    t: number;
    start: number;
    end: number;
    playing: boolean;
    followLive: boolean;
    bundle: unknown;
    snap: unknown;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
};

const MEXICO = Date.parse("2025-10-26T20:00:00.000Z");
const AUSTIN = Date.parse("2025-10-19T19:00:00.000Z");
/** Resampled bacinger Sao Paulo outline in local metres (e2e OpenF1 stand-in). */
const INTERLAGOS_METRES: [number, number][] = [
  [-189.9, -308.5],
  [-145, -481.2],
  [-52.1, -590.3],
  [103.5, -589.2],
  [243.3, -497.4],
  [293.2, -326.1],
  [337, -153.1],
  [382.7, 19.4],
  [360.2, 166.2],
  [191.6, 147.2],
  [83.2, 5.6],
  [-22.6, -138.1],
  [-172.5, -102.6],
  [-159.2, 49.3],
  [-66.6, 96.5],
  [-153.4, 245.7],
  [-39.9, 192.8],
  [112.6, 230.9],
  [196.6, 385],
  [33.3, 434],
  [-131.5, 369.5],
  [-209.8, 214.6],
  [-249.5, 40.7],
  [-232, -135],
];
const PENTAGON: [number, number][] = [
  [0, 0],
  [140, 10],
  [160, 90],
  [40, 110],
  [-20, 50],
  [0, 0],
];
/** Long enough to attempt a fit, wrong shape so RMS is withheld. */
const BAD_TRACK: [number, number][] = [
  [0, 0],
  [80, 8],
  [140, 10],
  [155, 50],
  [160, 90],
  [100, 100],
  [40, 110],
  [10, 80],
  [-20, 50],
  [-10, 25],
  [0, 0],
];
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAhUlEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2kNHhQAAAABJRU5ErkJggg==",
  "base64",
);

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

function wx(t: number, rain = 0) {
  return {
    date: new Date(t).toISOString(),
    air_temperature: 24.6,
    track_temperature: 31.8,
    wind_speed: 3.2,
    wind_direction: 315,
    humidity: 76,
    rainfall: rain,
    pressure: 1013.2,
  };
}

async function stubWeatherApis(page: Page): Promise<void> {
  await page.route("https://api.rainviewer.com/public/weather-maps.json", async (route) => {
    const now = Math.floor(Date.now() / 1000);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: Array.from({ length: 12 }, (_, i) => ({
            time: now - (11 - i) * 600,
            path: `/v2/radar/test${i}`,
          })),
        },
      }),
    });
  });
  await page.route(/tilecache\.rainviewer\.com/, async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
  });
  await page.route(/open-meteo\.com/, async (route) => {
    const t0 = Math.floor(Date.now() / (15 * 60_000)) * 15 * 60_000;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hourly: {
          time: Array.from({ length: 12 }, (_, i) => new Date(t0 + i * 3600_000).toISOString().slice(0, 16)),
          precipitation_probability: [12, 15, 20, 32, 45, 52, 47, 38, 30, 22, 18, 14],
          precipitation: [0, 0.1, 0.4, 1.2, 0.8, 0.2, 0, 0, 0, 0.1, 0, 0],
          cloud_cover: [40, 50, 60, 80, 70, 55, 40, 30, 20, 25, 30, 35],
          wind_speed_10m: [3, 3.2, 3.5, 4, 3.8, 3.1, 2.8, 2.5, 2.4, 2.6, 2.9, 3],
        },
        minutely_15: {
          time: Array.from({ length: 8 }, (_, i) => new Date(t0 + i * 15 * 60_000).toISOString().slice(0, 16)),
          precipitation: [0, 0.2, 0.5, 0.9, 0.7, 0.3, 0.1, 0],
          precipitation_probability: [8, 18, 34, 58, 49, 31, 16, 9],
        },
      }),
    });
  });
  await page.route(/mesonet\.agron\.iastate\.edu/, async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: PIXEL });
  });
}

async function loadSession(
  page: Page,
  opts: {
    start: number;
    circuit: string;
    location: string;
    country: string;
    mode: "historical" | "live";
    sessionKey: number;
    track?: [number, number][];
    withCar?: boolean;
  },
): Promise<void> {
  const weather = Array.from({ length: 12 }, (_, i) => wx(opts.start + i * 5 * 60_000, i >= 6 && i < 9 ? 1 : 0));
  await page.evaluate(
    ({ start, circuit, location, country, mode, weather, sessionKey, track, withCar }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const t = start + 40 * 60_000;
      const drivers = withCar
        ? [
            {
              driver_number: 1,
              broadcast_name: "VER",
              full_name: "Max Verstappen",
              name_acronym: "VER",
              team_name: "Red Bull Racing",
              team_colour: "3671C6",
              first_name: "Max",
              last_name: "Verstappen",
            },
          ]
        : [];
      const locations = withCar
        ? [
            { driver_number: 1, x: track[0][0], y: track[0][1], date: new Date(t - 400).toISOString() },
            { driver_number: 1, x: track[1][0], y: track[1][1], date: new Date(t + 400).toISOString() },
          ]
        : [];
      Object.assign(api.state, {
        bundle: {
          meeting: {
            meeting_key: sessionKey,
            meeting_name: `${location} Grand Prix`,
            circuit_short_name: circuit,
            country_name: country,
            location,
            date_start: new Date(start).toISOString(),
            year: 2025,
          },
          session: {
            session_key: sessionKey,
            meeting_key: sessionKey,
            session_name: "Race",
            session_type: "Race",
            date_start: new Date(start).toISOString(),
            date_end: new Date(start + 90 * 60_000).toISOString(),
            circuit_short_name: circuit,
            country_name: country,
            location,
            year: 2025,
          },
          weekendSessions: [],
          drivers,
          locations,
          laps: [],
          intervals: [],
          positions: [],
          stints: [],
          weekendStints: [],
          pits: [],
          weather,
          raceControl: [],
          track,
          corners: [],
          sectorFracs: [0.3, 0.4, 0.3],
          pitEntry: 0.96,
          pitExit: 0.06,
        },
        start,
        end: start + 90 * 60_000,
        latestMs: Number.NaN,
        mode,
        playing: false,
        followLive: false,
        sessionKey,
      });
      api.setClock(start + 40 * 60_000, "code");
    },
    { ...opts, weather, track: opts.track ?? PENTAGON, withCar: opts.withCar ?? false },
  );
}

test("Weather page replay: Mexico archive unavailable and Austin IEM radar", async ({ page }) => {
  test.setTimeout(90_000);
  await stubWeatherApis(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#weather");
  await waitForApp(page);

  await loadSession(page, {
    start: MEXICO,
    circuit: "Mexico City",
    location: "Mexico City",
    country: "Mexico",
    mode: "historical",
    sessionKey: 9877,
  });
  await page.locator("nav button[data-page='weather']").click();
  await expect(page.locator(".page.weather")).toHaveAttribute("data-mode", "replay");
  await expect(page.locator("[data-card='air']")).toContainText("24.6");
  await expect(page.getByText("Radar archive unavailable for this session")).toBeVisible();
  await expect(page.locator(".wx-mosaic")).toHaveCount(0);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_mexico_1920.png",
    fullPage: true,
  });

  await loadSession(page, {
    start: AUSTIN,
    circuit: "Austin",
    location: "Austin",
    country: "United States",
    mode: "historical",
    sessionKey: 9951,
  });
  await expect(page.locator(".page.weather")).toHaveAttribute("data-mode", "replay");
  await expect(page.locator("img.wx-iem.on")).toBeVisible();
  await expect(page.getByText("Radar archive unavailable for this session")).toHaveCount(0);
  await expect(page.locator("[data-radar-play]")).toBeVisible();
  await expect(page.locator("[data-radar-time]")).toContainText("UTC");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_austin_1920.png",
    fullPage: true,
  });
  await page.locator("[data-radar-play]").click();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-playing", "true");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_austin_playing_1920.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_austin_1366.png",
    fullPage: true,
  });
});

test("Weather page live: RainViewer radar panel", async ({ page }) => {
  test.setTimeout(90_000);
  await stubWeatherApis(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#weather");
  await waitForApp(page);
  await loadSession(page, {
    start: Date.now() - 30 * 60_000,
    circuit: "Interlagos",
    location: "São Paulo",
    country: "Brazil",
    mode: "live",
    sessionKey: 11405,
    track: INTERLAGOS_METRES,
    withCar: true,
  });
  await page.locator("nav button[data-page='weather']").click();
  await expect(page.locator(".page.weather")).toHaveAttribute("data-mode", "live");
  await expect(page.locator(".wx-mosaic.on")).toBeVisible();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-overlay", "on");
  await expect(page.locator("[data-radar-outline]")).toBeVisible();
  await expect(page.locator("[data-radar-car='1']")).toBeVisible();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-view", "wide");
  await expect(page.locator("button[data-radar-view='wide']")).toHaveClass(/on/);
  await expect(page.getByRole("link", { name: /bacinger\/f1-circuits/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "RainViewer" }).first()).toBeVisible();
  await expect(page.getByText(/Forecast rain probability/i)).toBeVisible();
  await expect(page.getByText("Radar archive unavailable for this session")).toHaveCount(0);
  await expect(page.locator("[data-radar-play]")).toHaveText("Play");
  await expect(page.locator("[data-radar-time]")).toContainText("UTC");
  await expect(page.locator("[data-forecast='minute']")).toBeVisible();
  await expect(page.getByText(/Estimated 1 minute line, interpolated from Open-Meteo 15 minute forecast/)).toBeVisible();
  await expect(page.locator("svg.wx-radar-overlay")).toHaveAttribute("data-fit", /Fit RMS /);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_live_1920.png",
    fullPage: true,
  });
  await page.locator(".wx-radar-map").screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_radar_overlay_wide_1920.png",
  });
  await page.locator("button[data-radar-view='track']").click();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-view", "track");
  await expect(page.locator("[data-radar-outline]")).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_radar_overlay_track_1920.png",
    fullPage: true,
  });
  await page.locator(".wx-radar-map").screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_radar_overlay_track_map_1920.png",
  });
  await page.locator("button[data-radar-view='wide']").click();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-view", "wide");
  await page.locator("[data-forecast='minute']").hover({ position: { x: 120, y: 40 } });
  await expect(page.locator(".wx-minute-tip.on")).toContainText("estimated");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_live_forecast_1920.png",
    fullPage: true,
  });
  await page.locator("[data-radar-speed='2']").click();
  await page.locator("[data-radar-play]").click();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-playing", "true");
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-index", "0");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_live_playing_1920.png",
    fullPage: true,
  });
  await expect.poll(async () => page.locator(".wx-radar").getAttribute("data-radar-index")).not.toBe("0");
  await expect(page.locator("[data-radar-time]")).toContainText("UTC");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_live_midloop_1920.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_live_1366.png",
    fullPage: true,
  });

  await page.evaluate((track) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    if (api.state.bundle && typeof api.state.bundle === "object") {
      (api.state.bundle as { track: [number, number][] }).track = track;
    }
    api.setClock(api.state.t, "code");
  }, BAD_TRACK);
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-overlay", "off");
  await expect(page.locator(".wx-overlay-note")).toContainText("withheld");
});
