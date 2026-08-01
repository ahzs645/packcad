import { describe, expect, it } from "vitest";
import { BackSide, DoubleSide, FrontSide, Texture } from "three";
import {
  createMailerBoxProject,
  foldNewtonSequence,
} from "@packcad/fold-solver";
import { buildFoldScene } from "./foldSceneBuilder";
import { settledFoldModel } from "./foldSettlement";
import {
  createFoldSceneMaterials,
  FOLD_SCENE_POST_PROCESSING,
} from "./foldSceneMaterials";

describe("fold scene material groups", () => {
  it("maps the settled default MailerBox shell to visible materials without GTAO", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const foldStepIndex = Math.max(
      0,
      project.foldingSteps.findIndex((step) => step.id === project.activeStepId),
    );
    const foldAngle = project.foldingSteps[foldStepIndex]?.angle ?? 0;
    const settledModel = settledFoldModel(model, foldStepIndex, foldAngle);
    const settled = foldNewtonSequence(
      settledModel,
      { uptoKeyframe: foldStepIndex - 1 },
    );
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex,
      foldAngle,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
      foldPositions: settled.positions,
      foldMaxEdgeError: settled.maxEdgeError,
      foldMaxAngleErrorDeg: settled.maxAngleErrorDeg,
    });
    const frontTexture = new Texture();
    const backTexture = new Texture();
    const edgeTexture = new Texture();
    const faceTexture = new Texture();
    const materials = createFoldSceneMaterials({
      viewMode: "3d",
      technical: false,
      showArtwork: true,
      useFaceColors: false,
      faceTexture,
      frontArtworkTexture: frontTexture,
      backArtworkTexture: backTexture,
      edgeTexture,
      edgeFallbackColor: "#bc8d55",
    });

    expect(settled.isSolved).toBe(true);
    expect(scene.timelineSolve.method).toBe("source-iterative");
    expect(scene.geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2]);
    expect(scene.geometry.groups.every((group) => group.count > 0)).toBe(true);
    expect(materials.base.map((material) => material.map)).toEqual([
      faceTexture,
      faceTexture,
      edgeTexture,
    ]);
    expect(materials.base.map((material) => material.side)).toEqual([
      FrontSide,
      BackSide,
      DoubleSide,
    ]);
    expect(materials.artwork?.map((material) => material.map)).toEqual([
      frontTexture,
      backTexture,
      null,
    ]);
    expect(materials.artwork?.slice(0, 2).every((material) =>
      material.transparent && material.depthWrite === false && material.alphaTest > 0
    )).toBe(true);
    expect(materials.base.every((material) => material.color.getHex() !== 0x000000)).toBe(true);
    for (const group of scene.geometry.groups) {
      if (group.materialIndex === undefined) {
        throw new Error("Fold scene group has no material index");
      }
      const material = materials.base[group.materialIndex];
      expect(material).toBeDefined();
      expect(
        material.map !== null || material.color.getHex() !== 0x000000,
      ).toBe(true);
    }
    expect(FOLD_SCENE_POST_PROCESSING).toBe(false);

    for (const material of materials.base) material.dispose();
    for (const material of materials.artwork ?? []) material.dispose();
    frontTexture.dispose();
    backTexture.dispose();
    edgeTexture.dispose();
    faceTexture.dispose();
    scene.geometry.dispose();
    scene.lockedTintGeometry?.dispose();
    scene.selectedTintGeometry?.dispose();
    scene.solidEdgeGeometry.dispose();
    scene.creaseEdgeGeometry.dispose();
    scene.dashedEdgeGeometry.dispose();
    scene.edgePickGeometry.dispose();
  });
});
