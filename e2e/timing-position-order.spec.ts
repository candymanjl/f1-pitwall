import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    mode: string;
    followLive: boolean;
    playing: boolean;
    loading: string;
    sessionKey: number;
    bundle: unknown;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
};

const START = Date.parse("2026-11-08T17:00:00.000Z");
const NOW = START + (1 * 3600 + 34 * 60 + 41) * 1000;

const DRIVERS: Array<{
  n: number;
  code: string;
  team: string;
  colour: string;
  pos: number;
  lap: number;
  gap: number | string;
  iv: number | string;
}> = [
  { n: 4, code: "NOR", team: "McLaren", colour: "FF8000", pos: 1, lap: 68, gap: 0, iv: 0 },
  { n: 1, code: "VER", team: "Red Bull", colour: "3671C6", pos: 2, lap: 68, gap: 13.617, iv: 13.617 },
  { n: 6, code: "HAD", team: "Racing Bulls", colour: "6692FF", pos: 3, lap: 68, gap: 16.517, iv: 2.9 },
  { n: 63, code: "RUS", team: "Mercedes", colour: "27F4D2", pos: 4, lap: 68, gap: 28.582, iv: 12.065 },
  { n: 12, code: "ANT", team: "Mercedes", colour: "27F4D2", pos: 5, lap: 68, gap: 30.728, iv: 2.146 },
  { n: 81, code: "PIA", team: "McLaren", colour: "FF8000", pos: 6, lap: 68, gap: 48.61, iv: 17.882 },
  { n: 30, code: "LAW", team: "Racing Bulls", colour: "6692FF", pos: 7, lap: 68, gap: 62.009, iv: 13.399 },
  { n: 16, code: "LEC", team: "Ferrari", colour: "E8002D", pos: 8, lap: 68, gap: 82.644, iv: 20.635 },
  { n: 44, code: "HAM", team: "Ferrari", colour: "E8002D", pos: 9, lap: 68, gap: "+1 LAP", iv: 23.88 },
  { n: 5, code: "BOR", team: "Sauber", colour: "52E252", pos: 10, lap: 67, gap: "+1 LAP", iv: "+1 LAP" },
  { n: 10, code: "GAS", team: "Alpine", colour: "0093CC", pos: 11, lap: 67, gap: "+1 LAP", iv: 4.465 },
  { n: 14, code: "ALO", team: "Aston Martin", colour: "229971", pos: 12, lap: 67, gap: "+1 LAP", iv: 15.924 },
  { n: 23, code: "ALB", team: "Williams", colour: "64C4FF", pos: 13, lap: 67, gap: "+1 LAP", iv: 2.894 },
  { n: 27, code: "HUL", team: "Sauber", colour: "52E252", pos: 14, lap: 67, gap: "+1 LAP", iv: 2.225 },
  { n: 41, code: "LIN", team: "Alpine", colour: "0093CC", pos: 15, lap: 67, gap: "+1 LAP", iv: 1.329 },
  { n: 43, code: "COL", team: "Alpine", colour: "0093CC", pos: 16, lap: 67, gap: "+1 LAP", iv: 0.918 },
  { n: 87, code: "BEA", team: "Haas", colour: "B6BABD", pos: 17, lap: 67, gap: "+1 LAP", iv: 1.897 },
  { n: 77, code: "BOT", team: "Kick Sauber", colour: "52E252", pos: 18, lap: 66, gap: "+1 LAP", iv: "+1 LAP" },
  { n: 11, code: "PER", team: "Cadillac", colour: "FFFFFF", pos: 19, lap: 67, gap: "+2 LAPS", iv: 28.14 },
  { n: 31, code: "OCO", team: "Haas", colour: "B6BABD", pos: 20, lap: 66, gap: "+2 LAPS", iv: 19.527 },
  { n: 55, code: "SAI", team: "Williams", colour: "64C4FF", pos: 21, lap: 66, gap: "+2 LAPS", iv: 10.895 },
  { n: 18, code: "STR", team: "Aston Martin", colour: "229971", pos: 22, lap: 1, gap: "+1 LAP", iv: 5.755 },
];

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadSaoPauloRace(page: Page, perOfficialPos: number): Promise<void> {
  await page.evaluate(
    ({ start, now, drivers, perOfficialPos }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const field = [...drivers]
        .sort((a, b) => a.n - b.n)
        .map((d) => ({
          driver_number: d.n,
          broadcast_name: d.code,
          full_name: d.code,
          name_acronym: d.code,
          team_name: d.team,
          team_colour: d.colour,
          first_name: d.code,
          last_name: d.code,
        }));
      const iso = (ms: number) => new Date(ms).toISOString();
      const posAt = iso(now - 20_000);
      const laps = drivers.map((d) => ({
        driver_number: d.n,
        lap_number: d.lap,
        date_start: iso(now - Math.max(8_000, (68 - d.lap + 1) * 40_000)),
        lap_duration: d.lap <= 1 ? 90 : 80,
        duration_sector_1: 22,
        duration_sector_2: 37,
        duration_sector_3: 21,
        is_pit_out_lap: false,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
        i1_speed: 280,
        i2_speed: 300,
        st_speed: 330,
      }));
      const intervals = drivers.map((d) => ({
        date: posAt,
        driver_number: d.n,
        gap_to_leader: d.gap,
        interval: d.iv,
      }));
      const positions = drivers.map((d) => ({
        date: posAt,
        driver_number: d.n,
        position: d.n === 11 ? perOfficialPos : d.pos,
      }));
      const bundle = {
        meeting: {
          meeting_key: 1300,
          meeting_name: "São Paulo Grand Prix",
          meeting_official_name: "FORMULA 1 MSC CRUISES GRANDE PRÊMIO DE SÃO PAULO 2026",
          circuit_short_name: "Interlagos",
          country_name: "Brazil",
          location: "São Paulo",
          date_start: iso(start),
          year: 2026,
        },
        session: {
          session_key: 12001,
          meeting_key: 1300,
          session_name: "Race",
          session_type: "Race",
          date_start: iso(start),
          date_end: iso(start + 90 * 60_000),
          circuit_short_name: "Interlagos",
          country_name: "Brazil",
          location: "São Paulo",
          year: 2026,
        },
        weekendSessions: [],
        drivers: field,
        laps,
        intervals,
        positions,
        stints: field.map((d) => ({
          driver_number: d.driver_number,
          stint_number: 1,
          lap_start: 1,
          lap_end: 71,
          compound: "SOFT",
          tyre_age_at_start: 0,
        })),
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
        end: now,
        t: now,
        latestMs: now,
        mode: "live",
        playing: false,
        followLive: false,
        sessionKey: 12001,
        year: 2026,
        meetingKey: 1300,
        loading: "",
      });
      api.setClock(now, "code");
    },
    { start: START, now: NOW, drivers: DRIVERS, perOfficialPos },
  );
}

test("Sao Paulo lap 69 tower follows official /position, including live updates", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#timing");
  await waitForApp(page);
  await loadSaoPauloRace(page, 19);
  await page.locator("nav button[data-page='timing']").click();
  await expect(page.locator("table.tower")).toBeVisible();
  const perRow = page.locator("tr[data-driver='11']");
  await expect(perRow).toBeVisible();
  await expect(perRow.locator("td.c-pos")).toHaveText("19");
  const codes = await page.locator("tbody tr .c-drv").allTextContents();
  const names = codes.map((t) => t.replace(/[^A-Z]/g, "").slice(0, 3));
  expect(names.indexOf("PER")).toBeGreaterThan(names.indexOf("GAS"));
  expect(names.indexOf("PER")).toBeGreaterThan(names.indexOf("HAM"));
  await expect(perRow.locator("td.c-gap").nth(1)).toHaveText("+2 LAPS");
  await expect(page.locator("tr[data-driver='5'] td.c-pos")).toHaveText("10");
  await expect(page.locator("tbody tr td.c-pos")).toHaveText([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
  ]);
  await page.locator("table.tower").screenshot({
    path: "/opt/cursor/artifacts/screenshots/timing_sp_position_after_1920.png",
  });
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/timing_sp_position_after_page_1920.png",
    fullPage: true,
  });

  await page.evaluate(
    ({ now }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.ingestLive("v1/position", [
        { date: new Date(now).toISOString(), driver_number: 11, position: 18, session_key: 12001 },
        { date: new Date(now).toISOString(), driver_number: 77, position: 19, session_key: 12001 },
      ]);
    },
    { now: NOW },
  );
  await expect(perRow.locator("td.c-pos")).toHaveText("18");
  await expect(page.locator("tr[data-driver='77'] td.c-pos")).toHaveText("19");
});
