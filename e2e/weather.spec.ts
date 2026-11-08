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
  },
): Promise<void> {
  const weather = Array.from({ length: 12 }, (_, i) => wx(opts.start + i * 5 * 60_000, i >= 6 && i < 9 ? 1 : 0));
  await page.evaluate(
    ({ start, circuit, location, country, mode, weather, sessionKey }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const track: [number, number][] = [
        [0, 0],
        [140, 10],
        [160, 90],
        [40, 110],
        [-20, 50],
        [0, 0],
      ];
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
          drivers: [],
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
    { ...opts, weather },
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
  });
  await page.locator("nav button[data-page='weather']").click();
  await expect(page.locator(".page.weather")).toHaveAttribute("data-mode", "live");
  await expect(page.locator(".wx-mosaic.on")).toBeVisible();
  await expect(page.locator("svg.wx-radar-overlay")).toHaveCount(0);
  await expect(page.locator("[data-radar-outline]")).toHaveCount(0);
  await expect(page.locator("[data-radar-car]")).toHaveCount(0);
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-view", "50");
  await expect(page.locator("button[data-radar-view='50']")).toHaveClass(/on/);
  await expect(page.locator("button[data-radar-view='50']")).toHaveText("50 mi");
  await expect(page.locator("button[data-radar-view='15']")).toHaveText("15 mi");
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-smooth", "off");
  await expect(page.locator(".wx-pin")).toBeVisible();
  await expect(page.locator("[data-radar-scalebar]")).toBeVisible();
  await expect(page.locator("[data-radar-scalebar]")).toContainText("10 mi");
  await expect(page.getByRole("link", { name: "RainViewer" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /bacinger\/f1-circuits/i })).toHaveCount(0);
  await expect(page.getByText(/Forecast rain probability/i)).toBeVisible();
  await expect(page.getByText("Radar archive unavailable for this session")).toHaveCount(0);
  await expect(page.locator("[data-radar-play]")).toHaveText("Play");
  await expect(page.locator("[data-radar-time]")).toContainText("UTC");
  await expect(page.locator("[data-forecast='minute']")).toBeVisible();
  await expect(page.getByText(/Estimated 1 minute line, interpolated from Open-Meteo 15 minute forecast/)).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_e2e_live_1920.png",
    fullPage: true,
  });
  await page.locator(".wx-radar-map").screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_radar_50mi_1920.png",
  });
  await page.locator("button[data-radar-view='15']").click();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-view", "15");
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-smooth", "on");
  await expect(page.locator("button[data-radar-view='15']")).toHaveClass(/on/);
  await expect(page.locator("[data-radar-scalebar]")).toContainText("3 mi");
  await expect(page.locator("svg.wx-radar-overlay")).toHaveCount(0);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_radar_15mi_1920.png",
    fullPage: true,
  });
  await page.locator(".wx-radar-map").screenshot({
    path: "/opt/cursor/artifacts/screenshots/weather_radar_15mi_map_1920.png",
  });
  await page.locator("button[data-radar-view='50']").click();
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-view", "50");
  await expect(page.locator(".wx-radar")).toHaveAttribute("data-radar-smooth", "off");
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
});
