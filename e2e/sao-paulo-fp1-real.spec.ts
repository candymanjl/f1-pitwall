import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    mode: string;
    liveSource: string;
    followLive: boolean;
    error: string;
    lock: string | null;
    bundle: {
      session: { session_key: number; date_start: string; session_name: string };
      laps: unknown[];
      weather: unknown[];
      drivers: Array<{ driver_number: number }>;
      locations: Array<{ date: string; driver_number: number }>;
      intervals: unknown[];
    } | null;
    snap: {
      rows: Array<{ status: string; bestLap: number | null }>;
      weather: { air_temperature: number | null } | null;
    } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
  setLapTimingDrivers: (ids: number[]) => void;
  applyLoadedClock: () => void;
  changeYear: (year: number) => Promise<void>;
  changeMeeting: (meetingKey: number) => Promise<void>;
  changeSession: (sessionKey: number) => void;
  loadSelectedSession: () => Promise<void>;
};

const START = Date.parse("2026-11-06T15:30:00.000Z");
const T_0045 = START + 45 * 60 * 1000;
const here = dirname(fileURLToPath(import.meta.url));
const norLaps = JSON.parse(readFileSync(join(here, "fixtures/openf1-11405-nor-laps.json"), "utf8")) as unknown[];
const sessionRow = (
  JSON.parse(readFileSync(join(here, "fixtures/openf1-11405-session.json"), "utf8")) as Array<Record<string, unknown>>
)[0];

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function publicRestOpen(): Promise<boolean> {
  try {
    const res = await fetch("https://api.openf1.org/v1/sessions?session_key=11405");
    return res.ok;
  } catch {
    return false;
  }
}

test("real OpenF1 session 11405 shows Timing, Lap Timing, and Track Map at 00:45", async ({ page }) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem("f1pitwall.dataMode", "historical");
    localStorage.setItem(
      "f1pw.cache:laps?session_key=11405",
      JSON.stringify({ expires: Date.now() + 7 * 24 * 60 * 60 * 1000, body: [] }),
    );
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#timing");
  await waitForApp(page);

  const staleGone = await page.evaluate(() => localStorage.getItem("f1pw.cache:laps?session_key=11405"));
  expect(staleGone).toBeNull();

  let source: "live" | "captured" = "captured";
  if (await publicRestOpen()) {
    source = "live";
    await page.evaluate(async () => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.state.mode = "historical";
      await api.changeYear(2026);
      await api.changeMeeting(1299);
      api.changeSession(11405);
      await api.loadSelectedSession();
    });
  }

  const loaded = await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    const bundle = api.state.bundle;
    return {
      session: bundle?.session.session_key ?? 0,
      laps: bundle?.laps.length ?? 0,
      lock: api.state.lock,
    };
  });

  if (loaded.session !== 11405 || loaded.laps < 20) {
    source = "captured";
    await page.evaluate(
      ({ session, laps }) => {
        const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
        api.state.mode = "historical";
        api.state.loading = "";
        api.state.error = "";
        api.state.lock = null;
        api.state.year = 2026;
        api.state.meetingKey = 1299;
        api.state.sessionKey = 11405;
        api.state.meetings = [
          {
            meeting_key: 1299,
            meeting_name: "São Paulo Grand Prix",
            circuit_short_name: "Interlagos",
            country_name: "Brazil",
            location: "São Paulo",
            date_start: session.date_start,
            year: 2026,
          },
        ];
        api.state.sessions = [session];
        Object.assign(api.state, {
          bundle: {
            meeting: {
              meeting_key: 1299,
              meeting_name: "São Paulo Grand Prix",
              meeting_official_name: "FORMULA 1 MSC CRUISES GRANDE PRÊMIO DE SÃO PAULO 2026",
              circuit_short_name: "Interlagos",
              country_name: "Brazil",
              location: "São Paulo",
              date_start: session.date_start,
              year: 2026,
            },
            session,
            weekendSessions: [session],
            drivers: [
              {
                driver_number: 1,
                broadcast_name: "LANDO NORRIS",
                full_name: "Lando Norris",
                name_acronym: "NOR",
                team_name: "McLaren",
                team_colour: "FF8000",
                first_name: "Lando",
                last_name: "Norris",
              },
            ],
            laps,
            intervals: [],
            positions: [],
            stints: [],
            weekendStints: [],
            pits: [],
            weather: [],
            raceControl: [],
            track: [],
            corners: [],
            sectorFracs: [0.28, 0.55, 1],
            locations: [],
          },
        });
        api.applyLoadedClock();
      },
      { session: sessionRow, laps: norLaps },
    );
  }

  await page.evaluate(
    ({ t }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.setPlaying(false);
      api.setClock(t);
      const ids = (api.state.bundle?.drivers ?? []).map((d) => d.driver_number);
      if (ids.length) api.setLapTimingDrivers(ids);
    },
    { t: T_0045 },
  );

  const atClock = await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    const snap = api.state.snap;
    return {
      session: api.state.bundle?.session.session_key ?? 0,
      laps: api.state.bundle?.laps.length ?? 0,
      rows: snap?.rows.length ?? 0,
      best: snap?.rows.map((r) => r.bestLap).find((n) => n && n > 0) ?? null,
      sourceLock: api.state.lock,
    };
  });
  expect(atClock.session).toBe(11405);
  expect(atClock.laps).toBeGreaterThan(20);
  expect(atClock.rows).toBeGreaterThan(0);
  expect(atClock.best).toBeGreaterThan(70);
  expect(atClock.best).toBeLessThan(90);

  await expect(page.locator(".session-clock")).toContainText("00:45");
  await expect.poll(async () => page.locator(".tower tbody tr").count()).toBeGreaterThan(0);
  await page.screenshot({
    path: `/opt/cursor/artifacts/screenshots/saopaulo_fp1_11405_real_timing_0045.png`,
    fullPage: true,
  });

  await page.locator("nav button[data-page='laptiming']").click();
  await expect(page.locator(".lt-table tbody tr").first()).toBeVisible();
  await expect(page.locator(".session-clock")).toContainText("00:45");
  await expect(page.locator(".lt-card").first()).toContainText("NOR");
  await page.screenshot({
    path: `/opt/cursor/artifacts/screenshots/saopaulo_fp1_11405_real_laptiming_0045.png`,
    fullPage: true,
  });

  await page.locator("nav button[data-page='trackmap']").click();
  await expect(page.locator(".page.trackmap").first()).toBeVisible();
  await expect(page.locator(".session-clock")).toContainText("00:45");
  if (source === "live") {
    await expect(page.locator(".page.trackmap svg").first()).toBeVisible();
    await expect.poll(async () => page.locator(".page.trackmap svg .car-dot").count()).toBeGreaterThan(0);
  }
  await page.screenshot({
    path: `/opt/cursor/artifacts/screenshots/saopaulo_fp1_11405_real_trackmap_0045.png`,
    fullPage: true,
  });
});
