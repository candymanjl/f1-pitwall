import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    followLive: boolean;
    playing: boolean;
    mode: string;
    snap: { rows: { currentLap: number | null }[] } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
  setScrubbing: (on: boolean) => void;
  pinToLive: () => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
};

const START = Date.parse("2026-10-31T20:00:00.000Z");
const LAP1 = Date.parse("2026-10-31T20:00:12.000Z");
const LAP66 = Date.parse("2026-10-31T21:28:00.000Z");

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function loadRace(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, lap1, lap66 }) => {
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
          date_end: "2026-10-31T22:00:00.000Z",
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
            date_start: new Date(lap66 - 70_000).toISOString(),
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
          { date: new Date(lap66).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 },
          { date: new Date(lap66).toISOString(), driver_number: 44, gap_to_leader: 1.2, interval: 1.2 },
        ],
        positions: [
          { date: new Date(lap66).toISOString(), driver_number: 1, position: 1 },
          { date: new Date(lap66).toISOString(), driver_number: 44, position: 2 },
        ],
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
          [0, 0],
        ],
        corners: [],
        sectorFracs: [0.3, 0.4, 0.3],
      };
      Object.assign(api.state, {
        bundle,
        start,
        end: lap66,
        t: lap66,
        mode: "live",
        playing: false,
        followLive: true,
        scrubbing: false,
        sessionKey: 99,
        liveSource: "poll",
      });
      api.setClock(lap66, "code");
    },
    { start: START, lap1: LAP1, lap66: LAP66 },
  );
}

test("scrubbing off the live edge survives incoming poll/MQTT updates", async ({ page }) => {
  await page.goto("/?e2e=1#pitcircle");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  await loadRace(page);

  const before = await hooks(page);
  expect(before.state.t).toBe(LAP66);

  const scrub = page.locator(".replay input[type='range']");
  await scrub.focus();
  const box = await scrub.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 4, box!.y + box!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => (await hooks(page)).state.followLive).toBe(false);
  const afterScrub = await hooks(page);
  expect(afterScrub.state.t).toBeLessThan(LAP1 + 30_000);
  expect(afterScrub.state.t).toBeGreaterThanOrEqual(START);

  await page.evaluate((iso) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.ingestLive("v1/intervals", [
      { date: iso, driver_number: 1, gap_to_leader: 0, interval: 0 },
      { date: iso, driver_number: 44, gap_to_leader: 1.1, interval: 1.1 },
    ]);
    api.ingestLive("v1/laps", {
      driver_number: 1,
      lap_number: 67,
      date_start: iso,
      lap_duration: null,
    });
  }, new Date(LAP66 + 4000).toISOString());

  await page.waitForTimeout(1200);

  const afterLive = await hooks(page);
  expect(afterLive.state.followLive).toBe(false);
  expect(afterLive.state.t).toBe(afterScrub.state.t);
  expect(afterLive.state.t).toBeLessThan(LAP66);

  const headline = await page.locator(".session-clock").textContent();
  expect(headline).toMatch(/Lap 1\b/);
  expect(headline).not.toMatch(/Lap 66/);

  await page.getByRole("button", { name: "LIVE" }).click();
  const pinned = await hooks(page);
  expect(pinned.state.followLive).toBe(true);
  expect(pinned.state.t).toBeGreaterThanOrEqual(LAP66);
});
