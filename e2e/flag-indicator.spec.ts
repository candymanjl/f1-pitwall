import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    mode: string;
    followLive: boolean;
    playing: boolean;
    snap: { now: number; trackFlag?: { kind: string; label: string; badge: string | null } } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
  showFlagSheet: () => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const T_YELLOW = Date.parse("2025-10-26T20:08:00.000Z");
const T_DOUBLE = Date.parse("2025-10-26T20:16:00.000Z");
const T_RED = Date.parse("2025-10-26T20:24:00.000Z");
const T_GREEN = Date.parse("2025-10-26T20:28:00.000Z");
const T_SC = Date.parse("2025-10-26T20:36:00.000Z");
const T_LIVE = Date.parse("2025-10-26T20:48:00.000Z");
const END = Date.parse("2025-10-26T21:28:00.000Z");

async function waitApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadSession(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, end, tYellow, tDouble, tRed, tGreen, tSc }) => {
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
          driver_number: 44,
          broadcast_name: "HAM",
          full_name: "Lewis Hamilton",
          name_acronym: "HAM",
          team_name: "Ferrari",
          team_colour: "E8002D",
          first_name: "Lewis",
          last_name: "Hamilton",
        },
      ];
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
            date_end: new Date(end).toISOString(),
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2025,
          },
          weekendSessions: [],
          drivers,
          laps: [
            {
              driver_number: 1,
              lap_number: 1,
              date_start: new Date(start + 12_000).toISOString(),
              lap_duration: 80,
              duration_sector_1: 22.104,
              duration_sector_2: 29.201,
              duration_sector_3: 26.4,
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
          positions: [],
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [
            {
              date: new Date(start).toISOString(),
              air_temperature: 21.4,
              track_temperature: 38.2,
              wind_speed: 3.6,
              wind_direction: 210,
              humidity: 44,
              rainfall: 0,
              pressure: 1013.1,
            },
          ],
          raceControl: [
            {
              date: new Date(start).toISOString(),
              category: "Flag",
              flag: "GREEN",
              scope: "Track",
              message: "GREEN FLAG",
              lap_number: 1,
              driver_number: null,
              sector: null,
            },
            {
              date: new Date(tYellow).toISOString(),
              category: "Flag",
              flag: "YELLOW",
              scope: "Sector",
              message: "YELLOW FLAG IN SECTOR 2",
              lap_number: 8,
              driver_number: null,
              sector: 2,
            },
            {
              date: new Date(tDouble).toISOString(),
              category: "Flag",
              flag: "DOUBLE YELLOW",
              scope: "Sector",
              message: "DOUBLE YELLOW IN SECTOR 2",
              lap_number: 14,
              driver_number: null,
              sector: 2,
            },
            {
              date: new Date(tRed).toISOString(),
              category: "Flag",
              flag: "RED",
              scope: "Track",
              message: "RED FLAG",
              lap_number: 20,
              driver_number: null,
              sector: null,
            },
            {
              date: new Date(tGreen).toISOString(),
              category: "Flag",
              flag: "GREEN",
              scope: "Track",
              message: "GREEN FLAG",
              lap_number: 20,
              driver_number: null,
              sector: null,
            },
            {
              date: new Date(tSc).toISOString(),
              category: "SafetyCar",
              flag: null,
              scope: "Track",
              message: "SAFETY CAR DEPLOYED",
              lap_number: 28,
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
          pitEntry: 0.96,
          pitExit: 0.06,
        },
        start,
        end,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 9877,
        meetingKey: 1272,
        year: 2025,
        selectedDriver: null,
        selectedDrivers: [],
      });
      api.setClock(tYellow + 2_000, "code");
    },
    { start: START, end: END, tYellow: T_YELLOW, tDouble: T_DOUBLE, tRed: T_RED, tGreen: T_GREEN, tSc: T_SC },
  );
}

async function expectFlag(page: Page, kind: string, label: string, badge: string | null): Promise<void> {
  const flag = page.locator(".statusbar .flag-indicator");
  await expect(flag).toBeVisible();
  await expect(flag).toHaveAttribute("data-kind", kind);
  await expect(flag.locator(".flag-name")).toHaveText(label);
  await expect(flag.locator(".flag-name")).not.toHaveText(/-/);
  if (badge) {
    await expect(flag).toHaveAttribute("data-badge", badge);
    await expect(flag.locator(".flag-badge")).toHaveText(badge);
  } else {
    await expect(flag.locator(".flag-badge")).toHaveCount(0);
  }
}

async function footerFits(page: Page): Promise<void> {
  const fit = await page.locator(".statusbar").evaluate((el) => {
    const host = el.getBoundingClientRect();
    const flag = el.querySelector(".flag-indicator") as HTMLElement | null;
    const sectors = el.querySelector(".strip-sectors") as HTMLElement | null;
    const s1 = el.querySelector(".sec-purple") as HTMLElement | null;
    const wx = el.querySelector(".wx-text") as HTMLElement | null;
    return {
      overflowX: el.scrollWidth - el.clientWidth,
      overflowY: el.scrollHeight - el.clientHeight,
      hostRight: host.right,
      hostBottom: host.bottom,
      viewW: window.innerWidth,
      viewH: window.innerHeight,
      flagRight: flag?.getBoundingClientRect().right ?? 0,
      sectorLeft: sectors?.getBoundingClientRect().left ?? 0,
      s1Left: s1?.getBoundingClientRect().left ?? 0,
      wxRight: wx?.getBoundingClientRect().right ?? 0,
      flagWrap: flag ? flag.scrollWidth - flag.clientWidth : 99,
    };
  });
  expect(fit.overflowX).toBeLessThan(8);
  expect(fit.overflowY).toBeLessThan(12);
  expect(fit.hostBottom).toBeLessThanOrEqual(fit.viewH);
  expect(fit.flagRight).toBeLessThanOrEqual(fit.sectorLeft + 2);
  expect(fit.flagRight).toBeLessThanOrEqual(fit.s1Left + 2);
  expect(fit.wxRight).toBeLessThanOrEqual(fit.hostRight + 4);
}

test("footer flag follows replay and live race control", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitApp(page);
  await loadSession(page);

  await expectFlag(page, "yellow", "YELLOW", "S2");
  await footerFits(page);
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_yellow_s2_1920.png",
  });
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/flag_yellow_s2_page_1920.png", fullPage: true });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_DOUBLE + 2_000);
  await expectFlag(page, "doubleYellow", "DOUBLE YELLOW", "S2");
  await footerFits(page);
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_double_yellow_1920.png",
  });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_RED + 2_000);
  await expectFlag(page, "red", "RED FLAG", null);
  await footerFits(page);
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_red_1920.png",
  });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_SC + 2_000);
  await expectFlag(page, "sc", "SAFETY CAR", null);
  await footerFits(page);
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_sc_1920.png",
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), T_YELLOW + 2_000);
  await expectFlag(page, "yellow", "YELLOW", "S2");
  await footerFits(page);
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_yellow_s2_1366.png",
  });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), T_DOUBLE + 2_000);
  await expectFlag(page, "doubleYellow", "DOUBLE YELLOW", "S2");
  await footerFits(page);
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_double_yellow_1366.png",
  });

  await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), T_SC + 2_000);
  await page.evaluate(
    ({ liveAt }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      Object.assign(api.state, { mode: "live", followLive: true, playing: true });
      api.ingestLive("v1/race_control", [
        {
          date: new Date(liveAt).toISOString(),
          category: "Flag",
          flag: "YELLOW",
          scope: "Sector",
          message: "YELLOW FLAG IN SECTOR 3",
          lap_number: 36,
          driver_number: null,
          sector: 3,
          session_key: 9877,
        },
      ]);
    },
    { liveAt: T_LIVE },
  );
  await expectFlag(page, "sc", "SAFETY CAR", null);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.showFlagSheet());
  await expect(page.locator("[data-flagsheet]")).toBeVisible();
  await expect(page.locator(".flag-sheet-cell")).toHaveCount(13);
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/flag_sheet_1920.png", fullPage: true });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/flag_sheet_1366.png", fullPage: true });
});
