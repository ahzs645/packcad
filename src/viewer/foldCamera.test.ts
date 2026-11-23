import { solveRigidFoldTimeline } from "@packcad/fold-solver";
import type { FoldModel, FoldingStep } from "@packcad/format";
import { describe, expect, it } from "vitest";
import { buildFoldScene, foldScenePositions } from "../render/foldSceneBuilder";
import { blendPose, boxOf, easeInOut, planFoldShots, shotDirection, type FoldCameraPose } from "./foldCamera";

const BASE: [number, number, number] = [1, 0.8, 1];

/** A 10 × 10 body with a 10 × 10 flap on its +x edge, folded through `angle` in one stage. */
function flapModel(angle = 90): { model: FoldModel; steps: FoldingStep[] } {
  const model: FoldModel = {
    verticesCoords: [[0, 0], [10, 0], [10, 10], [0, 10], [20, 0], [20, 10]],
    coordinateUnit: "mm",
    verticesUv: [],
    verticesIDs: ["v0", "v1", "v2", "v3", "v4", "v5"],
    facesIDs: ["body", "flap"],
    edgesVertices: [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 5], [5, 2]],
    edgesAssignment: ["B", "V", "B", "B", "B", "B", "B"],
    facesVertices: [[0, 1, 2, 3], [1, 4, 5, 2]],
    facesEdges: [[0, 1, 2, 3], [4, 5, 6, 1]],
    edgeFaces: [[0], [0, 1], [0], [0], [1], [1], [1]],
    fixedFaceIndex: 0,
    keyframes: [{
      id: "fold", label: "Fold the flap", creaseAnglesDeg: { 1: angle },
      creaseEdgeGroup: { 1: 0 }, fixedFaceIndices: [0], fixedVertexIndices: [],
      enforcePriorConstraints: false,
    }],
    transforms: [],
    thickness: { value: 0.1, direction: "THICKNESS_OFFSET_DIRECTION_BACK", units: "mm", rotationDegrees: 0 },
    rigidTimeline: true,
  };
  return {
    model,
    steps: [
      { id: "setup", label: "Folding Setup", angle: 0 },
      { id: "fold", label: "Fold the flap", angle },
    ],
  };
}

describe("foldScenePositions", () => {
  it("puts vertices where the folded scene draws them, stood on the ground", () => {
    const { model } = flapModel();
    const solved = solveRigidFoldTimeline(model, 1, 90).positions;
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 1,
      foldAngle: 90,
      thicknessMm: 0,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });
    const box = boxOf(foldScenePositions(model, solved));
    scene.geometry.computeBoundingBox();
    const drawn = scene.geometry.boundingBox!;
    expect(box.min[1]).toBeCloseTo(0, 6);
    expect(box.min[0]).toBeCloseTo(drawn.min.x, 3);
    expect(box.max[0]).toBeCloseTo(drawn.max.x, 3);
    expect(box.min[1]).toBeCloseTo(drawn.min.y, 3);
    expect(box.max[1]).toBeCloseTo(drawn.max.y, 3);
    expect(box.min[2]).toBeCloseTo(drawn.min.z, 3);
    expect(box.max[2]).toBeCloseTo(drawn.max.z, 3);
    scene.geometry.dispose();
  });
});

describe("shotDirection", () => {
  it("keeps the starting view when the moving panels are central", () => {
    const direction = shotDirection(BASE, [0, 0, 0]);
    expect(direction[0]).toBeGreaterThan(0);
    expect(direction[1]).toBeGreaterThan(0);
    expect(direction[2]).toBeGreaterThan(0);
  });

  it("looks from below at panels on the underside", () => {
    expect(shotDirection(BASE, [0, -0.8, 0])[1]).toBeLessThan(0);
    expect(shotDirection(BASE, [0, -0.2, 0])[1]).toBeGreaterThan(0);
  });

  it("looks from the end or side the panels are at", () => {
    const rear = shotDirection(BASE, [-0.9, 0, 0]);
    expect(rear[0]).toBeLessThan(0);
    expect(rear[2]).toBeGreaterThan(0);
    expect(shotDirection(BASE, [0, 0, -0.9])[2]).toBeLessThan(0);
  });

  it("is a unit vector", () => {
    expect(Math.hypot(...shotDirection(BASE, [-0.9, -0.9, -0.9]))).toBeCloseTo(1, 9);
  });
});

describe("planFoldShots", () => {
  it("plans a shot for the sheet, each stage and the finished model", () => {
    const { model, steps } = flapModel();
    const plan = planFoldShots(model, steps, BASE)!;
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].moving).toBe(0);
    expect(plan.steps[1].moving).toBe(1);
    expect(plan.final.direction).toEqual(plan.steps[0].direction);
  });

  it("finds the stage's panel where it ends up, and keeps the whole sweep in frame", () => {
    const { model, steps } = flapModel();
    const plan = planFoldShots(model, steps, BASE)!;
    const stage = plan.steps[1];
    // The flap ends standing on the body's +x edge: at that end of the package.
    expect(stage.offset![0]).toBeGreaterThan(0.45);
    const swept = [0, 45, 90].flatMap((angle) => foldScenePositions(
      model,
      solveRigidFoldTimeline(model, 1, angle).positions,
    ));
    const all = boxOf(swept);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(stage.box.min[axis]).toBeLessThanOrEqual(all.min[axis] + 1e-9);
      expect(stage.box.max[axis]).toBeGreaterThanOrEqual(all.max[axis] - 1e-9);
    }
  });

  it("does not plan for a model folded by the iterative solver", () => {
    const { model, steps } = flapModel();
    expect(planFoldShots({ ...model, rigidTimeline: false }, steps, BASE)).toBeNull();
    expect(planFoldShots(null, steps, BASE)).toBeNull();
  });
});

describe("blendPose", () => {
  const from: FoldCameraPose = { target: [0, 0, 0], direction: [1, 0, 0], distance: 2, zoom: 1 };
  const to: FoldCameraPose = { target: [2, 0, 0], direction: [0, 0, 1], distance: 4, zoom: 4 };

  it("starts and ends on the two poses", () => {
    expect(blendPose(from, to, 0)).toEqual(from);
    const end = blendPose(from, to, 1);
    expect(end.target).toEqual(to.target);
    expect(end.direction[2]).toBeCloseTo(1, 9);
    expect(end.zoom).toBeCloseTo(4, 9);
  });

  it("turns rather than cutting through the middle, and zooms by ratio", () => {
    const middle = blendPose(from, to, 0.5);
    expect(Math.hypot(...middle.direction)).toBeCloseTo(1, 9);
    expect(middle.direction[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(middle.zoom).toBeCloseTo(2, 9);
    expect(middle.distance).toBeCloseTo(3, 9);
  });

  it("eases in and out", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(2)).toBe(1);
  });
});
