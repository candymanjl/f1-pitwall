import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    mode: string;
    snap: { trackFlag?: { kind: string; label: string; badge: string | null } } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const T_SC = Date.parse("2025-10-26T20:10:00.000Z");
const T_BLUE = Date.parse("2025-10-26T20:12:00.000Z");
const END = Date.parse("2025-10-26T21:00:00.000Z");

async function waitApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadRaceControl(
  page: Page,
  raceControl: Array<Record<string, unknown>>,
  clock: number,
): Promise<void> {
  await page.evaluate(
    ({ start, end, clock, raceControl }) => {
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
            date_end: new Date(end).toISOString(),
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2025,
          },
          weekendSessions: [],
          drivers: [],
          laps: [],
          intervals: [],
          positions: [],
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [],
          raceControl,
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
      });
      api.setClock(clock, "code");
    },
    { start: START, end: END, clock, raceControl },
  );
}

function green(): Record<string, unknown> {
  return {
    date: new Date(START).toISOString(),
    category: "Flag",
    flag: "GREEN",
    scope: "Track",
    message: "GREEN FLAG",
    lap_number: 1,
    driver_number: null,
    sector: null,
  };
}

function blue(): Record<string, unknown> {
  return {
    date: new Date(T_BLUE).toISOString(),
    category: "Flag",
    flag: "BLUE",
    scope: "Driver",
    message: "BLUE FLAG FOR CAR 22",
    lap_number: 12,
    driver_number: 22,
    sector: null,
  };
}

test("footer indicator stays GREEN for a lapped-car blue flag", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitApp(page);
  await loadRaceControl(page, [green(), blue()], T_BLUE + 2_000);
  const flag = page.locator(".statusbar .flag-indicator");
  await expect(flag).toBeVisible();
  await expect(flag).toHaveAttribute("data-kind", "green");
  await expect(flag.locator(".flag-name")).toHaveText("GREEN");
  await expect(flag.locator(".flag-badge")).toHaveCount(0);
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_indicator_after_green.png",
  });
  await page.screenshot({
    path: "/opt/cursor/artifacts/flag_indicator_after_green_page.png",
    fullPage: true,
  });

  await loadRaceControl(
    page,
    [
      green(),
      {
        date: new Date(T_SC).toISOString(),
        category: "SafetyCar",
        flag: null,
        scope: "Track",
        message: "SAFETY CAR DEPLOYED",
        lap_number: 10,
        driver_number: null,
        sector: null,
      },
      blue(),
    ],
    T_BLUE + 2_000,
  );
  await expect(flag).toHaveAttribute("data-kind", "sc");
  await expect(flag.locator(".flag-name")).toHaveText("SAFETY CAR");
  await page.locator(".statusbar").screenshot({
    path: "/opt/cursor/artifacts/screenshots/flag_indicator_after_sc_blue.png",
  });
});
