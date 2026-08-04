import { createPillowBoxProject } from "@packcad/fold-solver";
import { describe, expect, it } from "vitest";
import { materialTextureRepeat } from "./materialTexture";

describe("source material texture mapping", () => {
  it("uses the pillow-box UV density and PackCAD's two-inch chipboard tile", () => {
    const model = createPillowBoxProject().foldModel;
    if (!model) throw new Error("PillowBox fixture did not produce a fold model");

    expect(materialTextureRepeat(model, { corrugated: false })).toEqual([
      expect.closeTo(6.605436805555556, 10),
      expect.closeTo(5.333333333333333, 10),
    ]);
  });

  it("projects UVs onto vertices introduced while discretising curves", () => {
    const model = createPillowBoxProject().foldModel;
    if (!model) throw new Error("PillowBox fixture did not produce a fold model");
    // The authored pillow graph has 88 vertices; the remaining vertices are
    // introduced by the source-matching curve discretiser.
    expect(model.verticesUv).toHaveLength(model.verticesCoords.length);
    const generatedUvs = model.verticesUv.slice(88);

    expect(generatedUvs.length).toBeGreaterThan(0);
    expect(generatedUvs.every((uv) =>
      uv.length >= 2
      && uv.every(Number.isFinite)
      && (uv[0] !== 0 || uv[1] !== 0)
    )).toBe(true);
  });
});
