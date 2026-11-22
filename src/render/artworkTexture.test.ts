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

const sample = (texture: Texture, x: number, y: number) =>
  new Vector2(x / 1024, 1 - y / 689).applyMatrix3(texture.matrix);

describe("artwork atlas registration", () => {
  // The folded view is a rotation of the flat sheet (foldSceneBuilder.ts), so
  // artwork is never mirrored to compensate, whatever the document's convention.
  for (const uvConvention of ["source-atlas", undefined] as const) {
    for (const landmark of busLandmarks) {
      it(`keeps the ${landmark.name} on its source pixels (${uvConvention ?? "no convention"})`, () => {
        const artwork = { ...createProject().artwork, uvConvention };
        const texture = new Texture();
        applyArtworkPlacement(texture, artwork);
        texture.updateMatrix();
        const sampled = sample(texture, landmark.x, landmark.y);

        expect(sampled.x * 1024).toBeCloseTo(landmark.x, 8);
        expect((1 - sampled.y) * 689).toBeCloseTo(landmark.y, 8);
        texture.dispose();
      });
    }
  }

  it("applies position, scale and rotation", () => {
    const artwork = {
      ...createProject().artwork,
      x: 0.12,
      y: -0.08,
      scale: 0.75,
      rotation: 35,
    };
    const texture = new Texture();
    applyArtworkPlacement(texture, artwork);
    texture.updateMatrix();
    const source = new Vector2(0.32, 0.64);

    expect(source.clone().applyMatrix3(texture.matrix).distanceTo(source)).toBeGreaterThan(0.01);
    texture.dispose();
  });
});
