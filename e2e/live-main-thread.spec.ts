import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    end: number;
    mode: string;
    followLive: boolean;
    playing: boolean;
    bundle: { session: { date_end: string } } | null;
    snap: { rows: Array<{ status: string; lastLap: number | null }>; trackFlag?: { kind: string } } | null;
    latestMs: number;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  ingestLive: (topic: string, payload: unknown) => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const DATE_END = Date.parse("2025-10-26T21:00:00.000Z");
const LIVE_NOW = Date.parse("2025-10-26T21:18:00.000Z");

async function waitApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

test("startup stays empty until Load; live follow continues past date_end", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitApp(page);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.bundle)).toBeNull();
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_startup_empty_1920.png", fullPage: true });

  await page.evaluate(
    ({ start, dateEnd, liveNow }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
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
            date_end: new Date(dateEnd).toISOString(),
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2025,
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
          ],
          laps: [
            {
              driver_number: 1,
              lap_number: 48,
              date_start: new Date(dateEnd - 90_000).toISOString(),
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
          intervals: [{ date: new Date(dateEnd - 2_000).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 }],
          positions: [{ date: new Date(dateEnd - 2_000).toISOString(), driver_number: 1, position: 1 }],
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [],
          raceControl: [
            {
              date: new Date(dateEnd + 60_000).toISOString(),
              category: "Flag",
              flag: "RED",
              scope: "Track",
              message: "RED FLAG",
              lap_number: 49,
              driver_number: null,
              sector: null,
            },
          ],
          track: [
            [0, 0],
            [140, 0],
            [140, 90],
            [0, 90],
            [0, 0],
          ],
          corners: [],
          sectorFracs: [0.3, 0.4, 0.3],
          locations: [],
        },
        start,
        end: dateEnd,
        latestMs: dateEnd - 2_000,
        mode: "live",
        playing: true,
        followLive: true,
        sessionKey: 9877,
        meetingKey: 1272,
        year: 2025,
      });
      api.setClock(dateEnd - 2_000, "code");
      api.ingestLive("v1/location", [
        { date: new Date(liveNow).toISOString(), driver_number: 1, x: 40, y: 20, session_key: 9877 },
      ]);
      api.setClock(liveNow, "code");
    },
    { start: START, dateEnd: DATE_END, liveNow: LIVE_NOW },
  );

  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.end)).toBe(
    LIVE_NOW,
  );
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.t)).toBe(
    LIVE_NOW,
  );
  const flag = page.locator(".statusbar .flag-indicator");
  await expect(flag).toHaveAttribute("data-kind", "red");
  await expect(page.locator(".statusbar .flag-name")).toHaveText("RED FLAG");
  await expect(page.locator("table.tower .status")).toHaveText("STOPPED");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_red_past_end_1920.png", fullPage: true });
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/live_red_past_end_footer_1920.png",
  });
});
