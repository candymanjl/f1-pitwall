import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    followLive: boolean;
    playing: boolean;
    showLiveDebug: boolean;
    liveSource: string;
    liveDebug: {
      mode?: string;
      lastPollAt: number | null;
      added: Record<string, number>;
      lastError: string;
      topicRates?: Record<string, number>;
      lastMessageAgeMs?: number | null;
      tabRole?: string;
    };
    snap: { leaderLap: number; scheduledLaps?: number | null; raceLaps: number } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  ingestLive: (topic: string, payload: unknown, mode?: "merge" | "replace") => void;
  setShowLiveDebug: (on: boolean) => void;
};

const START = Date.parse("2026-11-01T20:00:00.000Z");
const LAP12 = Date.parse("2026-11-01T20:16:00.000Z");

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadMexicoLive(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, lap12 }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const bundle = {
        meeting: {
          meeting_key: 1,
          meeting_name: "Mexico City Grand Prix",
          circuit_short_name: "Mexico City",
          country_name: "Mexico",
          location: "Mexico City",
          date_start: new Date(start).toISOString(),
          year: 2026,
        },
        session: {
          session_key: 99,
          meeting_key: 1,
          session_name: "Race",
          session_type: "Race",
          date_start: new Date(start).toISOString(),
          date_end: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
          circuit_short_name: "Mexico City",
          country_name: "Mexico",
          location: "Mexico City",
          year: 2026,
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
            lap_number: 12,
            date_start: new Date(lap12).toISOString(),
            lap_duration: null,
            duration_sector_1: 22,
            duration_sector_2: null,
            duration_sector_3: null,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          },
        ],
        intervals: [{ date: new Date(lap12).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 }],
        positions: [{ date: new Date(lap12).toISOString(), driver_number: 1, position: 1 }],
        stints: [],
        weekendStints: [],
        pits: [],
        weather: [],
        raceControl: [],
        locations: [{ date: new Date(lap12).toISOString(), driver_number: 1, x: 40, y: 20 }],
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
        end: lap12,
        t: lap12,
        mode: "live",
        playing: true,
        followLive: true,
        scrubbing: false,
        sessionKey: 99,
        liveSource: "poll",
        liveDebug: {
          mode: "POLLING",
          lastPollAt: Date.parse("2026-11-01T20:57:04.000Z"),
          lastCycleMs: 880,
          added: { location: 12, position: 4, intervals: 4, laps: 0 },
          lastError: "ok",
          topicRates: {},
          lastMessageAgeMs: 4000,
          tabRole: "leader",
        },
      });
      api.setClock(lap12, "code");
    },
    { start: START, lap12: LAP12 },
  );
}

test("headline uses scheduled 71 laps and debug line reports poll rows", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await loadMexicoLive(page);

  await expect(page.locator(".session-clock")).toContainText("Lap 12 / 71");
  await expect(page.locator(".session-clock")).not.toContainText("Lap 12 / 12");

  await page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.setShowLiveDebug(true));
  await expect(page.locator(".live-debug")).toBeVisible();
  await expect(page.locator(".live-debug")).toContainText("POLLING");
  await expect(page.locator(".live-debug")).toContainText("location +12");
  await expect(page.locator(".live-debug")).toContainText("laps +0");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_rate_debug_1920.png" });

  const later = LAP12 + 4000;
  await page.evaluate((iso) => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.ingestLive("v1/location", [{ date: iso, driver_number: 1, x: 55, y: 22, session_key: 99 }]);
    api.ingestLive("v1/intervals", [{ date: iso, driver_number: 1, gap_to_leader: 0, interval: 0, session_key: 99 }]);
  }, new Date(later).toISOString());

  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.t)).toBe(later);
  await expect(page.locator(".session-clock")).toContainText("Lap 12 / 71");

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_rate_debug_1366.png" });
});

test("debug line reports STREAM rates and a second-tab warning", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await loadMexicoLive(page);
  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.state.liveSource = "mqtt";
    api.state.liveDebug = {
      mode: "STREAM",
      lastPollAt: Date.parse("2026-11-01T20:57:04.000Z"),
      added: {},
      lastError: "ok",
      topicRates: { "v1/location": 12.4, "v1/position": 2 },
      lastMessageAgeMs: 400,
      tabRole: "leader",
    };
    api.setShowLiveDebug(true);
  });
  await expect(page.locator(".live-debug")).toContainText("STREAM");
  await expect(page.locator(".live-debug")).toContainText("v1/location 12.4/s");
  await expect(page.locator(".live-debug")).toContainText("last 0.4s");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_mqtt_stream_debug.png" });

  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.state.liveDebug = {
      ...api.state.liveDebug,
      tabRole: "follower",
    };
    api.setShowLiveDebug(true);
  });
  await expect(page.locator(".live-tab-warn")).toBeVisible();
  await expect(page.locator(".live-tab-warn")).toContainText("Another pitwall tab is already polling");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/live_tab_warn.png" });
});

test("settings describe MQTT through the relay and REST fallback", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?e2e=1&settings=1#trackmap");
  await waitForApp(page);
  await expect(page.locator(".modal")).toBeVisible();
  await expect(page.locator(".modal")).toContainText("wss://mqtt.openf1.org:8084/mqtt");
  await expect(page.locator(".modal")).toContainText("even when a relay is set");
  await expect(page.locator(".modal")).toContainText("STREAM or POLLING");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/settings_mqtt_relay.png" });
});
