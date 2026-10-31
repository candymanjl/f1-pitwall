import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  timeout: 45_000,
  webServer: {
    command: "npx vite --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: false,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
  },
});
