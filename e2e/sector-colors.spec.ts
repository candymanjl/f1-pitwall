import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    page: string;
    playing: boolean;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const MID = Date.parse("2025-10-26T20:20:00.000Z");

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function seedReplay(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, mid }) => {
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
              lap_number: 18,
              date_start: new Date(mid).toISOString(),
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
          positions: [{ driver_number: 1, position: 1, date: new Date(mid).toISOString() }],
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [
            {
              date: new Date(mid).toISOString(),
              air_temperature: 21.4,
              track_temperature: 38.2,
              wind_speed: 3.6,
              wind_direction: 210,
              humidity: 44,
              rainfall: 0,
              pressure: 1013.1,
            },
          ],
          raceControl: [],
          track: [
            [0, 0],
            [180, 0],
            [220, 40],
            [200, 110],
            [80, 140],
            [0, 70],
            [0, 0],
          ],
          corners: [],
          sectorFracs: [0.28, 0.4, 0.32],
          pitEntry: 0.96,
          pitExit: 0.06,
          locations: [],
        },
      });
      api.setClock(mid + 40_000, "code");
    },
    { start: START, mid: MID },
  );
}

test("Track map and wind mini-map paint sector-colored outlines", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await seedReplay(page);

  const map = page.locator("svg.track");
  await expect(map.locator("path.track-s1")).toHaveAttribute("stroke", "#e10600");
  await expect(map.locator("path.track-s2")).toHaveAttribute("stroke", "#eab308");
  await expect(map.locator("path.track-s3")).toHaveAttribute("stroke", "#3b82f6");
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.playing)).toBe(
    false,
  );
  await expect(page.locator("nav button[data-page='trackmap']")).toHaveClass(/active/);

  const wind = page.locator("svg.wind-map");
  await expect(wind.locator("path.track-s1")).toHaveAttribute("stroke", "#e10600");
  await expect(wind.locator("path.track-s2")).toHaveAttribute("stroke", "#eab308");
  await expect(wind.locator("path.track-s3")).toHaveAttribute("stroke", "#3b82f6");
  await expect(wind).toHaveAttribute("data-outline", "ready");

  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/trackmap_sector_colors_full.png", fullPage: true });
  await map.screenshot({ path: "/opt/cursor/artifacts/screenshots/trackmap_sector_colors_map.png" });
  await wind.screenshot({ path: "/opt/cursor/artifacts/screenshots/trackmap_sector_colors_minimap.png" });
});
