import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    snap: {
      medianGreenLap: number;
      rows: {
        pos: number;
        progress: number;
        gap: number | string | null;
        interval: number | string | null;
        retired: boolean;
        status: string;
        driver: { driver_number: number; name_acronym: string };
      }[];
    } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const LAP_MS = 80_000;
const CHECKS = [20, 40, 60, 68] as const;
const LAPPED = new Set(["NOR", "GAS", "STR", "ALB", "COL", "HAD"]);

function wrap01(frac: number): number {
  return ((frac % 1) + 1) % 1;
}

function gapFrac(leaderProgress: number, gapSec: number, lapSec: number): number {
  return wrap01(leaderProgress - gapSec / Math.max(1, lapSec));
}

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

function nowAt(lap: number, frac = 0.4): number {
  return START + (lap - 1) * LAP_MS + frac * LAP_MS;
}

async function loadMexico2025Race(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, lapMs }) => {
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
      const trackPts: [number, number][] = [
        [0, 0],
        [140, 0],
        [140, 90],
        [0, 90],
        [0, 0],
      ];
      const gps: [number, number][] = [
        [8, 0],
        [40, 0],
        [90, 0],
        [130, 0],
        [140, 30],
        [140, 70],
        [110, 90],
        [60, 90],
        [20, 90],
        [0, 60],
        [0, 20],
        [24, 0],
        [70, 0],
        [140, 50],
        [80, 90],
        [0, 40],
        [12, 0],
      ];
      for (const d of people) {
        const lastLap = d.code === "LAW" ? 8 : 70;
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
        for (const lap of [20, 40, 60, 68, 70]) {
          const t = start + (lap - 1) * lapMs + 0.4 * lapMs;
          const i = lead.findIndex((x) => x.n === d.n);
          const li = lapped.findIndex((x) => x.n === d.n);
          intervals.push({
            date: new Date(t).toISOString(),
            driver_number: d.n,
            gap_to_leader: i === 0 ? 0 : i > 0 ? i * 1.2 : "+1 LAP",
            interval: i === 0 ? 0 : i > 0 ? 1.2 : li === 0 ? "+1 LAP" : 1.4,
          });
          positions.push({
            date: new Date(t).toISOString(),
            driver_number: d.n,
            position: people.findIndex((x) => x.n === d.n) + 1,
          });
        }
      }
      const running = [...lead, ...lapped];
      for (const lap of [20, 40, 60, 68, 70]) {
        const t = start + (lap - 1) * lapMs + 0.4 * lapMs;
        for (const [i, d] of running.entries()) {
          const xy = gps[i % gps.length];
          locations.push({
            date: new Date(t).toISOString(),
            driver_number: d.n,
            x: xy[0],
            y: xy[1],
          });
          locations.push({
            date: new Date(t + 2000).toISOString(),
            driver_number: d.n,
            x: gps[(i + 5) % gps.length][0],
            y: gps[(i + 5) % gps.length][1],
          });
        }
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
          weather: [],
          raceControl: [],
          track: trackPts,
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
    { start: START, lapMs: LAP_MS },
  );
}

async function circleCars(page: Page) {
  return page.locator("svg.circle [data-driver]").evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: Number(n.getAttribute("data-driver")),
      code: (n.querySelector(".drv-label")?.textContent ?? "").replace(/^\d+\s+/, ""),
      frac: Number(n.getAttribute("data-frac")),
      place: n.getAttribute("data-place"),
    })),
  );
}

async function mapCars(page: Page) {
  return page.locator("svg.track [data-driver]").evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: Number(n.getAttribute("data-driver")),
      frac: Number(n.getAttribute("data-frac")),
      place: n.getAttribute("data-place"),
    })),
  );
}

test("Mexico 2025 race pit circle stays on gap time while the map uses GPS", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#pitcircle");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  await loadMexico2025Race(page);

  for (const lap of CHECKS) {
    await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), nowAt(lap));
    await expect(page.locator(".session-clock")).toContainText(`Lap ${lap} /`);
    const api = await hooks(page);
    const rows = (api.state.snap?.rows ?? []).filter((r) => !r.retired && r.status !== "OUT");
    expect(rows.length).toBe(17);
    const lapSec = api.state.snap?.medianGreenLap ?? 80;
    const leaderProg = rows[0]?.progress ?? 0;

    const circle = await circleCars(page);
    expect(circle).toHaveLength(17);
    await expect(page.locator("svg.circle")).toHaveAttribute("data-cars", "17");
    const leadCircle = circle.filter((c) => !LAPPED.has(c.code));
    expect(leadCircle.every((c) => c.place === "gap")).toBe(true);
    for (const car of circle) {
      const row = rows.find((r) => r.driver.driver_number === car.id);
      expect(row, car.code).toBeTruthy();
      const gap = row!.pos === 1 ? 0 : typeof row!.gap === "number" ? row!.gap : null;
      if (gap != null) {
        expect(car.place).toBe("gap");
        expect(car.frac).toBeCloseTo(gapFrac(leaderProg, gap, lapSec), 2);
      } else {
        expect(car.place === "gap" || car.place === "progress").toBe(true);
        expect(car.frac).not.toBeCloseTo(circle.find((c) => c.code === rows[0].driver.name_acronym)?.frac ?? -1, 2);
      }
    }
    for (const code of LAPPED) expect(circle.some((c) => c.code.includes(code))).toBe(true);

    await page.locator("nav button[data-page='trackmap']").click();
    const map = await mapCars(page);
    expect(map).toHaveLength(17);
    expect(map.every((c) => c.place === "location")).toBe(true);
    const moved = map.filter((m) => {
      const c = circle.find((x) => x.id === m.id);
      return c && Math.abs(c.frac - m.frac) > 0.08;
    });
    expect(moved.length).toBeGreaterThan(5);
    await page.locator("nav button[data-page='pitcircle']").click();

    const before = await circleCars(page);
    await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "scrub"), nowAt(lap) + 2000);
    const after = await circleCars(page);
    expect(after).toHaveLength(17);
    for (const car of after) {
      const prev = before.find((c) => c.id === car.id);
      expect(car.place).toBe(prev?.place ?? "");
      expect(Math.abs(car.frac - (prev?.frac ?? 0))).toBeLessThan(0.06);
    }

    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_pitcircle_time_lap${lap}_1920.png`,
      fullPage: true,
    });

    if (lap === 68) {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.evaluate((t) => (window as unknown as { __f1pw: Hooks }).__f1pw.setClock(t, "code"), nowAt(lap));
      await expect(page.locator("svg.circle")).toHaveAttribute("data-cars", "17");
      const compact = await circleCars(page);
      expect(compact.every((c) => !LAPPED.has(c.code) ? c.place === "gap" : true)).toBe(true);
      await page.screenshot({
        path: "/opt/cursor/artifacts/screenshots/mexico_pitcircle_time_lap68_1366.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
  }
});
