import { createProject } from "@packcad/format";
import { Texture, Vector2 } from "three";
import { describe, expect, it } from "vitest";
import { applyArtworkPlacement } from "./artworkTexture";

// Source-page landmarks: the rear face is on the left of the bus net and the
// front face is on the right. Mirroring this atlas exchanges their print.
const busLandmarks = [
  { name: "rear face", x: 160, y: 415 },
  { name: "front face", x: 855, y: 415 },
];

describe("source artwork atlas registration", () => {
  for (const viewMode of ["2d", "3d"] as const) {
    for (const landmark of busLandmarks) {
      it(`keeps the ${landmark.name} on its source pixels in ${viewMode}`, () => {
        const artwork = {
          ...createProject().artwork,
          uvConvention: "source-atlas" as const,
        };
        const texture = new Texture();
        applyArtworkPlacement(texture, artwork, viewMode);
        texture.updateMatrix();
        const sampled = new Vector2(landmark.x / 1024, 1 - landmark.y / 689)
          .applyMatrix3(texture.matrix);

        expect(sampled.x * 1024).toBeCloseTo(landmark.x, 8);
        expect((1 - sampled.y) * 689).toBeCloseTo(landmark.y, 8);
        texture.dispose();
      });
    }
  }

  it("retains legacy sample mirroring when no convention is specified", () => {
    const artwork = createProject().artwork;
    for (const viewMode of ["2d", "3d"] as const) {
      const texture = new Texture();
      applyArtworkPlacement(texture, artwork, viewMode);
      texture.updateMatrix();
      for (const landmark of busLandmarks) {
        const sampled = new Vector2(landmark.x / 1024, 1 - landmark.y / 689)
          .applyMatrix3(texture.matrix);
        const expectedX = viewMode === "2d" ? landmark.x : 1024 - landmark.x;
        expect(sampled.x * 1024).toBeCloseTo(expectedX, 8);
      }
      texture.dispose();
    }
  });

  it("keeps positioned, scaled and rotated source artwork stable between views", () => {
    const artwork = {
      ...createProject().artwork,
      uvConvention: "source-atlas" as const,
      x: 0.12,
      y: -0.08,
      scale: 0.75,
      rotation: 35,
    };
    const flat = new Texture();
    const folded = new Texture();
    applyArtworkPlacement(flat, artwork, "2d");
    applyArtworkPlacement(folded, artwork, "3d");
    flat.updateMatrix();
    folded.updateMatrix();
    const source = new Vector2(0.32, 0.64);
    const flatSample = source.clone().applyMatrix3(flat.matrix);
    const foldedSample = source.clone().applyMatrix3(folded.matrix);

    expect(foldedSample.x).toBeCloseTo(flatSample.x, 12);
    expect(foldedSample.y).toBeCloseTo(flatSample.y, 12);
    expect(flatSample.distanceTo(source)).toBeGreaterThan(0.01);
    flat.dispose();
    folded.dispose();
  });
});
