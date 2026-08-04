import {
  createCurvedBoxProject,
  createMailerBoxProject,
  createMilkCartonProject,
  solveFoldTimeline,
} from "@packcad/fold-solver";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  buildFoldScene,
  SOURCE_THICKNESS_DISPLAY_SCALE,
  updateFoldScenePositions,
  type FoldSceneData,
} from "./foldSceneBuilder";

function disposeScene(scene: FoldSceneData): void {
  scene.geometry.dispose();
  scene.lockedTintGeometry?.dispose();
  scene.lockedIconGeometry?.dispose();
  scene.selectedTintGeometry?.dispose();
  scene.solidEdgeGeometry.dispose();
  scene.creaseEdgeGeometry.dispose();
  scene.dashedEdgeGeometry.dispose();
  scene.edgePickGeometry.dispose();
}

describe("fold scene frame updates", () => {
  it("ignores stale playback positions while switching between source projects", () => {
    const milkModel = createMilkCartonProject().foldModel;
    const curvedProject = createCurvedBoxProject();
    const curvedModel = curvedProject.foldModel;
    if (!milkModel || !curvedModel) throw new Error("Source fixtures did not produce fold models");
    const staleMilkPositions = milkModel.verticesCoords.map(([x, y]) => [x, y, 0] as [number, number, number]);

    const scene = buildFoldScene({
      model: curvedModel,
      projection: "folded-3d",
      foldStepIndex: curvedModel.keyframes.length,
      foldAngle: 35,
      thicknessMm: curvedProject.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
      foldPositions: staleMilkPositions,
    });

    expect(() => updateFoldScenePositions(scene, {
      foldStepIndex: curvedModel.keyframes.length,
      foldAngle: 35,
      foldPositions: staleMilkPositions,
    })).not.toThrow();
    expect(scene.geometry.getAttribute("position").count).toBeGreaterThan(0);
    disposeScene(scene);
  }, 15_000);

  it("uses the source-calibrated Mailer Box shell while excluding selection from locked tint", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const selectedFaceIndex = model.keyframes[0]?.fixedFaceIndices[0];
    if (selectedFaceIndex === undefined) {
      throw new Error("MailerBox fixture is missing its fixed bottom panel");
    }
    const unselected = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 0,
      foldAngle: 0,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });
    const selected = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 0,
      foldAngle: 0,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
      selectedFaceIndex,
    });

    expect(selected.meta.visualThickness).toBeCloseTo(
      4.5 * selected.frameScale * SOURCE_THICKNESS_DISPLAY_SCALE,
      10,
    );
    expect(selected.selectedTintGeometry).not.toBeNull();
    expect(selected.lockedTintGeometry?.getAttribute("position").count ?? 0)
      .toBeLessThan(unselected.lockedTintGeometry?.getAttribute("position").count ?? 0);
    expect(selected.lockedIconGeometry?.getAttribute("position").count ?? 0)
      .toBe(selected.meta.lockedFaceCount * 2);
    expect(selected.solidEdgeGeometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(selected.segmentEdgeIndex.length).toBeGreaterThan(model.edgesVertices.length);
    expect(selected.creaseEdgeGeometry.getAttribute("position").count).toBeGreaterThan(0);

    disposeScene(unselected);
    disposeScene(selected);
  });

  it("renders one cut-edge band at each fully folded K5 corner", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 5,
      foldAngle: 90,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    expect(scene.meta.closedSeamEdgeCount).toBe(4);
    expect(scene.meta.closedSeamCapIndexCount).toBe(24);
    expect(scene.geometry.groups.at(-1)).toMatchObject({
      count: 24,
      materialIndex: 3,
    });

    disposeScene(scene);
  });

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
    const creaseGeometry = scene.creaseEdgeGeometry;
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
    expect(scene.creaseEdgeGeometry).toBe(creaseGeometry);
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

  it("matches a fresh thickness-shell build at every sampled playback angle", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const foldStepIndex = 1;
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex,
      foldAngle: 0,
      thicknessMm: project.thicknessMm,
      thicknessOffsetDirection: "THICKNESS_OFFSET_DIRECTION_BACK",
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    const maximumDelta = (left: Float32Array, right: Float32Array): number => {
      expect(left.length).toBe(right.length);
      let maximum = 0;
      for (let index = 0; index < left.length; index += 1) {
        maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
      }
      return maximum;
    };

    for (const foldAngle of [0, 30, 60, 90]) {
      const frame = solveFoldTimeline(model, foldStepIndex, foldAngle);
      updateFoldScenePositions(scene, {
        foldStepIndex,
        foldAngle,
        foldPositions: frame.positions,
        foldMaxEdgeError: frame.maxEdgeError,
        foldMaxAngleErrorDeg: frame.maxAngleErrorDeg,
      });
      const fresh = buildFoldScene({
        model,
        projection: "folded-3d",
        foldStepIndex,
        foldAngle,
        thicknessMm: project.thicknessMm,
        thicknessOffsetDirection: "THICKNESS_OFFSET_DIRECTION_BACK",
        panelColorMode: "artwork",
        edgeColorMode: "mountain-valley",
        foldPositions: frame.positions,
        foldMaxEdgeError: frame.maxEdgeError,
        foldMaxAngleErrorDeg: frame.maxAngleErrorDeg,
      });

      expect(maximumDelta(
        scene.geometry.getAttribute("position").array as Float32Array,
        fresh.geometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);
      expect(maximumDelta(
        scene.solidEdgeGeometry.getAttribute("position").array as Float32Array,
        fresh.solidEdgeGeometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);
      expect(maximumDelta(
        scene.creaseEdgeGeometry.getAttribute("position").array as Float32Array,
        fresh.creaseEdgeGeometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);
      expect(maximumDelta(
        scene.dashedEdgeGeometry.getAttribute("position").array as Float32Array,
        fresh.dashedEdgeGeometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);

      disposeScene(fresh);
    }

    disposeScene(scene);
  });
});
