import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

type Hooks = {
  state: { t: number; playing: boolean; speed: number };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
  setSpeed: (n: number) => void;
  motionJumpSummary: () => {
    rawMax: number;
    shownMax: number;
    rawMean: number;
    shownMean: number;
    nRaw: number;
    nShown: number;
  };
};

const START = Date.parse("2025-11-09T18:00:00.000Z");
const T0 = START + 8 * 60_000;
const TRACK: [number, number][] = [
  [0, 0],
  [140, 0],
  [140, 90],
  [0, 90],
  [0, 0],
];
const CARS = [
  { n: 12, code: "ANT", colour: "27F4D2", phase: 0 },
  { n: 4, code: "NOR", colour: "FF8000", phase: 0.18 },
  { n: 16, code: "LEC", colour: "E8002D", phase: 0.41 },
] as const;

function pointOnTrack(frac: number): [number, number] {
  const pts = TRACK;
  const f = ((frac % 1) + 1) % 1;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let remain = f * total;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    const seg = Math.hypot(dx, dy);
    if (remain <= seg) {
      const t = seg === 0 ? 0 : remain / seg;
      return [pts[i - 1][0] + dx * t, pts[i - 1][1] + dy * t];
    }
    remain -= seg;
  }
  return pts[pts.length - 1];
}

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function loadReplay(page: Page): Promise<void> {
  const locations: Array<{ date: string; driver_number: number; x: number; y: number }> = [];
  for (let ms = 0; ms <= 8_000; ms += 250) {
    const t = T0 + ms;
    for (const car of CARS) {
      const frac = car.phase + ms / 80_000;
      const [x, y] = pointOnTrack(frac);
      locations.push({ date: new Date(t).toISOString(), driver_number: car.n, x, y });
    }
  }
  await page.evaluate(
    ({ start, t0, track, cars, locations }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const drivers = cars.map((d) => ({
        driver_number: d.n,
        broadcast_name: d.code,
        full_name: d.code,
        name_acronym: d.code,
        team_name: "Test",
        team_colour: d.colour,
        first_name: d.code,
        last_name: d.code,
      }));
      Object.assign(api.state, {
        bundle: {
          meeting: {
            meeting_key: 1272,
            meeting_name: "São Paulo Grand Prix",
            circuit_short_name: "Interlagos",
            country_name: "Brazil",
            location: "São Paulo",
            date_start: new Date(start).toISOString(),
            year: 2025,
          },
          session: {
            session_key: 9869,
            meeting_key: 1272,
            session_name: "Race",
            session_type: "Race",
            date_start: new Date(start).toISOString(),
            date_end: new Date(start + 90 * 60_000).toISOString(),
            circuit_short_name: "Interlagos",
            country_name: "Brazil",
            location: "São Paulo",
            year: 2025,
          },
          weekendSessions: [],
          drivers,
          laps: cars.map((d) => ({
            driver_number: d.n,
            lap_number: 12,
            date_start: new Date(t0 - 20_000).toISOString(),
            lap_duration: null,
            duration_sector_1: 18.4,
            duration_sector_2: null,
            duration_sector_3: null,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          })),
          intervals: cars.map((d, i) => ({
            date: new Date(t0).toISOString(),
            driver_number: d.n,
            gap_to_leader: i * 1.8,
            interval: i === 0 ? 0 : 1.8,
          })),
          positions: cars.map((d, i) => ({
            date: new Date(t0).toISOString(),
            driver_number: d.n,
            position: i + 1,
          })),
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [],
          raceControl: [],
          track,
          corners: [],
          sectorFracs: [0.3, 0.4, 0.3],
          locations,
        },
        start,
        end: t0 + 8_000,
        t: t0,
        mode: "historical",
        playing: false,
        followLive: false,
        speed: 4,
        scrubbing: false,
        sessionKey: 9869,
      });
      api.setSpeed(4);
      api.setClock(t0, "code");
    },
    { start: START, t0: T0, track: TRACK, cars: CARS, locations },
  );
}

async function mapFracs(page: Page): Promise<number[]> {
  return page.locator("svg.track g.car-hit").evaluateAll((nodes) =>
    nodes.map((n) => Number(n.getAttribute("data-frac"))),
  );
}

test("smoothed icons glide on map, pit circle, and strip", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await loadReplay(page);

  await expect(page.locator("svg.track")).toHaveAttribute("data-cars", "3");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/smooth_icons_before_1920.png",
    fullPage: true,
  });

  const frames: number[][] = [await mapFracs(page)];
  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.setPlaying(true);
  });
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(80);
    frames.push(await mapFracs(page));
  }

  const stats = await page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.motionJumpSummary());
  expect(stats.nShown).toBeGreaterThan(10);
  expect(stats.shownMax).toBeLessThan(stats.rawMax);
  expect(stats.shownMax).toBeLessThan(0.012);

  const stepNote = [
    `raw sample jumps: max=${stats.rawMax.toFixed(4)} mean=${stats.rawMean.toFixed(4)} (n=${stats.nRaw})`,
    `smoothed frame jumps: max=${stats.shownMax.toFixed(4)} mean=${stats.shownMean.toFixed(4)} (n=${stats.nShown})`,
    `ratio shown/raw max=${(stats.shownMax / Math.max(stats.rawMax, 1e-9)).toFixed(2)}`,
    `map frac frames: ${frames.map((f) => f.map((x) => x.toFixed(3)).join(",")).join(" | ")}`,
  ].join("\n");
  writeFileSync("/opt/cursor/artifacts/smooth_icon_jumps.txt", `${stepNote}\n`);

  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/smooth_icons_after_1920.png",
    fullPage: true,
  });
  await page.locator("svg.track").screenshot({
    path: "/opt/cursor/artifacts/screenshots/smooth_icons_map_1920.png",
  });
  await page.locator("canvas.gapline").screenshot({
    path: "/opt/cursor/artifacts/screenshots/smooth_icons_strip_1920.png",
  });

  await page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.setPlaying(false));
  const pausedMap = await mapFracs(page);
  await page.locator("nav button[data-page='pitcircle']").click();
  await expect(page.locator("svg.circle")).toHaveAttribute("data-cars", "3");
  const circleFracs = await page.locator("svg.circle g.car-hit").evaluateAll((nodes) =>
    nodes.map((n) => Number(n.getAttribute("data-frac"))),
  );
  expect(circleFracs[0]).toBeCloseTo(pausedMap[0], 3);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/smooth_icons_circle_1920.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.locator("nav button[data-page='trackmap']").click();
  await expect(page.locator("svg.track")).toHaveAttribute("data-cars", "3");
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/smooth_icons_after_1366.png",
    fullPage: true,
  });

  await page.waitForTimeout(200);
  const still = await mapFracs(page);
  expect(still[0]).toBeCloseTo(pausedMap[0], 4);
});
