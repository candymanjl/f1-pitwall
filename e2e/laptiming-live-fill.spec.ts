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
    lapTimingDrivers: number[];
    lapTimingView: string;
    sessionKey: number;
    bundle: unknown;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setLapTimingDrivers: (ids: number[]) => void;
  setLapTimingView: (view: string) => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
};

const START = Date.parse("2026-11-08T17:00:00.000Z");
const LAP_MS = 80_000;

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadSaoPauloCompare(page: Page, filled: boolean): Promise<void> {
  await page.evaluate(
    ({ start, lapMs, filled }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const nor = {
        driver_number: 4,
        broadcast_name: "NOR",
        full_name: "Lando Norris",
        name_acronym: "NOR",
        team_name: "McLaren",
        team_colour: "FF8000",
        first_name: "Lando",
        last_name: "Norris",
      };
      const ver = {
        driver_number: 1,
        broadcast_name: "VER",
        full_name: "Max Verstappen",
        name_acronym: "VER",
        team_name: "Red Bull",
        team_colour: "3671C6",
        first_name: "Max",
        last_name: "Verstappen",
      };
      const lap = (
        dn: number,
        n: number,
        extra: Record<string, unknown>,
      ) => ({
        driver_number: dn,
        lap_number: n,
        date_start: new Date(start + (n - 1) * lapMs).toISOString(),
        lap_duration: 74.4,
        duration_sector_1: 19.2,
        duration_sector_2: 38.8,
        duration_sector_3: 16.4,
        is_pit_out_lap: false,
        segments_sector_1: null,
        segments_sector_2: null,
        segments_sector_3: null,
        i1_speed: 280,
        i2_speed: 300,
        st_speed: 330,
        ...extra,
      });
      const laps = [];
      for (const dn of [4, 1]) {
        for (let n = 45; n <= 58; n++) {
          if (dn === 1 && n === 46) {
            laps.push(
              lap(1, 46, filled
                ? {
                    is_pit_out_lap: true,
                    duration_sector_1: 39.813,
                    duration_sector_2: 38.85,
                    duration_sector_3: 16.324,
                    lap_duration: 94.987,
                  }
                : {
                    is_pit_out_lap: true,
                    duration_sector_1: 19.422,
                    duration_sector_2: 39.422,
                    duration_sector_3: 16.445,
                    lap_duration: 94.588,
                  }),
            );
            continue;
          }
          if (dn === 4 && n === 50) {
            laps.push(
              lap(4, 50, {
                is_pit_out_lap: true,
                duration_sector_1: 39.813,
                duration_sector_2: 38.85,
                duration_sector_3: 16.324,
                lap_duration: 94.987,
              }),
            );
            continue;
          }
          if (n === 56 || n === 57) {
            laps.push(
              lap(dn, n, filled
                ? { duration_sector_1: 19.2, duration_sector_2: 38.8, duration_sector_3: 16.4, lap_duration: 74.4 }
                : { duration_sector_1: 19.2, duration_sector_2: 38.8, duration_sector_3: null, lap_duration: null }),
            );
            continue;
          }
          if (n === 58) {
            laps.push(
              lap(dn, n, {
                duration_sector_1: 19.1,
                duration_sector_2: null,
                duration_sector_3: null,
                lap_duration: null,
              }),
            );
            continue;
          }
          laps.push(lap(dn, n, {}));
        }
      }
      const now = start + 57 * lapMs + 20_000;
      const bundle = {
        meeting: {
          meeting_key: 1300,
          meeting_name: "São Paulo Grand Prix",
          circuit_short_name: "Interlagos",
          country_name: "Brazil",
          location: "São Paulo",
          date_start: new Date(start).toISOString(),
          year: 2026,
        },
        session: {
          session_key: 12000,
          meeting_key: 1300,
          session_name: "Race",
          session_type: "Race",
          date_start: new Date(start).toISOString(),
          date_end: new Date(start + 90 * 60_000).toISOString(),
          circuit_short_name: "Interlagos",
          country_name: "Brazil",
          location: "São Paulo",
          year: 2026,
        },
        weekendSessions: [],
        drivers: [nor, ver],
        laps,
        intervals: [],
        positions: [
          { date: new Date(start).toISOString(), driver_number: 4, position: 1 },
          { date: new Date(start).toISOString(), driver_number: 1, position: 2 },
        ],
        stints: [
          { driver_number: 4, stint_number: 1, lap_start: 1, lap_end: 49, compound: "MEDIUM", tyre_age_at_start: 0 },
          { driver_number: 4, stint_number: 2, lap_start: 50, lap_end: 71, compound: "SOFT", tyre_age_at_start: 0 },
          { driver_number: 1, stint_number: 1, lap_start: 1, lap_end: 45, compound: "MEDIUM", tyre_age_at_start: 0 },
          { driver_number: 1, stint_number: 2, lap_start: 46, lap_end: 71, compound: "SOFT", tyre_age_at_start: 0 },
        ],
        weekendStints: [],
        pits: [
          { date: new Date(start + 45 * lapMs).toISOString(), driver_number: 1, lap_number: 45, lane_duration: 22, pit_duration: 22, stop_duration: 2.5 },
          { date: new Date(start + 49 * lapMs).toISOString(), driver_number: 4, lap_number: 49, lane_duration: 22, pit_duration: 22, stop_duration: 2.4 },
        ],
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
        sessionKey: 12000,
        year: 2026,
        meetingKey: 1300,
        loading: "",
      });
      api.setLapTimingDrivers([4, 1]);
      api.setLapTimingView("table");
      api.setClock(now, "code");
    },
    { start: START, lapMs: LAP_MS, filled },
  );
}

async function shotCompare(page: Page, prefix: string): Promise<void> {
  await page.evaluate(() => {
    const wrap = document.querySelector(".lt-table-wrap") as HTMLElement | null;
    if (!wrap) return;
    wrap.style.overflow = "visible";
    wrap.style.maxHeight = "none";
    wrap.style.height = "auto";
    wrap.style.flex = "0 0 auto";
  });
  await page.locator(".lt-table").screenshot({ path: `/opt/cursor/artifacts/screenshots/${prefix}_table_1920.png` });
  await page.locator("tr[data-lt-lap='46']").screenshot({ path: `/opt/cursor/artifacts/screenshots/${prefix}_lap46_1920.png` });
  await page.locator("tr[data-lt-lap='56']").screenshot({ path: `/opt/cursor/artifacts/screenshots/${prefix}_lap56_1920.png` });
  await page.locator("tr[data-lt-lap='57']").screenshot({ path: `/opt/cursor/artifacts/screenshots/${prefix}_lap57_1920.png` });
}

test("Sao Paulo compare table: stale 56/57 and VER 46, then S3 backfill", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#laptiming");
  await waitForApp(page);
  await loadSaoPauloCompare(page, false);
  await page.locator("nav button[data-page='laptiming']").click();
  await expect(page.locator(".lt-table")).toBeVisible();
  await expect(page.locator("th.lt-drv-h").first()).toHaveAttribute("colspan", "6");
  await expect(page.locator("thead th[data-lt-col='s1']")).toHaveCount(2);
  await expect(page.locator("tr[data-lt-lap='56']")).not.toHaveClass(/lt-progress/);
  await expect(page.locator("tr[data-lt-lap='58']")).toHaveClass(/lt-progress/);
  await expect(page.locator("tr[data-lt-lap='56'] [data-lt-col='time']").first()).toHaveText("—");
  await shotCompare(page, "laptiming_sp_after_stale");

  await page.evaluate(
    ({ start, lapMs }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const row = (dn: number, n: number, extra: Record<string, unknown>) => ({
        driver_number: dn,
        lap_number: n,
        date_start: new Date(start + (n - 1) * lapMs).toISOString(),
        session_key: 12000,
        is_pit_out_lap: n === 46 && dn === 1,
        ...extra,
      });
      const payload = [
        row(4, 56, { duration_sector_1: 19.2, duration_sector_2: 38.8, duration_sector_3: 16.4, lap_duration: 74.4 }),
        row(1, 56, { duration_sector_1: 19.2, duration_sector_2: 38.8, duration_sector_3: 16.4, lap_duration: 74.4 }),
        row(4, 57, { duration_sector_1: 19.3, duration_sector_2: 38.7, duration_sector_3: 16.5, lap_duration: 74.5 }),
        row(1, 57, { duration_sector_1: 19.3, duration_sector_2: 38.7, duration_sector_3: 16.5, lap_duration: 74.5 }),
        row(1, 46, {
          _id: 20,
          _key: "oid-ver-46",
          duration_sector_1: 39.813,
          duration_sector_2: 38.85,
          duration_sector_3: 16.324,
          lap_duration: 94.987,
          is_pit_out_lap: true,
        }),
      ];
      api.ingestLive("v1/laps", payload);
    },
    { start: START, lapMs: LAP_MS },
  );
  await expect(page.locator("tr[data-lt-lap='56']")).not.toHaveClass(/lt-progress/);
  await expect(page.locator("tr[data-lt-lap='56'] [data-lt-col='s3']").first()).toHaveText("16.400");
  await expect(page.locator("tr[data-lt-lap='56'] [data-lt-col='time']").first()).toHaveText("1:14.400");
  await expect(page.locator("tr[data-lt-lap='46'] [data-lt-col='time']").nth(1)).toHaveText("1:34.987");
  await expect(page.locator("tr[data-lt-lap='46'] [data-lt-col='s1']").nth(1)).toHaveText("39.813");
  await shotCompare(page, "laptiming_sp_after_fill");
});
