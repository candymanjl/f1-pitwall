import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    latestMs: number;
    mode: string;
    followLive: boolean;
    playing: boolean;
    loading: string;
    error: string;
    lapTimingDrivers: number[];
    lapTimingView: string;
    sessionKey: number;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setLapTimingDrivers: (ids: number[]) => void;
  setLapTimingView: (view: string) => void;
};

const START = Date.parse("2026-10-25T20:00:00.000Z");
const LAP10 = START + 18 * 60_000 + 47_000;
const NOW = START + 19 * 60_000 + 27_000;

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadUsGpAntMidS2(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, lap10, now }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const drivers = [
        {
          driver_number: 12,
          broadcast_name: "ANT",
          full_name: "Kimi Antonelli",
          name_acronym: "ANT",
          team_name: "Mercedes",
          team_colour: "27F4D2",
          first_name: "Kimi",
          last_name: "Antonelli",
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
      const make = (
        dn: number,
        n: number,
        dateStart: number,
        dur: number | null,
        s1: number,
        s2: number,
        s3: number,
        i1: number,
        i2: number,
        st: number,
      ) => ({
        driver_number: dn,
        lap_number: n,
        date_start: new Date(dateStart).toISOString(),
        lap_duration: dur,
        duration_sector_1: s1,
        duration_sector_2: s2,
        duration_sector_3: s3,
        is_pit_out_lap: false,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
        i1_speed: i1,
        i2_speed: i2,
        st_speed: st,
      });
      const laps = [
        make(12, 8, lap10 - 192_000, 95.8, 25.0, 38.2, 32.6, 274, 304, 327),
        make(12, 9, lap10 - 96_000, 96.0, 25.1, 38.4, 32.5, 275, 305, 328),
        make(12, 10, lap10, 96.2, 25.112, 38.4, 32.7, 278, 310, 331),
        make(4, 9, lap10 - 95_500, 96.1, 25.3, 38.5, 32.3, 273, 307, 326),
        make(4, 10, lap10 + 500, 96.4, 25.401, 38.6, 32.4, 274, 308, 329),
        make(12, 11, lap10 + 96_200, 96.0, 25.0, 38.3, 32.7, 276, 306, 330),
      ];
      const bundle = {
        meeting: {
          meeting_key: 1295,
          meeting_name: "United States Grand Prix",
          circuit_short_name: "Austin",
          country_name: "United States",
          location: "Austin",
          date_start: new Date(start).toISOString(),
          year: 2026,
        },
        session: {
          session_key: 11400,
          meeting_key: 1295,
          session_name: "Race",
          session_type: "Race",
          date_start: new Date(start).toISOString(),
          date_end: new Date(start + 90 * 60 * 1000).toISOString(),
          circuit_short_name: "Austin",
          country_name: "United States",
          location: "Austin",
          year: 2026,
        },
        weekendSessions: [],
        drivers,
        laps,
        intervals: [
          { date: new Date(now).toISOString(), driver_number: 12, gap_to_leader: 0, interval: 0 },
          { date: new Date(now).toISOString(), driver_number: 4, gap_to_leader: 1.4, interval: 1.4 },
        ],
        positions: [
          { date: new Date(now).toISOString(), driver_number: 12, position: 1 },
          { date: new Date(now).toISOString(), driver_number: 4, position: 2 },
        ],
        stints: [
          { driver_number: 12, stint_number: 1, lap_start: 1, lap_end: 56, compound: "MEDIUM", tyre_age_at_start: 0 },
          { driver_number: 4, stint_number: 1, lap_start: 1, lap_end: 56, compound: "HARD", tyre_age_at_start: 0 },
        ],
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
        end: start + 90 * 60 * 1000,
        t: now,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 11400,
        year: 2026,
        meetingKey: 1295,
        loading: "",
        error: "",
        latestMs: now,
      });
      api.setLapTimingDrivers([12]);
      api.setLapTimingView("table");
      api.setClock(now, "code");
    },
    { start: START, lap10: LAP10, now: NOW },
  );
}

async function cellsOf(page: Page, lap: number): Promise<Record<string, string>> {
  const row = page.locator(`tr[data-lt-lap='${lap}']`);
  const read = async (col: string) => (await row.locator(`td[data-lt-col='${col}']`).first().textContent())?.trim() ?? "";
  return {
    time: await read("time"),
    s1: await read("s1"),
    s2: await read("s2"),
    s3: await read("s3"),
    i1: await read("i1"),
    i2: await read("i2"),
    st: await read("st"),
  };
}

test("USGP 2026 Race ANT lap 10 mid S2 reveals S1 only", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#laptiming");
  await waitForApp(page);
  await loadUsGpAntMidS2(page);

  await expect(page.locator(".session-title")).toContainText("UNITED STATES");
  await expect(page.locator(".lt-chip")).toHaveText("ANT");
  await expect(page.locator("tr[data-lt-lap='10']")).toHaveClass(/lt-progress/);
  await expect(page.locator("tr[data-lt-lap='11']")).toHaveCount(0);

  const lap10 = await cellsOf(page, 10);
  expect(lap10.time).toBe("…");
  expect(lap10.s1).toBe("25.112");
  expect(lap10.s2).toBe("—");
  expect(lap10.s3).toBe("—");
  expect(lap10.i1).toBe("278");
  expect(lap10.i2).toBe("—");
  expect(lap10.st).toBe("—");

  const lap9 = await cellsOf(page, 9);
  expect(lap9.time).not.toBe("…");
  expect(lap9.s1).not.toBe("—");
  expect(lap9.s2).not.toBe("—");
  expect(lap9.s3).not.toBe("—");
  expect(lap9.st).toBe("328");

  await page.locator(".lt-table-wrap").screenshot({
    path: "/opt/cursor/artifacts/screenshots/laptiming_usgp_ant_lap10_mid_s2.png",
  });
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/laptiming_usgp_ant_lap10_mid_s2_1920.png",
  });

  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.setLapTimingDrivers([12, 4]);
  });
  await expect(page.locator(".lt-chip")).toHaveCount(2);
  const compareRow = page.locator("tr[data-lt-lap='10']");
  await expect(compareRow.locator("td[data-lt-col='time']")).toHaveText(["…", "…"]);
  await expect(compareRow.locator("td[data-lt-col='s1']")).toHaveText(["25.112", "25.401"]);
  await expect(compareRow.locator("td[data-lt-col='s2']")).toHaveText(["—", "—"]);
  await expect(compareRow.locator("td[data-lt-col='s3']")).toHaveText(["—", "—"]);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/laptiming_usgp_ant_nor_lap10_mid_s2_compare.png",
  });
});
