import { expect, test } from "@playwright/test";

const STAMP = /^v [0-9a-f]{7} · [A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2} [AP]M ET$/;

test("build version sits under the race title and in Settings", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?e2e=1#trackmap");
  await expect.poll(async () => page.evaluate(() => Boolean((window as unknown as { __f1pw?: unknown }).__f1pw))).toBe(
    true,
  );

  const header = page.locator(".topbar .build-ver");
  await expect(header).toBeVisible();
  await expect(header).toHaveText(STAMP);
  await expect(page.locator(".session-title")).toHaveText("F1 PITWALL");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/build_stamp_header_1920.png" });

  await page.getByRole("button", { name: "Settings" }).click();
  const inSettings = page.locator(".modal .build-ver");
  await expect(inSettings).toBeVisible();
  await expect(inSettings).toHaveText(await header.textContent() ?? "");
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/build_stamp_settings_1920.png" });
});
