import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    snap: {
      rows: { driver: { driver_number: number; name_acronym: string }; retired: boolean; status: string; gap: number | string | null }[];
    } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const LAP_MS = 80_000;
const LAPPED = new Set(["NOR", "GAS", "STR", "ALB", "COL", "HAD"]);
const CHECKS = [50, 60, 68, 70] as const;

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

function nowAt(lap: number, frac = 0.4): number {
  return START + (lap - 1) * LAP_MS + frac * LAP_MS;
}

async function loadLateMexico(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, lapMs }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const lead = [
        { n: 16, code: "LEC", colour: "E8002D" },
        { n: 1, code: "VER", colour: "3671C6" },
        { n: 55, code: "SAI", colour: "E8002D" },
        { n: 22, code: "TSU", colour: "6692FF" },
        { n: 5, code: "BOR", colour: "52E252" },
        { n: 31, code: "OCO", colour: "B6BABD" },
        { n: 87, code: "BEA", colour: "B6BABD" },
        { n: 81, code: "PIA", colour: "FF8000" },
        { n: 44, code: "HAM", colour: "27F4D2" },
        { n: 12, code: "ANT", colour: "27F4D2" },
        { n: 63, code: "RUS", colour: "27F4D2" },
      ];
      const lapped = [
        { n: 4, code: "NOR", colour: "FF8000" },
        { n: 10, code: "GAS", colour: "0093CC" },
        { n: 18, code: "STR", colour: "229971" },
        { n: 23, code: "ALB", colour: "1868DB" },
        { n: 43, code: "COL", colour: "1868DB" },
        { n: 6, code: "HAD", colour: "6692FF" },
      ];
      const retired = [{ n: 30, code: "LAW", colour: "6692FF" }];
      const people = [...lead, ...lapped, ...retired];
      const drivers = people.map((d) => ({
        driver_number: d.n,
        broadcast_name: d.code,
        full_name: d.code,
        name_acronym: d.code,
        team_name: "Test",
        team_colour: d.colour,
        first_name: d.code,
        last_name: d.code,
      }));
      const laps = [];
      const intervals = [];
      const positions = [];
      for (const d of people) {
        const lastLap = d.code === "LAW" ? 20 : 70;
        const lappedAt = lapped.findIndex((x) => x.n === d.n);
        const delay = lappedAt >= 0 ? lapMs + (lappedAt + 1) * 7_000 : 0;
        for (let n = 1; n <= lastLap; n += 1) {
          laps.push({
            driver_number: d.n,
            lap_number: n,
            date_start: new Date(start + (n - 1) * lapMs + delay).toISOString(),
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
          });
        }
        for (const lap of [50, 60, 68, 70]) {
          const t = start + (lap - 1) * lapMs + 0.4 * lapMs;
          const i = lead.findIndex((x) => x.n === d.n);
          intervals.push({
            date: new Date(t).toISOString(),
            driver_number: d.n,
            gap_to_leader: i === 0 ? 0 : i > 0 ? i * 1.2 : "+1 LAP",
            interval: i === 0 ? 0 : i > 0 ? 1.2 : "+1 LAP",
          });
          positions.push({
            date: new Date(t).toISOString(),
            driver_number: d.n,
            position: people.findIndex((x) => x.n === d.n) + 1,
          });
        }
      }
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
            date_end: "2025-10-26T22:00:00.000Z",
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2025,
          },
          weekendSessions: [],
          drivers,
          laps,
          intervals,
          positions,
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [
            {
              date: new Date(start).toISOString(),
              air_temperature: 21.4,
              track_temperature: 38.2,
              wind_speed: 4.2,
              wind_direction: 210,
              humidity: 44,
              rainfall: 0,
            },
          ],
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
        end: start + 71 * lapMs,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 9877,
        meetingKey: 1272,
        year: 2025,
        selectedDriver: null,
        selectedDrivers: [],
      });
    },
    { start: START, lapMs: LAP_MS },
  );
}

async function seekLap(page: Page, lap: number): Promise<void> {
  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), nowAt(lap));
}

async function runningFromTower(page: Page): Promise<string[]> {
  const api = await hooks(page);
  return (api.state.snap?.rows ?? [])
    .filter((row) => !row.retired && row.status !== "OUT")
    .map((row) => row.driver.name_acronym);
}

test("late-race Mexico keeps every running car on the map, strip, and pit circle", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  await loadLateMexico(page);

  for (const lap of CHECKS) {
    await seekLap(page, lap);
    await expect(page.locator(".session-clock")).toContainText(`LAP ${lap}/`);
    const running = await runningFromTower(page);
    expect(running.length).toBe(17);
    for (const code of LAPPED) expect(running).toContain(code);

    const map = page.locator("svg.track");
    await expect(map).toHaveAttribute("data-cars", String(running.length));
    await expect(map.locator("[data-driver]")).toHaveCount(running.length);
    const labels = await map.locator("[data-driver] .drv-label").allTextContents();
    for (const code of LAPPED) expect(labels).toContain(code);
    const spots = await map.locator("[data-driver]").evaluateAll((nodes) =>
      nodes.map((n) => `${Number(n.getAttribute("data-x")).toFixed(1)},${Number(n.getAttribute("data-y")).toFixed(1)}`),
    );
    expect(new Set(spots).size).toBe(running.length);

    await expect(page.locator("canvas.gapline")).toHaveAttribute("data-cars", String(running.length));

    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_late_map_lap${lap}_1920.png`,
      fullPage: true,
    });

    if (lap === 68) {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seekLap(page, lap);
      await expect(map).toHaveAttribute("data-cars", "17");
      await expect(map.locator("[data-driver]")).toHaveCount(17);
      await page.screenshot({
        path: "/opt/cursor/artifacts/screenshots/mexico_late_map_lap68_1366.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
  }

  await seekLap(page, 68);
  await page.locator("nav button[data-page='pitcircle']").click();
  const circle = page.locator("svg.circle");
  await expect(circle).toBeVisible();
  await expect(circle).toHaveAttribute("data-cars", "17");
  await expect(circle.locator("[data-driver]")).toHaveCount(17);
  const circleLabels = await circle.locator("[data-driver] .drv-label").allTextContents();
  for (const code of LAPPED) expect(circleLabels.some((text) => text.includes(code))).toBe(true);
  await expect(page.locator("canvas.gapline")).toHaveAttribute("data-cars", "17");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/mexico_late_circle_lap68_1920.png",
    fullPage: true,
  });
});
