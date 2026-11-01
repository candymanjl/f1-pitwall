import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    mode: string;
    followLive: boolean;
    snap: { leaderLap: number; raceLaps: number; rows: { currentLap: number | null }[] } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  applyLoadedClock: () => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const LAP1 = START + 12_000;
const LAP36 = START + 12_000 + 35 * 80_000;
const LAP71 = START + 12_000 + 70 * 80_000;

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function loadMexicoRace(page: Page, mode: "historical" | "live" = "historical"): Promise<void> {
  await page.evaluate(
    ({ start, lap1, lap36, lap71, mode }) => {
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
      const laps = [1, 36, 71].flatMap((n) => {
        const t = n === 1 ? lap1 : n === 36 ? lap36 : lap71;
        return drivers.map((d) => ({
          driver_number: d.driver_number,
          lap_number: n,
          date_start: new Date(t).toISOString(),
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
      });
      api.state.mode = mode;
      api.state.followLive = false;
      Object.assign(api.state, {
        bundle: {
          meeting: {
            meeting_key: 1272,
            meeting_name: "Mexico City Grand Prix",
            meeting_official_name: "FORMULA 1 GRAN PREMIO DE LA CIUDAD DE MÉXICO 2025",
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
            date_end: "2025-10-26T22:00:00.000Z",
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2025,
          },
          weekendSessions: [],
          drivers,
          laps,
          intervals: drivers.map((d) => ({
            date: new Date(lap71).toISOString(),
            driver_number: d.driver_number,
            gap_to_leader: 0,
            interval: 0,
          })),
          positions: drivers.map((d, i) => ({
            date: new Date(lap36).toISOString(),
            driver_number: d.driver_number,
            position: i + 1,
          })),
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [],
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
        },
        start,
        sessionKey: 9877,
        meetingKey: 1272,
        year: 2025,
        playing: false,
        followLive: false,
      });
      api.applyLoadedClock();
      api.setClock(api.state.t, "code");
    },
    { start: START, lap1: LAP1, lap36: LAP36, lap71: LAP71, mode },
  );
}

test("Mexico 2025 historical load opens at mid-race, not the end", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  await loadMexicoRace(page);
  const api = await hooks(page);
  expect(api.state.mode).toBe("historical");
  expect(api.state.t).toBe(LAP36);
  expect(api.state.t).toBeGreaterThan(api.state.start);
  expect(api.state.t).toBeLessThan(api.state.end);
  expect(api.state.snap?.rows[0]?.currentLap).toBe(36);
  expect(api.state.snap?.raceLaps).toBe(71);
  await expect(page.locator(".session-clock")).toContainText("LAP 36/71");
  const scrub = Number(await page.locator("input[type='range']").inputValue());
  expect(scrub).toBeGreaterThan(200);
  expect(scrub).toBeLessThan(800);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/mexico_historical_mid_1920.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/mexico_historical_mid_1366.png",
    fullPage: true,
  });

  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.state.mode = "live";
    api.applyLoadedClock();
    api.setClock(api.state.t, "code");
  });
  const live = await hooks(page);
  expect(live.state.mode).toBe("live");
  expect(live.state.t).toBe(LAP36);
  expect(live.state.t).toBeLessThan(live.state.end);
});

test("refresh of a finished race opens at mid-lap even when data mode is live", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("f1pitwall.dataMode", "live");
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  expect(await page.evaluate(() => localStorage.getItem("f1pitwall.dataMode"))).toBe("live");
  expect((await hooks(page)).state.mode).toBe("live");

  await loadMexicoRace(page, "live");
  let api = await hooks(page);
  expect(api.state.mode).toBe("live");
  expect(api.state.t).toBe(LAP36);
  expect(api.state.t).toBeGreaterThan(api.state.start);
  expect(api.state.t).toBeLessThan(api.state.end);
  expect(api.state.snap?.rows[0]?.currentLap).toBe(36);
  await expect(page.locator(".session-clock")).toContainText("LAP 36/71");

  await page.reload();
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  expect(await page.evaluate(() => localStorage.getItem("f1pitwall.dataMode"))).toBe("live");
  expect((await hooks(page)).state.mode).toBe("live");
  expect((await hooks(page)).state.t).toBe(0);

  await loadMexicoRace(page, "live");
  api = await hooks(page);
  expect(api.state.mode).toBe("live");
  expect(api.state.t).toBe(LAP36);
  expect(api.state.t).toBeLessThan(api.state.end);
  expect(api.state.snap?.rows[0]?.currentLap).toBe(36);
  await expect(page.locator(".session-clock")).toContainText("LAP 36/71");
  const scrub = Number(await page.locator("input[type='range']").inputValue());
  expect(scrub).toBeGreaterThan(200);
  expect(scrub).toBeLessThan(800);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/mexico_historical_refresh_live_1920.png",
    fullPage: true,
  });
});

test("in-progress live session still opens at the newest sample", async ({ page }) => {
  await page.goto("/?e2e=1#trackmap");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  const now = Date.now();
  await page.evaluate(
    ({ start, latest, end }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.state.mode = "live";
      api.state.followLive = false;
      Object.assign(api.state, {
        bundle: {
          meeting: {
            meeting_key: 1,
            meeting_name: "Live Test",
            circuit_short_name: "Test",
            country_name: "Test",
            location: "Test",
            date_start: new Date(start).toISOString(),
            year: 2026,
          },
          session: {
            session_key: 1,
            meeting_key: 1,
            session_name: "Race",
            session_type: "Race",
            date_start: new Date(start).toISOString(),
            date_end: new Date(end).toISOString(),
            circuit_short_name: "Test",
            country_name: "Test",
            location: "Test",
            year: 2026,
          },
          weekendSessions: [],
          drivers: [],
          laps: [
            {
              driver_number: 1,
              lap_number: 12,
              date_start: new Date(latest).toISOString(),
              lap_duration: 80,
              duration_sector_1: null,
              duration_sector_2: null,
              duration_sector_3: null,
              is_pit_out_lap: false,
              segments_sector_1: null,
              segments_sector_2: null,
              segments_sector_3: null,
              i1_speed: null,
              i2_speed: null,
              st_speed: null,
            },
          ],
          intervals: [{ date: new Date(latest).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 }],
          positions: [],
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [],
          raceControl: [],
          track: [],
          corners: [],
          sectorFracs: [0.3, 0.4, 0.3],
        },
        start,
        playing: false,
        followLive: false,
      });
      api.applyLoadedClock();
      api.setClock(api.state.t, "code");
    },
    { start: now - 30 * 60 * 1000, latest: now - 2_000, end: now + 90 * 60 * 1000 },
  );
  const api = await hooks(page);
  expect(api.state.mode).toBe("live");
  expect(api.state.t).toBe(api.state.end);
  expect(api.state.t).toBeGreaterThan(now - 10_000);
});
