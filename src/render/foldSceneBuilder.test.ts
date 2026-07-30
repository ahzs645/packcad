import {
  createMailerBoxProject,
  solveFoldTimeline,
} from "@packcad/fold-solver";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  buildFoldScene,
  updateFoldScenePositions,
  type FoldSceneData,
} from "./foldSceneBuilder";

function disposeScene(scene: FoldSceneData): void {
  scene.geometry.dispose();
  scene.lockedTintGeometry?.dispose();
  scene.selectedTintGeometry?.dispose();
  scene.solidEdgeGeometry.dispose();
  scene.dashedEdgeGeometry.dispose();
  scene.edgePickGeometry.dispose();
}

describe("fold scene frame updates", () => {
  it("reuses one structural scene while mutating frame positions in place", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const foldStepIndex = 1;
    let structuralBuildCount = 0;
    const buildStructuralScene = (): FoldSceneData => {
      structuralBuildCount += 1;
      return buildFoldScene({
        model,
        projection: "folded-3d",
        foldStepIndex,
        foldAngle: 0,
        thicknessMm: project.thicknessMm,
        panelColorMode: "artwork",
        edgeColorMode: "mountain-valley",
      });
    };
    const scene = buildStructuralScene();
    const geometry = scene.geometry;
    const positionAttribute = geometry.getAttribute("position");
    const positionArray = positionAttribute.array as Float32Array;
    const initialPositions = positionArray.slice();
    const solidGeometry = scene.solidEdgeGeometry;
    const dashedGeometry = scene.dashedEdgeGeometry;
    const pickGeometry = scene.edgePickGeometry;
    const pickArray = (
      pickGeometry.getAttribute("position").array as Float32Array
    );
    const pickAttribute = pickGeometry.getAttribute("position");
    if (
      !(positionAttribute instanceof BufferAttribute) ||
      !(pickAttribute instanceof BufferAttribute)
    ) {
      throw new Error("Fold scene positions must use buffer attributes");
    }
    const initialPickPositions = pickArray.slice();
    const setAttribute = vi.spyOn(BufferGeometry.prototype, "setAttribute");

    for (const foldAngle of [15, 35, 65, 90]) {
      const frame = solveFoldTimeline(model, foldStepIndex, foldAngle);
      updateFoldScenePositions(scene, {
        foldStepIndex,
        foldAngle,
        foldPositions: frame.positions,
        foldMaxEdgeError: frame.maxEdgeError,
        foldMaxAngleErrorDeg: frame.maxAngleErrorDeg,
      });
    }

    expect(structuralBuildCount).toBe(1);
    expect(scene.geometry).toBe(geometry);
    expect(scene.geometry.getAttribute("position")).toBe(positionAttribute);
    expect(scene.geometry.getAttribute("position").array).toBe(positionArray);
    expect(scene.solidEdgeGeometry).toBe(solidGeometry);
    expect(scene.dashedEdgeGeometry).toBe(dashedGeometry);
    expect(scene.edgePickGeometry).toBe(pickGeometry);
    expect(pickGeometry.getAttribute("position").array).toBe(pickArray);
    expect(Array.from(positionArray)).not.toEqual(Array.from(initialPositions));
    expect(Array.from(pickArray)).not.toEqual(Array.from(initialPickPositions));
    expect(positionAttribute.version).toBeGreaterThan(0);
    expect(pickAttribute.version).toBeGreaterThan(0);
    expect(setAttribute).not.toHaveBeenCalled();

    setAttribute.mockRestore();
    disposeScene(scene);
  });
});
