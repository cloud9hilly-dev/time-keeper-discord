import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  publicDir: false,
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
