import { defineConfig } from "vitest/config";

// This strict convergence gate intentionally fails until local folding is
// source-equivalent. Keep it separate from the default regression suite.
export default defineConfig({
  test: {
    include: ["packages/fold-solver/src/pillowBox.referenceParity.ts"],
  },
});
