import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    playing: boolean;
    snap: { leaderLap: number } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const MID = Date.parse("2025-10-26T20:28:00.000Z");
const END = Date.parse("2025-10-26T21:36:00.000Z");

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadMexico2025(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, end }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const drivers = [
        { driver_number: 1, broadcast_name: "VER", full_name: "Max Verstappen", name_acronym: "VER", team_name: "Red Bull", team_colour: "3671C6", first_name: "Max", last_name: "Verstappen" },
        { driver_number: 4, broadcast_name: "NOR", full_name: "Lando Norris", name_acronym: "NOR", team_name: "McLaren", team_colour: "FF8000", first_name: "Lando", last_name: "Norris" },
        { driver_number: 81, broadcast_name: "PIA", full_name: "Oscar Piastri", name_acronym: "PIA", team_name: "McLaren", team_colour: "FF8000", first_name: "Oscar", last_name: "Piastri" },
        { driver_number: 16, broadcast_name: "LEC", full_name: "Charles Leclerc", name_acronym: "LEC", team_name: "Ferrari", team_colour: "E8002D", first_name: "Charles", last_name: "Leclerc" },
        { driver_number: 44, broadcast_name: "HAM", full_name: "Lewis Hamilton", name_acronym: "HAM", team_name: "Ferrari", team_colour: "E8002D", first_name: "Lewis", last_name: "Hamilton" },
        { driver_number: 63, broadcast_name: "RUS", full_name: "George Russell", name_acronym: "RUS", team_name: "Mercedes", team_colour: "27F4D2", first_name: "George", last_name: "Russell" },
      ];
      const orderAt = (lap: number) => {
        const ids = [1, 4, 81, 16, 44, 63];
        if (lap >= 12) {
          ids.splice(0, 2, 4, 1);
        }
        if (lap >= 28) {
          ids.splice(0, 3, 4, 81, 1);
        }
        if (lap > 40) return ids.filter((id) => id !== 63);
        return ids;
      };
      const laps = [];
      const positions = [];
      const pits = [];
      for (let n = 1; n <= 71; n++) {
        const order = orderAt(n);
        for (let i = 0; i < order.length; i++) {
          const dn = order[i];
          const t0 = start + 8_000 + (n - 1) * 81_000 + i * 350;
          laps.push({
            driver_number: dn,
            lap_number: n,
            date_start: new Date(t0).toISOString(),
            lap_duration: 80.2 + i * 0.05,
            duration_sector_1: 22,
            duration_sector_2: 29,
            duration_sector_3: 29.2,
            is_pit_out_lap: (dn === 1 && n === 19) || (dn === 44 && n === 20) || (dn === 4 && n === 33),
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          });
          positions.push({
            date: new Date(t0 + 80_200).toISOString(),
            driver_number: dn,
            position: i + 1,
          });
        }
        if (n === 18) pits.push({ date: new Date(start + 18 * 81_000).toISOString(), driver_number: 1, lap_number: 18, lane_duration: 22, pit_duration: 22, stop_duration: 2.5 });
        if (n === 19) pits.push({ date: new Date(start + 19 * 81_000).toISOString(), driver_number: 44, lap_number: 19, lane_duration: 22, pit_duration: 22, stop_duration: 2.6 });
        if (n === 32) pits.push({ date: new Date(start + 32 * 81_000).toISOString(), driver_number: 4, lap_number: 32, lane_duration: 22, pit_duration: 22, stop_duration: 2.4 });
      }
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
            date_end: new Date(end).toISOString(),
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2025,
          },
          weekendSessions: [],
          drivers,
          laps,
          intervals: [],
          positions,
          stints: [],
          weekendStints: [],
          pits,
          weather: [],
          raceControl: [
            { date: new Date(start + 12 * 81_000).toISOString(), category: "SafetyCar", flag: null, scope: "Track", message: "SAFETY CAR DEPLOYED", lap_number: 12, driver_number: null },
            { date: new Date(start + 15 * 81_000).toISOString(), category: "SafetyCar", flag: "GREEN", scope: "Track", message: "SAFETY CAR IN THIS LAP", lap_number: 15, driver_number: null },
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
          pitEntry: 0.96,
          pitExit: 0.06,
        },
        start,
        end,
        latestMs: Number.NaN,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 9877,
        meetingKey: 1272,
        year: 2025,
        selectedDriver: null,
        selectedDrivers: [],
        hiddenDrivers: [],
        traceMode: "leader",
        traceDriver: null,
      });
      api.setClock(end, "code");
    },
    { start: START, end: END },
  );
}

test("Race Trace Position Y-axis: Mexico 2025 full race, mid-replay, and toggle", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#racetrace");
  await waitForApp(page);
  await loadMexico2025(page);
  await page.locator("nav button[data-page='racetrace']").click();
  await expect(page.locator("button[data-y-axis='gap']")).toBeVisible();
  await expect(page.locator("button[data-y-axis='position']")).toBeVisible();
  await expect(page.locator("button[data-trace-mode='leader']")).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/racetrace_y_toggle_gap_1920.png",
    fullPage: true,
  });

  await page.locator("button[data-y-axis='position']").dispatchEvent("pointerdown");
  await expect(page.locator(".page.racetrace")).toHaveAttribute("data-y-axis", "position");
  await expect(page.locator(".y-axis")).toBeHidden();
  await expect(page.locator("canvas.chart")).toBeVisible();
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/racetrace_position_full_1920.png",
    fullPage: true,
  });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), MID);
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.t)).toBe(MID);
  await page.waitForTimeout(200);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/racetrace_position_mid_1920.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/racetrace_position_mid_1366.png",
    fullPage: true,
  });

  await page.locator("button[data-y-axis='gap']").dispatchEvent("pointerdown");
  await expect(page.locator(".page.racetrace")).toHaveAttribute("data-y-axis", "gap");
  await expect(page.locator("button[data-trace-mode='average']")).toBeVisible();
});
