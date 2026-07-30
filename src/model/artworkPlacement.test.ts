import { createMailerBoxProject } from "@packcad/fold-solver";
import { describe, expect, it } from "vitest";
import { artworkPlacementForFace } from "./artworkPlacement";

describe("artwork panel placement", () => {
  it("centres legacy artwork coordinates on a panel UV centroid", () => {
    const model = createMailerBoxProject().foldModel;
    if (!model) throw new Error("Mailer Box fixture did not produce a fold model");
    const panelIndex = 0;
    const placement = artworkPlacementForFace(model, panelIndex);
    if (!placement) throw new Error("Fixture panel did not contain UVs");
    const loop = model.facesVertices[panelIndex];
    const centroid = loop.reduce(
      (sum, vertexIndex) => {
        const uv = model.verticesUv[vertexIndex] ?? [0, 0];
        return [sum[0] + uv[0], sum[1] + uv[1]] as [number, number];
      },
      [0, 0] as [number, number],
    );

    expect(placement.panelIndex).toBe(panelIndex);
    expect(placement.x).toBeCloseTo(centroid[0] / loop.length - 0.5);
    expect(placement.y).toBeCloseTo(centroid[1] / loop.length - 0.5);
    expect(artworkPlacementForFace(model, -1)).toBeNull();
  });
});
