import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    followLive: boolean;
    playing: boolean;
    selectedDriver: number | null;
    selectedDrivers: number[];
    snap: { rows: { driver: { driver_number: number } }[] } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
};

const START = Date.parse("2026-10-31T20:00:00.000Z");
const MID = Date.parse("2026-10-31T20:20:00.000Z");
const END = Date.parse("2026-10-31T21:28:00.000Z");

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function loadRace(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, mid, end }) => {
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
        {
          driver_number: 16,
          broadcast_name: "LEC",
          full_name: "Charles Leclerc",
          name_acronym: "LEC",
          team_name: "Ferrari",
          team_colour: "E8002D",
          first_name: "Charles",
          last_name: "Leclerc",
        },
      ];
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
          date_end: "2026-10-31T22:00:00.000Z",
          circuit_short_name: "Mexico City",
          country_name: "Mexico",
          location: "Mexico City",
          year: 2026,
        },
        weekendSessions: [],
        drivers,
        laps: drivers.flatMap((d) => [
          {
            driver_number: d.driver_number,
            lap_number: 1,
            date_start: new Date(start + 12_000).toISOString(),
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
          },
          {
            driver_number: d.driver_number,
            lap_number: 18,
            date_start: new Date(mid).toISOString(),
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
          },
        ]),
        intervals: [
          { date: new Date(mid).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 },
          { date: new Date(mid).toISOString(), driver_number: 44, gap_to_leader: 1.4, interval: 1.4 },
          { date: new Date(mid).toISOString(), driver_number: 16, gap_to_leader: 2.8, interval: 1.4 },
          { date: new Date(end).toISOString(), driver_number: 1, gap_to_leader: 0, interval: 0 },
          { date: new Date(end).toISOString(), driver_number: 44, gap_to_leader: 1.1, interval: 1.1 },
          { date: new Date(end).toISOString(), driver_number: 16, gap_to_leader: 2.2, interval: 1.1 },
        ],
        positions: [
          { date: new Date(mid).toISOString(), driver_number: 1, position: 1 },
          { date: new Date(mid).toISOString(), driver_number: 44, position: 2 },
          { date: new Date(mid).toISOString(), driver_number: 16, position: 3 },
        ],
        stints: [],
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
        end,
        t: mid,
        mode: "historical",
        playing: false,
        followLive: false,
        scrubbing: false,
        sessionKey: 99,
        liveSource: null,
        speed: 8,
        selectedDriver: null,
        selectedDrivers: [],
      });
      api.setClock(mid, "code");
    },
    { start: START, mid: MID, end: END },
  );
}

async function play(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    api.state.followLive = false;
    (api.state as { speed?: number }).speed = 8;
    api.setPlaying(true);
  });
}

async function selected(page: Page): Promise<number | null> {
  return (await hooks(page)).state.selectedDriver;
}

async function clickTower(page: Page, n: number): Promise<void> {
  const row = page.locator(`table.tower tbody tr[data-driver='${n}']`);
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect
    .poll(async () => {
      box = await row.boundingBox();
      return box != null && box.width > 8 && box.height > 8;
    })
    .toBe(true);
  await page.mouse.click(box!.x + Math.min(48, box!.width / 2), box!.y + box!.height / 2);
}

async function clickDot(page: Page, n: number): Promise<void> {
  let pos: { x: number; y: number } | null = null;
  await expect
    .poll(async () => {
      pos = await page.evaluate((n) => {
        const g = document.querySelector(`svg.circle [data-driver='${n}'], svg.track [data-driver='${n}']`);
        const svg = g?.closest("svg");
        if (!(g instanceof Element) || !(svg instanceof SVGSVGElement)) return null;
        const x = Number(g.getAttribute("data-x"));
        const y = Number(g.getAttribute("data-y"));
        const ctm = svg.getScreenCTM();
        if (!ctm || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f };
      }, n);
      return pos != null;
    })
    .toBe(true);
  await page.mouse.click(pos!.x + 8, pos!.y + 6);
}

async function assertSelectsWhilePlaying(
  page: Page,
  click: (n: number) => Promise<void>,
): Promise<void> {
  await play(page);
  expect((await hooks(page)).state.playing).toBe(true);
  for (let i = 0; i < 6; i++) {
    await click(1);
    expect(await selected(page), `VER click ${i}`).toBe(1);
    await click(44);
    expect(await selected(page), `HAM click ${i}`).toBe(44);
  }
}

test("driver selection stays reliable on tower, track map, and pit circle while playing", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/?e2e=1#pitcircle");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  await loadRace(page);
  await expect.poll(async () => (await hooks(page)).state.snap?.rows.length ?? 0).toBeGreaterThanOrEqual(2);

  await assertSelectsWhilePlaying(page, (n) => clickTower(page, n));
  await assertSelectsWhilePlaying(page, (n) => clickDot(page, n));

  await page.locator("nav button[data-page='trackmap']").click();
  await expect(page.locator("svg.track [data-driver='1']")).toBeVisible();
  await expect(page.locator("table.tower tbody tr[data-driver='1']")).toBeVisible();
  await assertSelectsWhilePlaying(page, (n) => clickTower(page, n));
  await assertSelectsWhilePlaying(page, (n) => clickDot(page, n));

  await page.locator("nav button[data-page='timing']").click();
  await expect(page.locator(".page.timing table.tower tbody tr[data-driver='1']")).toBeVisible();
  await assertSelectsWhilePlaying(page, (n) => clickTower(page, n));
});
