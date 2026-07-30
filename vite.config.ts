import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: {
    dedupe: ["three"],
  },
  test: {
    include: ["packages/**/*.test.ts", "src/**/*.test.ts"],
  },
});
