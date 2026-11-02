import { defineConfig } from "vite";
import { currentBuildVersion } from "./vite.build-version";

const BUILD_VERSION = currentBuildVersion();

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  define: {
    __F1PW_BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  optimizeDeps: { include: ["mqtt"] },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
