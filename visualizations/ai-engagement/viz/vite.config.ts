import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Serves the synthetic stand-in data by default (run `npm run generate` in
// synthetic-data/ first). With access to the real export, point VIZ_DATA_DIR at
// it instead, e.g. VIZ_DATA_DIR=../analysis/artifacts/viz npm run dev.
export default defineConfig({
  plugins: [svelte()],
  publicDir: process.env.VIZ_DATA_DIR ?? "../synthetic-data/out/viz",
});
