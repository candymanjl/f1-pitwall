import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    followLive: boolean;
    playing: boolean;
    speed: number;
    mode: string;
    liveSource: string;
    sessionKey: number;
    bundle: { session: { session_key: number }; locations?: { date: string }[]; intervals: { date: string }[] } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
  setScrubbing: (on: boolean) => void;
  setSpeed: (speed: number) => void;
  pinToLive: () => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
};

const START = Date.parse("2026-10-31T20:00:00.000Z");
const LAP1 = Date.parse("2026-10-31T20:00:12.000Z");
const LIVE_EDGE = Date.parse("2026-10-31T21:28:00.000Z");

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadLiveRace(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, lap1, liveEdge }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
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
          date_end: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
          circuit_short_name: "Mexico City",
          country_name: "Mexico",
          location: "Mexico City",
          year: 2026,
        },
        weekendSessions: [],
        drivers: [
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
            driver_number: 44,
            broadcast_name: "HAM",
            full_name: "Lewis Hamilton",
            name_acronym: "HAM",
            team_name: "Ferrari",
            team_colour: "E8002D",
            first_name: "Lewis",
            last_name: "Hamilton",
          },
        ],
        laps: [
          {
            driver_number: 1,
            lap_number: 1,
            date_start: new Date(lap1).toISOString(),
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
          {
            driver_number: 1,
            lap_number: 66,
            date_start: new Date(liveEdge - 70_000).toISOString(),
            lap_duration: null,
            duration_sector_1: 22,
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
        intervals: [
          { date: new Date(liveEdge).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 },
          { date: new Date(liveEdge).toISOString(), driver_number: 44, gap_to_leader: 1.2, interval: 1.2 },
        ],
        positions: [
          { date: new Date(liveEdge).toISOString(), driver_number: 1, position: 1 },
          { date: new Date(liveEdge).toISOString(), driver_number: 44, position: 2 },
        ],
        stints: [],
        weekendStints: [],
        pits: [],
        weather: [],
        raceControl: [],
        locations: [
          { date: new Date(liveEdge).toISOString(), driver_number: 1, x: 40, y: 20 },
          { date: new Date(liveEdge).toISOString(), driver_number: 44, x: 38, y: 18 },
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
      Object.assign(api.state, {
        bundle,
        start,
        end: liveEdge,
        t: liveEdge,
        mode: "live",
        playing: true,
        followLive: true,
        scrubbing: false,
        sessionKey: 5555,
        liveSource: "poll",
        speed: 4,
      });
      api.setClock(liveEdge, "code");
    },
    { start: START, lap1: LAP1, liveEdge: LIVE_EDGE },
  );
}

async function ingestNextTick(page: Page, at: number): Promise<void> {
  await page.evaluate((iso) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.ingestLive("v1/intervals", [
      { date: iso, driver_number: 1, gap_to_leader: 0, interval: 0, session_key: 99 },
      { date: iso, driver_number: 44, gap_to_leader: 1.05, interval: 1.05, session_key: 99 },
    ]);
    api.ingestLive("v1/location", [
      { date: iso, driver_number: 1, x: 52, y: 24, session_key: 99 },
      { date: iso, driver_number: 44, x: 49, y: 22, session_key: 99 },
    ]);
  }, new Date(at).toISOString());
}

test("4x catch-up latches to live polling and never stops as new rows arrive", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await loadLiveRace(page);

  const live = await hooks(page);
  expect(live.state.followLive).toBe(true);
  expect(live.state.playing).toBe(true);
  expect(live.state.t).toBe(LIVE_EDGE);
  expect(live.state.sessionKey).toBe(5555);
  expect(live.state.bundle?.session.session_key).toBe(99);
  await expect(page.locator(".live-btn")).toHaveClass(/on/);
  await expect(page.locator(".replay .badge")).toHaveText("live polling");
  await expect(page.locator(".session-clock")).toContainText("Lap 66 / 71");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_poll_following_1920.png" });

  const scrub = page.locator(".replay input[type='range']");
  const box = await scrub.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.15, box!.y + box!.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => (await hooks(page)).state.followLive).toBe(false);
  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.setSpeed(4);
    api.setPlaying(true);
  });
  await expect(page.locator(".replay .badge")).toHaveText("catch-up 4×");
  await expect(page.locator(".live-btn")).not.toHaveClass(/on/);
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_poll_catchup_1920.png" });

  const later = LIVE_EDGE + 8000;
  await ingestNextTick(page, later);
  const afterPoll = await hooks(page);
  expect(afterPoll.state.end).toBe(later);
  expect(afterPoll.state.followLive).toBe(false);
  expect(afterPoll.state.t).toBeLessThan(LIVE_EDGE);

  await page.evaluate((t) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.setSpeed(16);
    api.state.followLive = false;
    api.setClock(t, "code");
    api.setPlaying(true);
  }, LIVE_EDGE - 2500);

  await expect.poll(async () => (await hooks(page)).state.followLive).toBe(true);
  const latched = await hooks(page);
  expect(latched.state.playing).toBe(true);
  expect(latched.state.t).toBe(later);
  await expect(page.locator(".live-btn")).toHaveClass(/on/);
  await expect(page.locator(".replay .badge")).toHaveText("live polling");

  const evenLater = later + 4000;
  await ingestNextTick(page, evenLater);
  const following = await hooks(page);
  expect(following.state.followLive).toBe(true);
  expect(following.state.playing).toBe(true);
  expect(following.state.t).toBe(evenLater);
  expect(following.state.end).toBe(evenLater);
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_poll_caught_up_1920.png" });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_poll_following_1366.png" });
  await page.evaluate((t) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.setSpeed(4);
    api.setClock(t, "scrub");
    api.setPlaying(true);
  }, LAP1 + 30_000);
  await expect(page.locator(".replay .badge")).toHaveText("catch-up 4×");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_poll_catchup_1366.png" });
});
