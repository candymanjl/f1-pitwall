import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    playing: boolean;
    followLive: boolean;
    mode: string;
    loading: string;
    panelErrors: { track: string; telemetry: string };
    bundle: {
      track: [number, number][];
      outlineFrom: { year: number; meetingName: string; sessionName: string; sessionKey: number } | null;
      locations?: Array<{ date: string; driver_number: number; x: number; y: number }>;
    } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  ingestLive: (topic: string, payload: unknown) => void;
};

const START = Date.parse("2026-11-06T15:30:00.000Z");
const NOW = START + 10 * 60_000;

function oval(n = 48, rx = 4000, ry = 2200): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / (n - 1)) * Math.PI * 2;
    return [Math.cos(a) * rx, Math.sin(a) * ry];
  });
}

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function seedSaoPauloFp1Fallback(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, now, track }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const ant = {
        driver_number: 12,
        broadcast_name: "ANT",
        full_name: "Kimi Antonelli",
        name_acronym: "ANT",
        team_name: "Mercedes",
        team_colour: "27F4D2",
        first_name: "Kimi",
        last_name: "Antonelli",
      };
      const meeting = {
        meeting_key: 1299,
        meeting_name: "São Paulo Grand Prix",
        meeting_official_name: "FORMULA 1 MSC CRUISES GRANDE PRÊMIO DE SÃO PAULO 2026",
        circuit_key: 14,
        circuit_short_name: "Interlagos",
        country_name: "Brazil",
        location: "São Paulo",
        date_start: new Date(start).toISOString(),
        year: 2026,
      };
      const session = {
        session_key: 11405,
        meeting_key: 1299,
        session_name: "Practice 1",
        session_type: "Practice",
        date_start: new Date(start).toISOString(),
        date_end: new Date(start + 60 * 60_000).toISOString(),
        circuit_key: 14,
        circuit_short_name: "Interlagos",
        country_name: "Brazil",
        location: "São Paulo",
        year: 2026,
      };
      Object.assign(api.state, {
        year: 2026,
        meetingKey: 1299,
        sessionKey: 11405,
        start,
        end: now,
        t: now,
        mode: "live",
        playing: false,
        followLive: false,
        loading: "",
        error: "",
        panelErrors: { track: "", telemetry: "" },
        bundle: {
          meeting,
          session,
          weekendSessions: [session],
          drivers: [ant],
          laps: [
            {
              driver_number: 12,
              lap_number: 1,
              date_start: new Date(now - 25_000).toISOString(),
              lap_duration: null,
              duration_sector_1: null,
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
          intervals: [],
          positions: [{ date: new Date(now).toISOString(), driver_number: 12, position: 1 }],
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [
            {
              date: new Date(now).toISOString(),
              air_temperature: 22,
              track_temperature: 41,
              wind_speed: 3.4,
              wind_direction: 210,
              humidity: 48,
              rainfall: 0,
              pressure: 1011,
            },
          ],
          raceControl: [],
          track,
          corners: [],
          sectorFracs: [0.26, 0.5, 0.24],
          pitEntry: 0.96,
          pitExit: 0.06,
          outlineFrom: {
            year: 2025,
            meetingName: "São Paulo Grand Prix",
            sessionName: "Race",
            sessionKey: 9869,
          },
          locations: [{ date: new Date(now).toISOString(), driver_number: 12, x: track[8][0], y: track[8][1] }],
        },
      });
      api.setClock(now, "code");
    },
    { start: START, now: NOW, track: oval() },
  );
}

test("Track map uses a same-circuit fallback outline until live GPS is good", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await seedSaoPauloFp1Fallback(page);

  await expect(page.locator(".session-title")).toContainText("SÃO PAULO");
  await expect(page.locator(".page.trackmap .panel-h .t").last()).toContainText("Outline from 2025 São Paulo GP");
  const svg = page.locator("svg.track");
  await expect(svg).toHaveAttribute("data-outline-src", "fallback");
  await expect(svg.locator(".map-outline-note")).toHaveText("Outline from 2025 São Paulo GP");
  await expect(svg.locator("path.track-s1")).toHaveAttribute("stroke", "#e10600");
  await expect(svg.locator("path.track-s2")).toHaveAttribute("stroke", "#eab308");
  await expect(svg.locator("path.track-s3")).toHaveAttribute("stroke", "#3b82f6");
  await expect(page.locator(".page.trackmap .panel-error").last()).toBeHidden();
  await expect(svg.locator("[data-driver='12']")).toHaveCount(1);

  const wind = page.locator("svg.wind-map");
  await expect(wind).toHaveAttribute("data-outline", "ready");
  await expect(wind).toHaveAttribute("data-outline-src", "fallback");
  await expect(wind).not.toContainText("No outline");
  await expect(wind.locator("path.track-s1")).toHaveAttribute("stroke", "#e10600");

  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/trackmap_saopaulo_fp1_fallback_1920.png",
  });
  await page.locator("svg.track").screenshot({
    path: "/opt/cursor/artifacts/screenshots/trackmap_saopaulo_fp1_fallback_map.png",
  });
  await page.locator("svg.wind-map").screenshot({
    path: "/opt/cursor/artifacts/screenshots/trackmap_saopaulo_fp1_fallback_wind.png",
  });

  await page.evaluate(
    ({ start, now }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const samples = Array.from({ length: 80 }, (_, i) => {
        const a = (i / 79) * Math.PI * 2;
        return {
          date: new Date(start + 9 * 60_000 + i * 900).toISOString(),
          driver_number: 12,
          x: Math.cos(a) * 4000,
          y: Math.sin(a) * 2200,
          session_key: 11405,
        };
      });
      api.state.bundle &&
        ((api.state.bundle as { laps: unknown[] }).laps = [
          {
            driver_number: 12,
            lap_number: 2,
            date_start: new Date(start + 9 * 60_000).toISOString(),
            lap_duration: 72,
            duration_sector_1: 18,
            duration_sector_2: 37,
            duration_sector_3: 17,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          },
        ]);
      api.ingestLive("v1/location", samples);
      api.setClock(now, "code");
    },
    { start: START, now: NOW },
  );

  await expect.poll(async () => page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.bundle?.outlineFrom)).toBeNull();
  await expect(svg).toHaveAttribute("data-outline-src", "live");
  await expect(page.locator(".page.trackmap .panel-h .t").last()).toContainText("outline from OpenF1 /location");
  await expect(svg.locator(".map-outline-note")).toHaveCount(0);
  await expect(wind).toHaveAttribute("data-outline-src", "live");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/trackmap_saopaulo_fp1_live_outline_1920.png",
  });
});
