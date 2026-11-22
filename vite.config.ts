import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Two pages: the editor (index.html) and the embeddable viewer (viewer.html, src/viewer/). A host
// that only embeds the viewer builds it alone with PACKCAD_ENTRY=viewer, which leaves the editor,
// its render dialog and the denoiser out of the output.
const pages = {
  editor: fileURLToPath(new URL("index.html", import.meta.url)),
  viewer: fileURLToPath(new URL("viewer.html", import.meta.url)),
};
const entry = process.env.PACKCAD_ENTRY;
const input = entry === "viewer" ? { viewer: pages.viewer } : pages;

// public/denoiser holds the render dialog's model weights (3.6 MB), which only the editor uses.
const viewerOnlyPublic: Plugin = {
  name: "packcad-viewer-only-public",
  apply: "build",
  writeBundle(options) {
    if (options.dir) rmSync(`${options.dir}/denoiser`, { recursive: true, force: true });
  },
};

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  build: {
    rolldownOptions: { input },
  },
  plugins: entry === "viewer" ? [react(), viewerOnlyPublic] : [react()],
  resolve: {
    dedupe: ["react", "react-dom", "three"],
  },
  optimizeDeps: {
    // PackCAD keeps downloaded reference builds and recovery artifacts in this
    // repository. They are not application entries, and some intentionally
    // contain partially recovered JavaScript that Vite cannot parse.
    entries: ["index.html", "viewer.html"],
  },
  server: {
    fs: {
      // Local sibling packages (including @atelier/render's denoiser model)
      // are linked from the Engine workspace during development.
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "src/**/*.test.ts"],
    // MailerBox fold tests need ~1-2s alone but starve past vitest's 5s
    // default when the whole suite solves in parallel; that showed up as 8-9
    // spurious "timed out" failures with every test green in isolation.
    testTimeout: 120_000,
  },
});
