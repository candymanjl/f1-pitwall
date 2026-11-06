import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    liveSource: string;
    followLive: boolean;
    mode: string;
    liveDebug: {
      mode?: string;
      lastMessageAgeMs?: number | null;
    };
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
};

const START = Date.parse("2026-11-06T19:00:00.000Z");
const NOW = START + 37 * 60_000;
const TRACK: [number, number][] = [
  [0, 0],
  [140, 0],
  [140, 90],
  [0, 90],
  [0, 0],
];
const CARS = [
  { n: 12, code: "ANT", colour: "27F4D2", x: 20, y: 0 },
  { n: 4, code: "NOR", colour: "FF8000", x: 140, y: 30 },
  { n: 16, code: "LEC", colour: "E8002D", x: 80, y: 90 },
] as const;

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadLiveFp2(page: Page, gps: boolean): Promise<void> {
  await page.evaluate(
    ({ start, now, track, cars, gps }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const drivers = cars.map((d) => ({
        driver_number: d.n,
        broadcast_name: d.code,
        full_name: d.code,
        name_acronym: d.code,
        team_name: "Test",
        team_colour: d.colour,
        first_name: d.code,
        last_name: d.code,
      }));
      Object.assign(api.state, {
        bundle: {
          meeting: {
            meeting_key: 1299,
            meeting_name: "São Paulo Grand Prix",
            circuit_short_name: "Interlagos",
            country_name: "Brazil",
            location: "São Paulo",
            date_start: new Date(start).toISOString(),
            year: 2026,
          },
          session: {
            session_key: 11406,
            meeting_key: 1299,
            session_name: "Practice 2",
            session_type: "Practice",
            date_start: new Date(start).toISOString(),
            date_end: new Date(start + 60 * 60_000).toISOString(),
            circuit_short_name: "Interlagos",
            country_name: "Brazil",
            location: "São Paulo",
            year: 2026,
          },
          weekendSessions: [],
          drivers,
          laps: cars.map((d, i) => ({
            driver_number: d.n,
            lap_number: 8,
            date_start: new Date(now - 40_000 - i * 1200).toISOString(),
            lap_duration: null,
            duration_sector_1: 18.9,
            duration_sector_2: null,
            duration_sector_3: null,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          })),
          intervals: [],
          positions: cars.map((d, i) => ({
            date: new Date(now).toISOString(),
            driver_number: d.n,
            position: i + 1,
          })),
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [],
          raceControl: [],
          track,
          corners: [],
          sectorFracs: [0.26, 0.5, 0.24],
          locations: gps
            ? cars.map((d) => ({
                date: new Date(now).toISOString(),
                driver_number: d.n,
                x: d.x,
                y: d.y,
              }))
            : [],
        },
        start,
        end: now,
        t: now,
        mode: "live",
        playing: true,
        followLive: true,
        speed: 1,
        scrubbing: false,
        sessionKey: 11406,
        liveSource: "mqtt",
        liveDebug: {
          mode: "STREAM",
          lastPollAt: now,
          lastCycleMs: 40,
          added: {},
          lastError: "",
          topicRates: { "v1/laps": 1.2, "v1/position": 2 },
          lastMessageAgeMs: gps ? 300 : 12_000,
          tabRole: "leader",
        },
      });
      api.setClock(now, "code");
    },
    { start: START, now: NOW, track: TRACK, cars: CARS, gps },
  );
}

test("live map explains missing OpenF1 GPS then shows dots once samples arrive", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await loadLiveFp2(page, false);

  await expect(page.locator(".replay .badge")).toContainText("live mqtt · silent");
  await expect(page.locator(".replay .badge.live-weak")).toBeVisible();
  await expect(page.locator("svg.track .map-gps-note")).toContainText("Waiting for live positions from OpenF1");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/live_map_waiting_gps_1920.png",
    fullPage: true,
  });

  await page.evaluate(
    ({ now, cars }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.state.liveDebug = {
        ...api.state.liveDebug,
        mode: "STREAM",
        lastMessageAgeMs: 250,
        topicRates: { "v1/laps": 1.2, "v1/location": 8, "v1/position": 2 },
      };
      for (const car of cars) {
        api.ingestLive("v1/location", {
          session_key: 11406,
          driver_number: car.n,
          date: new Date(now).toISOString(),
          x: car.x,
          y: car.y,
        });
      }
      api.setClock(now, "code");
    },
    { now: NOW, cars: CARS },
  );

  await expect(page.locator("svg.track")).toHaveAttribute("data-cars", "3");
  await expect(page.locator("svg.track .map-gps-note")).toHaveCount(0);
  await expect(page.locator(".replay .badge")).toContainText("live mqtt");
  await expect(page.locator(".replay .badge")).not.toContainText("silent");
  await expect(page.locator(".replay .badge.live-ok")).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/live_map_gps_arrived_1920.png",
    fullPage: true,
  });
  await page.locator("svg.track").screenshot({
    path: "/opt/cursor/artifacts/screenshots/live_map_gps_arrived_map_1920.png",
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), NOW);
  await expect(page.locator("svg.track")).toHaveAttribute("data-cars", "3");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/live_map_gps_arrived_1366.png",
    fullPage: true,
  });
});
