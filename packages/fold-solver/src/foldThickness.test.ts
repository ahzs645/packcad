import { describe, expect, it } from "vitest";
import { thicknessMillimetresToFoldUnits } from "./foldThickness";

describe("PackCAD thickness units", () => {
  it("converts the MailerBox E-flute thickness into its 72 px/in FOLD frame", () => {
    expect(thicknessMillimetresToFoldUnits(0.0625 * 25.4, "px")).toBeCloseTo(4.5, 10);
  });

  it("supports physical FOLD coordinate units without visual normalization", () => {
    expect(thicknessMillimetresToFoldUnits(25.4, "in")).toBeCloseTo(1, 10);
    expect(thicknessMillimetresToFoldUnits(10, "cm")).toBeCloseTo(1, 10);
    expect(thicknessMillimetresToFoldUnits(1, "mm")).toBeCloseTo(1, 10);
  });
});
