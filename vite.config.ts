import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "three"],
  },
  optimizeDeps: {
    // PackCAD keeps downloaded reference builds and recovery artifacts in this
    // repository. They are not application entries, and some intentionally
    // contain partially recovered JavaScript that Vite cannot parse.
    entries: ["index.html"],
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
