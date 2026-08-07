import { describe, expect, it } from "vitest";
import { BackSide, DoubleSide, FrontSide, MeshBasicMaterial, Texture } from "three";
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
  it("uses untinted, unlit, side-specific face maps in the 2D graph", () => {
    const faceTexture = new Texture();
    const materials = createFoldSceneMaterials({
      viewMode: "2d",
      technical: false,
      showArtwork: false,
      useFaceColors: false,
      faceTexture,
      frontArtworkTexture: null,
      backArtworkTexture: null,
      edgeTexture: null,
      edgeFallbackColor: "#c8b394",
    });

    expect(materials.base[0]).toBeInstanceOf(MeshBasicMaterial);
    expect(materials.base[1]).toBeInstanceOf(MeshBasicMaterial);
    expect(materials.base[0].color.getHex()).toBe(0xffffff);
    expect(materials.base[1].color.getHex()).toBe(0xffffff);
    expect(materials.base[0].map).toBe(faceTexture);
    expect(materials.base[1].map).toBe(faceTexture);
    expect(materials.base[0].side).toBe(FrontSide);
    expect(materials.base[1].side).toBe(BackSide);

    for (const material of materials.base) material.dispose();
    faceTexture.dispose();
  });

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
    // Sheets, then their bend wraps, then cut sidebands and seam caps. The
    // MailerBox extrudes its thickness inward only (front offset 0), so its
    // exterior bend arcs are degenerate and that group is skipped.
    expect(scene.geometry.groups.map((group) => group.materialIndex))
      .toEqual([0, 1, 5, 2, 3]);
    expect(scene.geometry.groups.every((group) => group.count > 0)).toBe(true);
    const edgeGroup = scene.geometry.groups.find((group) => group.materialIndex === 2);
    const capGroup = scene.geometry.groups.find((group) => group.materialIndex === 3);
    const bendCount = scene.geometry.groups
      .filter((group) => group.materialIndex === 4 || group.materialIndex === 5)
      .reduce((sum, group) => sum + group.count, 0);
    expect(edgeGroup?.count).toBe(
      scene.meta.cutEdgeIndexCount - scene.meta.closedSeamCapIndexCount,
    );
    expect(capGroup?.count).toBe(scene.meta.closedSeamCapIndexCount);
    expect(bendCount).toBe(scene.meta.foldHingeBendIndexCount);
    expect(materials.base.map((material) => material.map)).toEqual([
      faceTexture,
      faceTexture,
      edgeTexture,
      edgeTexture,
      faceTexture,
      faceTexture,
    ]);
    expect(materials.base.map((material) => material.side)).toEqual([
      FrontSide,
      BackSide,
      DoubleSide,
      DoubleSide,
      DoubleSide,
      DoubleSide,
    ]);
    // The source's sideband is untinted white: the flute bitmap alone supplies
    // the kraft colour, and the seam cap matches it.
    expect(materials.base[2].color.getHex()).toBe(0xffffff);
    expect(materials.base[3].color.getHex()).toBe(0xffffff);
    // Bend wraps continue their sheet's stock colour so a fold never shows the
    // cut-edge texture.
    expect(materials.base[4].color.getHex()).toBe(materials.base[0].color.getHex());
    expect(materials.base[5].color.getHex()).toBe(materials.base[1].color.getHex());
    expect(materials.base[2].polygonOffset).toBe(true);
    expect(materials.artwork?.map((material) => material.map)).toEqual([
      frontTexture,
      backTexture,
      null,
      null,
      frontTexture,
      backTexture,
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
    scene.lockedIconGeometry?.dispose();
    scene.selectedTintGeometry?.dispose();
    scene.solidEdgeGeometry.dispose();
    scene.creaseEdgeGeometry.dispose();
    scene.dashedEdgeGeometry.dispose();
    scene.edgePickGeometry.dispose();
  });
});
