import { describe, expect, it } from "vitest";
import { foldCompletionPercent } from "./Inspector";

describe("foldCompletionPercent", () => {
  it("uses the operation's authored target instead of a hard-coded angle", () => {
    expect(foldCompletionPercent(0, [-120, -45])).toBe(0);
    expect(foldCompletionPercent(41.25, [-120, -45])).toBe(50);
    expect(foldCompletionPercent(82.5, [-120, -45])).toBe(100);
  });

  it("clamps overshoot and handles operations without active targets", () => {
    expect(foldCompletionPercent(135, [90])).toBe(100);
    expect(foldCompletionPercent(90, [])).toBe(0);
  });
});
