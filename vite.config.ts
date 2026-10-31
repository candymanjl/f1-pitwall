import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE || "/",
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
