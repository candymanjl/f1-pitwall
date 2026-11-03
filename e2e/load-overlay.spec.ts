import { expect, test, type Page } from "@playwright/test";

type Hooks = {
  state: {
    t: number;
    sessionKey: number;
    meetingKey: number;
    loading: string;
    loadProgress: { done: number; total: number; label: string; pct: number } | null;
    bundle: { session: { session_key: number } } | null;
    meetings: { meeting_key: number; meeting_name: string }[];
    sessions: { session_key: number; session_name: string; meeting_key: number }[];
  };
  loadSelectedSession: () => Promise<void>;
  setClock: (t: number) => void;
};

const meeting = {
  meeting_key: 1272,
  meeting_name: "Mexico City Grand Prix",
  circuit_short_name: "Mexico City",
  country_name: "Mexico",
  location: "Mexico City",
  date_start: "2025-10-24T00:00:00.000Z",
  year: 2025,
};

const race = {
  session_key: 9877,
  meeting_key: 1272,
  session_name: "Race",
  session_type: "Race",
  date_start: "2025-10-26T20:00:00.000Z",
  date_end: "2025-10-26T22:00:00.000Z",
  circuit_short_name: "Mexico City",
  country_name: "Mexico",
  location: "Mexico City",
  year: 2025,
};

async function waitForApp(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );
}

async function seedPickerOnly(page: Page): Promise<void> {
  await page.evaluate(
    ({ meeting, race }) => {
      const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
      Object.assign(api.state, {
        meetings: [meeting],
        sessions: [race],
        meetingKey: meeting.meeting_key,
        sessionKey: race.session_key,
        bundle: null,
        loading: "",
        loadProgress: null,
        listsBusy: false,
        error: "",
        lock: null,
      });
      api.setClock(0);
    },
    { meeting, race },
  );
}

test("first Load on a fresh page shows the overlay and progress bar", async ({ page }) => {
  await page.route(/openf1\.org\/v1\//, async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await waitForApp(page);
  await seedPickerOnly(page);

  const before = await page.evaluate(() => (window as unknown as { __f1pw: Hooks }).__f1pw.state.bundle);
  expect(before).toBeNull();
  await expect(page.locator(".overlay.is-visible")).toHaveCount(0);
  await expect(page.locator("#load-session")).toHaveText("Load");
  await expect(page.locator("#load-session")).toBeEnabled();

  await page.locator("#load-session").click();
  await expect(page.locator(".overlay.is-visible")).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".overlay-title")).toHaveText("Loading session…");
  await expect(page.locator(".overlay-bar")).toBeVisible({ timeout: 8000 });
  await expect
    .poll(async () => page.locator(".overlay-pct").textContent(), { timeout: 15_000 })
    .not.toBe("0%");
  await expect(page.locator(".overlay-bar-fill")).toBeVisible();
  const stillLoading = await page.evaluate(() => {
    const api = (window as unknown as { __f1pw: Hooks }).__f1pw;
    return api.state.loading === "Loading session…";
  });
  expect(stillLoading).toBe(true);

  await page.screenshot({
    path: "/opt/cursor/artifacts/screenshots/first_load_overlay_progress_1920.png",
    fullPage: true,
  });
});
