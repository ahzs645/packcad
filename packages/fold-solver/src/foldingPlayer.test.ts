import { describe, expect, it } from "vitest";
import { createMailerBoxProject } from "./sample";
import {
  advanceFoldingPlayer,
  createFoldingPlayer,
  startFoldingPlayer,
} from "./foldingPlayer";
import {
  findCreaseEdgeBiconnectedComponents,
  sourceStageConstraintAngles,
} from "./foldPlaybackConstraints";
import { solveFoldTimeline } from "./foldTimelineSolver";
import type { FoldModel } from "@packcad/format";
import { summarizeFolds } from "./foldConstrainedSolver";

function sourceProject() {
  const project = createMailerBoxProject();
  if (!project.foldModel) throw new Error("MailerBox fixture did not produce a fold model");
  return project as typeof project & { foldModel: NonNullable<typeof project.foldModel> };
}

function cyclicFaceModel(): FoldModel {
  return {
    verticesCoords: [[0, 0], [1, 0], [1, 1], [0, -1]],
    coordinateUnit: "px",
    verticesUv: [],
    verticesIDs: ["v0", "v1", "v2", "v3"],
    facesIDs: ["f0", "f1", "f2"],
    edgesVertices: [[0, 1], [1, 2], [1, 3], [2, 0], [0, 3], [2, 3]],
    edgesAssignment: ["F", "F", "F", "B", "B", "B"],
    facesVertices: [[0, 1, 2], [1, 0, 3], [2, 1, 3]],
    facesEdges: [[0, 1, 3], [0, 4, 2], [1, 2, 5]],
    edgeFaces: [[0, 1], [0, 2], [1, 2], [0], [1], [2]],
    fixedFaceIndex: 0,
    keyframes: [],
    transforms: [],
    thickness: null,
  };
}

describe("PackCAD-style folding replay", () => {
  it("retains enforcePriorConstraints from every source operation", () => {
    const project = sourceProject();
    expect(project.foldModel.keyframes).toHaveLength(5);
    expect(project.foldModel.keyframes.map((keyframe) => keyframe.enforcePriorConstraints)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("uses full active targets and does not blanket-constrain their biconnected block", () => {
    const model = cyclicFaceModel();
    const keyframe = {
      id: "fold",
      label: "Fold",
      creaseAnglesDeg: { 0: 90 },
      creaseEdgeGroup: { 0: 0 },
      fixedFaceIndices: [],
      fixedVertexIndices: [],
      enforcePriorConstraints: false,
    };
    const flat = model.verticesCoords.map(([x, y]) => [x, y, 0] as [number, number, number]);
    const constraints = sourceStageConstraintAngles(model, keyframe, flat, {});
    expect(findCreaseEdgeBiconnectedComponents(model).map((component) => component.slice().sort())).toEqual([[0, 1, 2]]);
    expect(constraints).toEqual({ 0: 90 });
  });

  it("paces persistent solver iterations from elapsed time", () => {
    const project = sourceProject();
    const initial = startFoldingPlayer(project, createFoldingPlayer(project));
    const shortFrame = advanceFoldingPlayer(project, initial, 1);
    const oneStepFrame = advanceFoldingPlayer(project, initial, 51);
    const catchUpFrame = advanceFoldingPlayer(project, initial, 1000);

    expect(shortFrame.sourceDriven).toBe(true);
    expect(shortFrame.stageIterations).toBe(0);
    expect(shortFrame.positions).toEqual(initial.positions);
    expect(oneStepFrame.stageIterations).toBe(1);
    expect(oneStepFrame.positions).not.toEqual(initial.positions);
    expect(catchUpFrame.stageIterations).toBeGreaterThan(1);
    expect(catchUpFrame.stageIterations).toBeLessThanOrEqual(4);
  });

  it("continues from the prior geometry and keeps one constraint set for the stage", () => {
    const project = sourceProject();
    const initial = startFoldingPlayer(project, createFoldingPlayer(project));
    const first = advanceFoldingPlayer(project, initial, 51);
    const second = advanceFoldingPlayer(project, first, 51);

    expect(second.stageIterations).toBe(2);
    expect(second.stageConstraintAngles).toEqual(first.stageConstraintAngles);
    expect(second.positions).not.toEqual(first.positions);
    expect(second.energyHistory.length).toBeGreaterThanOrEqual(first.energyHistory.length);
  });

  it("produces the same solver trajectory for the same elapsed time at different frame rates", () => {
    const project = sourceProject();
    const initial = startFoldingPlayer(project, createFoldingPlayer(project));
    let highRefresh = initial;
    let lowRefresh = initial;
    for (let index = 0; index < 120; index += 1) {
      highRefresh = advanceFoldingPlayer(project, highRefresh, 1000 / 120);
    }
    for (let index = 0; index < 20; index += 1) {
      lowRefresh = advanceFoldingPlayer(project, lowRefresh, 50);
    }

    expect(highRefresh.stepIndex).toBe(lowRefresh.stepIndex);
    expect(highRefresh.stageIterations).toBe(lowRefresh.stageIterations);
    expect(highRefresh.displayAngle).toBeCloseTo(lowRefresh.displayAngle, 8);
    expect(highRefresh.positions).toEqual(lowRefresh.positions);
  });

  it("completes all five source stages on one continuous finite trajectory", () => {
    const project = sourceProject();
    let player = startFoldingPlayer(project, createFoldingPlayer(project));
    const visited = new Set<number>();
    let updates = 0;
    while (player.playing && updates < 1_500) {
      visited.add(player.stepIndex);
      player = advanceFoldingPlayer(project, player, 1000 / 20);
      updates += 1;
    }

    expect(player.finished).toBe(true);
    expect(player.playing).toBe(false);
    expect([...visited]).toEqual([1, 2, 3, 4, 5]);
    expect(updates).toBeLessThanOrEqual(5 * 250);
    expect(player.positions?.flat().every(Number.isFinite)).toBe(true);
    expect(Object.keys(player.priorTargetAngles).length).toBeGreaterThan(0);
  });

  it("uses only the Newton sequence for paused timeline resolution", () => {
    const project = sourceProject();
    const solved = solveFoldTimeline(project.foldModel, 1, project.foldingSteps[1].angle);
    expect(solved.method).toBe("newton-sequence");
    expect(solved.positions).toHaveLength(project.foldModel.verticesCoords.length);
    expect(solved.positions.flat().every(Number.isFinite)).toBe(true);
  });

  it("reports solve status from the same source-style sequence", () => {
    const project = sourceProject();
    const summary = summarizeFolds(project.foldModel);
    expect(summary.overall.status).toBe("Solved");
    expect(summary.keyframes.map((keyframe) => keyframe.status)).toEqual([
      "Solved",
      "Solved",
      "Solved",
      "Solved",
      "Solved",
    ]);
  });
});
