import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    start: number;
    end: number;
    playing: boolean;
    selectedDriver: number | null;
    selectedDrivers: number[];
    traceMode: string;
    traceDriver: number | null;
    pitLoss: { green: number };
    pitMode: string;
    snap: { rows: { driver: { driver_number: number }; progress: number }[] } | null;
  };
  setClock: (t: number, source?: "scrub" | "code") => void;
  setPlaying: (on: boolean) => void;
};

const START = Date.parse("2025-10-26T20:00:00.000Z");
const MID = Date.parse("2025-10-26T20:20:00.000Z");
const END = Date.parse("2025-10-26T21:28:00.000Z");

async function hooks(page: Page): Promise<Hooks> {
  return page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw);
}

async function loadMexico2025(page: Page): Promise<void> {
  await page.evaluate(
    ({ start, mid, end }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      const drivers = [
        { driver_number: 1, broadcast_name: "VER", full_name: "Max Verstappen", name_acronym: "VER", team_name: "Red Bull", team_colour: "3671C6", first_name: "Max", last_name: "Verstappen" },
        { driver_number: 44, broadcast_name: "HAM", full_name: "Lewis Hamilton", name_acronym: "HAM", team_name: "Ferrari", team_colour: "E8002D", first_name: "Lewis", last_name: "Hamilton" },
        { driver_number: 16, broadcast_name: "LEC", full_name: "Charles Leclerc", name_acronym: "LEC", team_name: "Ferrari", team_colour: "E8002D", first_name: "Charles", last_name: "Leclerc" },
        { driver_number: 4, broadcast_name: "NOR", full_name: "Lando Norris", name_acronym: "NOR", team_name: "McLaren", team_colour: "FF8000", first_name: "Lando", last_name: "Norris" },
        { driver_number: 81, broadcast_name: "PIA", full_name: "Oscar Piastri", name_acronym: "PIA", team_name: "McLaren", team_colour: "FF8000", first_name: "Oscar", last_name: "Piastri" },
        { driver_number: 63, broadcast_name: "RUS", full_name: "George Russell", name_acronym: "RUS", team_name: "Mercedes", team_colour: "27F4D2", first_name: "George", last_name: "Russell" },
      ];
      const laps = drivers.flatMap((d) => [
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
      ]);
      const bundle = {
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
        intervals: drivers.map((d, i) => ({
          date: new Date(mid).toISOString(),
          driver_number: d.driver_number,
          gap_to_leader: i * 0.35,
          interval: i === 0 ? 0 : 0.35,
        })),
        positions: drivers.map((d, i) => ({
          date: new Date(mid).toISOString(),
          driver_number: d.driver_number,
          position: i + 1,
        })),
        stints: [],
        weekendStints: [],
        pits: [],
        weather: [
          {
            date: new Date(mid).toISOString(),
            air_temperature: 21.4,
            track_temperature: 38.2,
            wind_speed: 4.2,
            wind_direction: 210,
            humidity: 44,
            rainfall: 0,
          },
        ],
        raceControl: [],
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
        sessionKey: 9877,
        meetingKey: 1272,
        year: 2025,
        liveSource: null,
        speed: 4,
        selectedDriver: null,
        selectedDrivers: [],
        pitMode: "green",
        pitLoss: { green: 22, vsc: 13, sc: 10 },
        traceMode: "leader",
      });
      api.setClock(mid, "code");
    },
    { start: START, mid: MID, end: END },
  );
}

async function ready(page: Page, hash: string, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`/?e2e=1#${hash}`);
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
  await loadMexico2025(page);
  await expect.poll(async () => (await hooks(page)).state.snap?.rows.length ?? 0).toBeGreaterThanOrEqual(4);
}

const SIZES = [
  { name: "1920", width: 1920, height: 1080 },
  { name: "1366", width: 1366, height: 768 },
] as const;

for (const size of SIZES) {
  test(`Mexico 2025 layout at ${size.width}x${size.height}`, async ({ page }) => {
    await ready(page, "trackmap", size);

    const zoom = page.locator("button.map-zoom");
    await expect(zoom).toBeVisible();
    const svg = page.locator("svg.track");
    await expect(svg).toHaveAttribute("data-zoom", "full");
    const pitIn = page.locator('svg.track [data-pit="in"]');
    const pitOut = page.locator('svg.track [data-pit="out"]');
    await expect(pitIn).toBeVisible();
    await expect(pitOut).toBeVisible();
    await expect(pitIn).toContainText("PIT IN");
    await expect(pitOut).toContainText("PIT OUT");
    await expect(svg).toHaveAttribute("data-pit-in", "0.9600");
    await expect(svg).toHaveAttribute("data-pit-out", "0.0600");
    const pitLook = await svg.evaluate((el) => {
      const inn = el.querySelector('[data-pit="in"] .pit-mark-label');
      const out = el.querySelector('[data-pit="out"] .pit-mark-label');
      return {
        inFill: inn?.getAttribute("fill"),
        outFill: out?.getAttribute("fill"),
        inSize: inn ? Number.parseFloat(getComputedStyle(inn).fontSize) : 0,
        outSize: out ? Number.parseFloat(getComputedStyle(out).fontSize) : 0,
      };
    });
    expect(pitLook.inFill).toBe("#fbbf24");
    expect(pitLook.outFill).toBe("#22c55e");
    expect(pitLook.inSize).toBeGreaterThanOrEqual(14);
    expect(pitLook.outSize).toBeGreaterThanOrEqual(14);
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_trackmap_pits_${size.name}.png`,
      fullPage: true,
    });
    await page.locator("table.tower tbody tr[data-driver='44']").dispatchEvent("pointerdown");
    expect((await hooks(page)).state.selectedDriver).toBe(44);
    await zoom.dispatchEvent("pointerdown");
    await expect(zoom).toHaveAttribute("aria-pressed", "true");
    await expect(svg).toHaveAttribute("data-zoom", "follow");
    await expect(svg).toHaveAttribute("data-follow", "44");
    const zoomed = await svg.getAttribute("viewBox");
    expect(zoomed).toBeTruthy();
    const parts = zoomed!.split(" ").map(Number);
    expect(parts[2]).toBeLessThan(size.width);
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_trackmap_zoom_${size.name}.png`,
      fullPage: true,
    });
    await expect(page.locator('svg.track [data-pit="in"]')).toHaveCount(1);
    await expect(page.locator('svg.track [data-pit="out"]')).toHaveCount(1);
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_trackmap_pits_zoom_${size.name}.png`,
      fullPage: true,
    });
    await zoom.dispatchEvent("pointerdown");
    await expect(svg).toHaveAttribute("data-zoom", "full");

    const strip = page.locator("canvas.gapline");
    await expect(strip).toHaveAttribute("data-mode", "track");
    const marks = await strip.evaluate((el) => ({
      sf: Number((el as HTMLCanvasElement).dataset.sf),
      pitIn: Number((el as HTMLCanvasElement).dataset.pitIn),
      pitOut: Number((el as HTMLCanvasElement).dataset.pitOut),
      w: el.getBoundingClientRect().width,
    }));
    expect(Math.abs(marks.sf - marks.w / 2)).toBeLessThan(24);
    expect(marks.pitIn).not.toBeCloseTo(marks.sf, 0);
    expect(marks.pitOut).not.toBeCloseTo(marks.sf, 0);
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_footer_strip_${size.name}.png`,
      fullPage: true,
    });

    const windSvg = page.locator("svg.wind-map");
    const windHead = page.locator("svg.wind-map path.wind-arrow-head");
    const windChevrons = page.locator("svg.wind-map path.wind-arrow-chevrons");
    await expect(windHead).toBeVisible();
    await expect(windChevrons).toBeVisible();
    await expect(windSvg).toHaveAttribute("data-wind", "chevrons");
    expect((await windHead.getAttribute("d"))?.endsWith("Z")).toBe(true);
    expect((await windChevrons.getAttribute("d"))?.startsWith("M")).toBe(true);
    expect(((await windChevrons.getAttribute("d")) ?? "").match(/M/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    const windAnim = await windSvg.evaluate((el) => ({
      period: Number.parseInt(getComputedStyle(el).getPropertyValue("--wind-flow-ms"), 10),
      tx: getComputedStyle(el).getPropertyValue("--wind-tx"),
      ty: getComputedStyle(el).getPropertyValue("--wind-ty"),
      name: getComputedStyle(el.querySelector(".wind-arrow-chevrons") as Element).animationName,
    }));
    expect(windAnim.period).toBeGreaterThan(0);
    expect(windAnim.tx).toMatch(/px/);
    expect(windAnim.ty).toMatch(/px/);
    expect(windAnim.name).toMatch(/wind-chevrons/);
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_wind_chevrons_${size.name}.png`,
      fullPage: true,
    });
    const windClose = page.locator("svg.wind-map");
    await windClose.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_wind_chevrons_closeup_${size.name}.png`,
    });

    await page.locator("nav button[data-page='racetrace']").click();
    await expect(page.locator("button[data-trace-mode='average']")).toBeVisible();
    await page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.setPlaying(true));
    for (const mode of ["average", "driver", "leader"] as const) {
      await page.locator(`button[data-trace-mode='${mode}']`).dispatchEvent("pointerdown");
      expect((await hooks(page)).state.traceMode).toBe(mode);
    }
    await page.locator(".trace-drivers button[data-driver='4']").dispatchEvent("pointerdown");
    expect((await hooks(page)).state.selectedDriver).toBe(4);
    await page.locator(".trace-drivers button[data-driver='1']").dispatchEvent("pointerdown");
    expect((await hooks(page)).state.selectedDriver).toBe(1);
    await page.locator("button[data-trace-mode='driver']").dispatchEvent("pointerdown");
    expect((await hooks(page)).state.traceMode).toBe("driver");
    const picker = page.locator(".trace-ref");
    await expect(picker).toBeVisible();
    await page.locator(".trace-ref-btn").dispatchEvent("pointerdown");
    const list = page.locator(".trace-ref-list");
    await expect(list).toBeVisible();
    const theme = await list.evaluate((el) => {
      const cs = getComputedStyle(el);
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
      const [br, bg, bb] = parse(cs.backgroundColor);
      const [tr, tg, tb] = parse(cs.color);
      const bgLum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
      const fgLum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
      return { bgLum, fgLum, optCount: el.querySelectorAll(".trace-ref-opt").length, swatches: el.querySelectorAll(".swatch").length };
    });
    expect(theme.bgLum).toBeLessThan(80);
    expect(theme.fgLum).toBeGreaterThan(160);
    expect(theme.optCount).toBeGreaterThanOrEqual(4);
    expect(theme.swatches).toBeGreaterThanOrEqual(4);
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_racetrace_dropdown_${size.name}.png`,
      fullPage: true,
    });
    await page.locator(".trace-ref-opt[data-driver='4']").dispatchEvent("pointerdown");
    expect((await hooks(page)).state.traceDriver).toBe(4);
    await expect(page.locator(".trace-ref-list")).toBeHidden();
    await expect(page.locator(".trace-ref-btn .trace-ref-code")).toHaveText("NOR");
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_racetrace_${size.name}.png`,
      fullPage: true,
    });

    await page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.setPlaying(false));
    await page.locator("nav button[data-page='pitcircle']").click();
    await expect(page.locator("svg.circle")).toBeVisible();
    const labelSize = await page.locator("svg.circle text.car-label").first().evaluate((el) => {
      return Number.parseFloat(getComputedStyle(el).fontSize);
    });
    expect(labelSize).toBeGreaterThanOrEqual(15);
    await page.evaluate(() => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.state.selectedDrivers = [1];
      api.state.selectedDriver = 1;
      api.setClock(api.state.t, "code");
    });
    await expect.poll(async () => (await hooks(page)).state.selectedDriver).toBe(1);
    const hint = page.locator(".pit-rejoin-hint");
    await expect(hint).toContainText("VER rejoin");
    const hintLook = await hint.evaluate((el) => ({
      size: Number.parseFloat(getComputedStyle(el).fontSize),
      codes: [...el.querySelectorAll(".pit-rejoin-code")].map((n) => ({
        text: n.textContent,
        color: getComputedStyle(n).color,
      })),
      ahead: el.querySelector(".pit-rejoin-gap[data-side='ahead']")?.textContent ?? "",
      behind: el.querySelector(".pit-rejoin-gap[data-side='behind']")?.textContent ?? "",
    }));
    expect(hintLook.size).toBeGreaterThanOrEqual(18);
    expect(hintLook.codes.some((c) => c.text === "VER" && /54,\s*113,\s*198/.test(c.color))).toBe(true);
    expect(hintLook.ahead || hintLook.behind).toBeTruthy();
    if (hintLook.ahead) expect(hintLook.ahead).toMatch(/[−-]\d+\.\d{3}/);
    if (hintLook.behind) expect(hintLook.behind).toMatch(/\+\d+\.\d{3}/);
    const pitZoom = page.locator(".page.pitcircle button.map-zoom");
    await expect(pitZoom).toBeVisible();
    const pitSvg = page.locator("svg.circle");
    await expect(pitSvg).toHaveAttribute("data-zoom", "full");
    await pitZoom.dispatchEvent("pointerdown");
    await expect(pitZoom).toHaveAttribute("aria-pressed", "true");
    await expect(pitSvg).toHaveAttribute("data-zoom", "follow");
    await expect(pitSvg).toHaveAttribute("data-follow", "1");
    await expect(pitSvg).toHaveAttribute("data-follow-kind", "rejoin");
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_pitcircle_zoom_${size.name}.png`,
      fullPage: true,
    });
    await pitZoom.dispatchEvent("pointerdown");
    await expect(pitSvg).toHaveAttribute("data-zoom", "full");
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_pitcircle_rejoin_${size.name}.png`,
      fullPage: true,
    });
    await page.evaluate(() => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      api.state.pitLoss.green = 90;
      api.setClock(api.state.t, "code");
    });
    await expect(page.locator(".pit-ghost")).toBeVisible();
    await expect(page.locator(".pit-ghost-label")).toContainText("+");
    await expect(page.locator(".pit-ghost-label")).toContainText("L");
    await expect(page.locator(".pit-rejoin-hint")).toContainText("+");
    await page.screenshot({
      path: `/opt/cursor/artifacts/screenshots/mexico_pitcircle_lapped_ghost_${size.name}.png`,
      fullPage: true,
    });
  });
}
