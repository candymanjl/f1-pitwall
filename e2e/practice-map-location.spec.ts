import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    snap: {
      rows: {
        driver: { driver_number: number; name_acronym: string };
        retired: boolean;
        inGarage?: boolean;
        status: string;
        gap: number | string | null;
        currentLap: number | null;
      }[];
    } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
};

const FP1_START = Date.parse("2026-01-16T20:00:00.000Z");
const RACE_START = Date.parse("2025-10-26T20:00:00.000Z");
const LAP_MS = 80_000;
const TRACK: [number, number][] = [
  [0, 0],
  [140, 0],
  [140, 90],
  [0, 90],
  [0, 0],
];
const FP1_TIMES = {
  early: FP1_START + 3 * 60_000,
  bug: FP1_START + 6 * 60_000 + 47_000,
  later: FP1_START + 12 * 60_000 + 10_000,
} as const;
const ON_TRACK = [
  { n: 12, code: "ANT", colour: "27F4D2" },
  { n: 16, code: "LEC", colour: "E8002D" },
  { n: 11, code: "PER", colour: "3671C6" },
  { n: 41, code: "LIN", colour: "1868DB" },
  { n: 10, code: "GAS", colour: "0093CC" },
  { n: 6, code: "HAD", colour: "6692FF" },
  { n: 5, code: "VES", colour: "52E252" },
  { n: 87, code: "BRO", colour: "B6BABD" },
] as const;
const GARAGE = [
  { n: 14, code: "ALO", colour: "229971" },
  { n: 18, code: "SLA", colour: "229971" },
] as const;
const SPOTS: [number, number][] = [
  [20, 0],
  [80, 0],
  [140, 20],
  [140, 70],
  [100, 90],
  [40, 90],
  [0, 60],
  [0, 15],
];

function nearestFrac(pts: [number, number][], x: number, y: number): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (total <= 0) return 0;
  let bestD = Infinity;
  let bestAt = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const ay = pts[i - 1][1];
    const bx = pts[i][0];
    const by = pts[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const seg = Math.hypot(dx, dy);
    if (seg <= 0) continue;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (seg * seg)));
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < bestD) {
      bestD = d;
      bestAt = acc + t * seg;
    }
    acc += seg;
  }
  return bestAt / total;
}

function spotsAt(shift: number): [number, number][] {
  return ON_TRACK.map((_, i) => SPOTS[(i + shift) % SPOTS.length]);
}

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function waitApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

function minCircularGap(fracs: number[]): number {
  const sorted = [...fracs].sort((a, b) => a - b);
  let min = 1;
  for (let i = 0; i < sorted.length; i++) {
    const d = i + 1 === sorted.length ? sorted[0] + 1 - sorted[i] : sorted[i + 1] - sorted[i];
    min = Math.min(min, d);
  }
  return min;
}

async function loadMexico2026Fp1(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, times, spots, onTrack, garage, track }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const people = [...onTrack, ...garage];
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
      const locations = [];
      for (const [i, d] of onTrack.entries()) {
        for (let n = 1; n <= 10; n += 1) {
          laps.push({
            driver_number: d.n,
            lap_number: n,
            date_start: new Date(start + (n - 1) * 80_000 + i * 1_500).toISOString(),
            lap_duration: 79.05 + i * 0.11,
            duration_sector_1: 22,
            duration_sector_2: 29,
            duration_sector_3: 28,
            is_pit_out_lap: false,
            segments_sector_1: null,
            segments_sector_2: null,
            segments_sector_3: null,
            i1_speed: null,
            i2_speed: null,
            st_speed: null,
          });
        }
      }
      const frames: Array<{ t: number; shift: number }> = [
        { t: times.early, shift: 2 },
        { t: times.bug, shift: 0 },
        { t: times.later, shift: 5 },
      ];
      for (const frame of frames) {
        for (const [i, d] of onTrack.entries()) {
          const xy = spots[(i + frame.shift) % spots.length];
          for (const dt of [-800, 0, 800]) {
            locations.push({
              date: new Date(frame.t + dt).toISOString(),
              driver_number: d.n,
              x: xy[0],
              y: xy[1],
            });
          }
        }
      }
      Object.assign(api.state, {
        bundle: {
          meeting: {
            meeting_key: 1300,
            meeting_name: "Mexico City Grand Prix",
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            date_start: new Date(start).toISOString(),
            year: 2026,
          },
          session: {
            session_key: 9991,
            meeting_key: 1300,
            session_name: "Practice 1",
            session_type: "Practice",
            date_start: new Date(start).toISOString(),
            date_end: new Date(start + 60 * 60_000).toISOString(),
            circuit_short_name: "Mexico City",
            country_name: "Mexico",
            location: "Mexico City",
            year: 2026,
          },
          weekendSessions: [],
          drivers,
          laps,
          intervals: [],
          positions: [],
          stints: [],
          weekendStints: [],
          pits: [],
          weather: [
            {
              date: new Date(start).toISOString(),
              air_temperature: 19.2,
              track_temperature: 36.4,
              wind_speed: 2.8,
              wind_direction: 190,
              humidity: 48,
              rainfall: 0,
            },
          ],
          raceControl: [],
          track,
          corners: [],
          sectorFracs: [0.3, 0.4, 0.3],
          pitEntry: 0.96,
          pitExit: 0.06,
          locations,
        },
        start,
        end: start + 60 * 60_000,
        mode: "historical",
        playing: false,
        followLive: false,
        sessionKey: 9991,
        meetingKey: 1300,
        year: 2026,
        selectedDriver: null,
        selectedDrivers: [],
      });
    },
    { start: FP1_START, times: FP1_TIMES, spots: SPOTS, onTrack: ON_TRACK, garage: GARAGE, track: TRACK },
  );
}

async function loadMexico2025Race(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, lapMs, track, spots }) => {
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
      const locations = [];
      const t68 = start + 67 * lapMs + 0.4 * lapMs;
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
      const running = [...lead, ...lapped];
      const raceSpots: [number, number][] = [
        [12, 0],
        [36, 0],
        [68, 0],
        [104, 0],
        [132, 0],
        [140, 18],
        [140, 42],
        [140, 68],
        [140, 88],
        [112, 90],
        [78, 90],
        [46, 90],
        [16, 90],
        [0, 72],
        [0, 48],
        [0, 24],
        [0, 6],
      ];
      for (const [i, d] of running.entries()) {
        const xy = raceSpots[i] ?? spots[i % spots.length];
        locations.push({
          date: new Date(t68).toISOString(),
          driver_number: d.n,
          x: xy[0],
          y: xy[1],
        });
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
          track,
          corners: [],
          sectorFracs: [0.3, 0.4, 0.3],
          pitEntry: 0.96,
          pitExit: 0.06,
          locations,
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
    { start: RACE_START, lapMs: LAP_MS, track: TRACK, spots: SPOTS },
  );
}

async function mapCars(page: Page) {
  return page.locator("svg.track [data-driver]").evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: Number(n.getAttribute("data-driver")),
      code: n.querySelector(".drv-label")?.textContent ?? "",
      frac: Number(n.getAttribute("data-frac")),
      place: n.getAttribute("data-place"),
      x: Number(n.getAttribute("data-x")),
      y: Number(n.getAttribute("data-y")),
    })),
  );
}

test("Mexico 2026 FP1 places cars from /location and hides the garage", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitApp(page);
  await loadMexico2026Fp1(page);

  const frames: Array<{ key: keyof typeof FP1_TIMES; shift: number; label: string }> = [
    { key: "early", shift: 2, label: "00:03:00" },
    { key: "bug", shift: 0, label: "00:06:47" },
    { key: "later", shift: 5, label: "00:12:10" },
  ];

  for (const frame of frames) {
    const t = FP1_TIMES[frame.key];
    await page.evaluate((now) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(now, "code"), t);
    await expect(page.locator(".session-clock")).toContainText(frame.label);

    const api = await hooks(page);
    const rows = api.state.snap?.rows ?? [];
    const garage = rows.filter((r) => r.status === "GARAGE" || r.inGarage);
    expect(garage.map((r) => r.driver.name_acronym).sort()).toEqual(["ALO", "SLA"]);
    expect(garage.every((r) => r.gap == null || (typeof r.gap === "number" && r.gap < 100))).toBe(true);
    expect(garage.every((r) => r.currentLap == null)).toBe(true);

    const expected = new Map(
      ON_TRACK.map((d, i) => {
        const xy = spotsAt(frame.shift)[i];
        return [d.n, nearestFrac(TRACK, xy[0], xy[1])];
      }),
    );

    const cars = await mapCars(page);
    expect(cars.map((c) => c.code).sort()).toEqual(ON_TRACK.map((d) => d.code).sort());
    expect(cars.every((c) => c.place === "location")).toBe(true);
    expect(cars.some((c) => c.code === "ALO" || c.code === "SLA")).toBe(false);
    await expect(page.locator("svg.track")).toHaveAttribute("data-cars", String(ON_TRACK.length));
    await expect(page.locator("canvas.gapline")).toHaveAttribute("data-cars", String(ON_TRACK.length));
    expect(new Set(cars.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)).size).toBe(ON_TRACK.length);
    expect(minCircularGap(cars.map((c) => c.frac))).toBeGreaterThan(0.05);
    for (const car of cars) {
      const want = expected.get(car.id);
      expect(want, `location frac for ${car.code}`).toBeDefined();
      expect(car.frac).toBeCloseTo(want!, 2);
    }

    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_2026_fp1_${frame.key}_1920.png`,
      fullPage: true,
    });

    if (frame.key === "bug") {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.evaluate((now) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(now, "code"), t);
      const compact = await mapCars(page);
      expect(compact).toHaveLength(ON_TRACK.length);
      expect(minCircularGap(compact.map((c) => c.frac))).toBeGreaterThan(0.05);
      await page.screenshot({
        path: "/opt/cursor/artifacts/screenshots/mexico_2026_fp1_bug_1366.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
  }

  await page.evaluate((now) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(now, "code"), FP1_TIMES.bug);
  await page.locator("nav button[data-page='pitcircle']").click();
  const circle = page.locator("svg.circle");
  await expect(circle).toBeVisible();
  await expect(circle).toHaveAttribute("data-cars", String(ON_TRACK.length));
  await expect(circle.locator("[data-driver]")).toHaveCount(ON_TRACK.length);
  const circleCodes = await circle.locator("[data-driver] .drv-label").allTextContents();
  for (const d of ON_TRACK) expect(circleCodes.some((text) => text.includes(d.code))).toBe(true);
  expect(circleCodes.some((text) => text.includes("ALO") || text.includes("SLA"))).toBe(false);
  const circlePlaces = await circle.locator("[data-driver]").evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("data-place")),
  );
  expect(circlePlaces.every((p) => p === "location")).toBe(true);
  await expect(page.locator("canvas.gapline")).toHaveAttribute("data-cars", String(ON_TRACK.length));
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/mexico_2026_fp1_circle_1920.png",
    fullPage: true,
  });
});

test("Mexico 2025 Race lap 68 prefers /location and keeps every running car", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitApp(page);
  await loadMexico2025Race(page);
  const t68 = RACE_START + 67 * LAP_MS + 0.4 * LAP_MS;
  await page.evaluate((now) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(now, "code"), t68);
  await expect(page.locator(".session-clock")).toContainText("LAP 68/");

  const api = await hooks(page);
  const running = (api.state.snap?.rows ?? []).filter((r) => !r.retired && r.status !== "OUT");
  expect(running).toHaveLength(17);

  const cars = await mapCars(page);
  expect(cars).toHaveLength(17);
  expect(cars.every((c) => c.place === "location")).toBe(true);
  expect(new Set(cars.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)).size).toBe(17);
  expect(minCircularGap(cars.map((c) => c.frac))).toBeGreaterThan(0.02);
  await expect(page.locator("svg.track")).toHaveAttribute("data-cars", "17");
  await expect(page.locator("canvas.gapline")).toHaveAttribute("data-cars", "17");

  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/mexico_2025_race_lap68_location_1920.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate((now) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(now, "code"), t68);
  const compact = await mapCars(page);
  expect(compact).toHaveLength(17);
  expect(compact.every((c) => c.place === "location")).toBe(true);
  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/mexico_2025_race_lap68_location_1366.png",
    fullPage: true,
  });
});
