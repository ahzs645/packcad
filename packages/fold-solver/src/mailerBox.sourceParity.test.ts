import { describe, expect, it } from "vitest";
import { getEnabledSourceArtwork } from "@packcad/format";
import { foldNewtonSequence } from "./foldNewtonSolver";
import { createMailerBoxProject } from "./sample";

function dataUrlBytes(value: string | undefined): Uint8Array {
  if (!value) throw new Error("MailerBox artwork is missing");
  const encoded = value.split(",", 2)[1];
  if (!encoded) throw new Error("MailerBox artwork is not a data URL");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

describe("live MailerBox source parity", () => {
  it("uses the same Mailer Box topology and folding operations", () => {
    const model = createMailerBoxProject().foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");

    // Curved edges are flattened into straight pieces at import, as the
    // reference does, so the mesh is denser than the raw FOLD document.
    expect(model.verticesCoords).toHaveLength(106);
    expect(model.facesVertices).toHaveLength(19);
    // 8 authored curved edges, discretised into 40 straight pieces.
    expect(model.edgeControlPoints?.filter((points) => points.length > 0)).toHaveLength(40);
    expect(model.keyframes.map((keyframe) =>
      Object.keys(keyframe.creaseAnglesDeg).length)).toEqual([4, 2, 4, 4, 4]);
    expect(model.keyframes.map((keyframe) =>
      keyframe.enforcePriorConstraints)).toEqual([false, false, false, false, false]);
    expect(model.keyframes.every((keyframe) =>
      keyframe.fixedFaceIndices.includes(model.fixedFaceIndex))).toBe(true);
  });

  it("folds the K4 side returns into the walls and keeps the K5 lid upright", () => {
    const model = createMailerBoxProject().foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const solved = foldNewtonSequence(model);
    const range = (faceIndex: number, axis: 0 | 1 | 2): [number, number] => {
      const values = model.facesVertices[faceIndex].map(
        (vertex) => solved.positions[vertex][axis],
      );
      return [Math.min(...values), Math.max(...values)];
    };

    const [rightReturnMinX] = range(6, 0);
    const [, rightWallMaxX] = range(7, 0);
    expect(rightReturnMinX).toBeLessThan(rightWallMaxX - 1);
    const [, leftReturnMaxX] = range(15, 0);
    const [leftWallMinX] = range(16, 0);
    expect(leftReturnMaxX).toBeGreaterThan(leftWallMinX + 1);

    const [lidMinY, lidMaxY] = range(2, 1);
    const [lidMinZ, lidMaxZ] = range(2, 2);
    expect(lidMaxY - lidMinY).toBeLessThan(1e-3);
    expect(lidMaxZ - lidMinZ).toBeGreaterThan(200);
    expect(solved.maxEdgeError).toBeLessThan(1e-6);
    expect(solved.maxAngleErrorDeg).toBeLessThan(1e-4);
  });

  it("uses the live example's material, thickness, offset, and artwork placement", () => {
    const project = createMailerBoxProject();
    const thickness = project.design?.modifiers.OPERATION_THICKNESS;
    const artwork = project.design?.modifiers.OPERATION_ARTWORK;

    expect(project.materialSpec).toBe("MATERIAL_CORRUGATED_CARDBOARD_E_FLUTE");
    expect(project.thicknessMm).toBeCloseTo(0.0625 * 25.4, 10);
    expect(project.artwork).toMatchObject({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    expect(thickness).toMatchObject({
      materialType: "MATERIAL_CORRUGATED_CARDBOARD",
      materialSubType: "MATERIAL_CORRUGATED_CARDBOARD_E_FLUTE",
      thickness: 0.0625,
      thicknessOffsetDirection: "THICKNESS_OFFSET_DIRECTION_BACK",
      materialRotationDegrees: 0,
    });
    expect(artwork).toMatchObject({
      frontArtworkFilename: "MailerBox-exterior.png",
      backArtworkFilename: "MailerBox-interior.png",
    });
  });

  it("uses the website artwork assets rather than the stale opaque interior capture", () => {
    const source = getEnabledSourceArtwork(createMailerBoxProject().design);
    const exterior = dataUrlBytes(source?.frontArtwork);
    const interior = dataUrlBytes(source?.backArtwork);

    expect(source?.frontArtwork).toHaveLength(305_262);
    expect(source?.backArtwork).toHaveLength(247_290);
    expect(exterior.slice(0, 8)).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(interior.slice(0, 8)).toEqual(
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    // PNG IHDR colour type 6 = RGBA. The transparent stock area is essential:
    // it lets the corrugated base show through instead of becoming a navy face.
    expect(interior[25]).toBe(6);
  });
});
