import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "three"],
  },
  test: {
    include: ["packages/**/*.test.ts", "src/**/*.test.ts"],
    // MailerBox fold tests need ~1-2s alone but starve past vitest's 5s
    // default when the whole suite solves in parallel; that showed up as 8-9
    // spurious "timed out" failures with every test green in isolation.
    testTimeout: 120_000,
  },
});
