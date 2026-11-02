import { defineConfig } from "vitest/config";
import { currentBuildVersion } from "./vite.build-version";

export default defineConfig({
  define: {
    __F1PW_BUILD_VERSION__: JSON.stringify(currentBuildVersion()),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "relay/**/*.test.js"],
  },
});
