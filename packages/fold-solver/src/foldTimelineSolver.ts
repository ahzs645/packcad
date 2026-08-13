import type { FoldKeyframe, FoldModel } from "@packcad/format";
import type { FoldBranchSigns } from "./foldBranchState";
import { boundingExtent, foldNewtonStage } from "./foldNewtonSolver";
import {
  appendPriorTargets,
  sourceStageConstraintAngles,
} from "./foldPlaybackConstraints";
import {
  creaseAnglesForTimeline,
  foldFaces,
  type Vec3,
} from "./foldSolver";

export type FoldTimelineSolveMethod = "flat" | "rigid-tree" | "newton-sequence" | "source-iterative";

export type FoldTimelineSolve = {
  positions: Vec3[];
  creaseAnglesDeg: Record<number, number>;
  ratio: number;
  method: FoldTimelineSolveMethod;
  maxEdgeError: number;
  maxAngleErrorDeg: number;
};

const MAX_SOLVER_ITERATIONS = 250;
const timelineCache = new WeakMap<FoldModel, Map<string, FoldTimelineSolve>>();

function flatPositions(model: FoldModel): Vec3[] {
  return model.verticesCoords.map(([x, y]) => [x, y, 0]);
}

function targetMaxForStep(model: FoldModel, foldStepIndex: number): number {
  const keyframe = model.keyframes[foldStepIndex - 1];
  return keyframe
    ? Math.max(1, ...Object.values(keyframe.creaseAnglesDeg).map((angle) => Math.abs(angle)))
    : 1;
}

function ratioForStep(model: FoldModel, foldStepIndex: number, foldAngle: number): number {
  if (foldStepIndex <= 0) return 0;
  return Math.max(0, Math.min(1, foldAngle / targetMaxForStep(model, foldStepIndex)));
}

function rigidTreePositions(model: FoldModel, creaseAnglesDeg: Record<number, number>): Vec3[] {
  const foldedFaces = foldFaces(model, creaseAnglesDeg);
  const faceByIndex = new Map(foldedFaces.map((face) => [face.faceIndex, face]));
  const positions = flatPositions(model);
  const assigned = new Array<boolean>(positions.length).fill(false);
  const visited = new Array<boolean>(model.facesVertices.length).fill(false);
  const faceOrder: number[] = [];
  const queue = [model.fixedFaceIndex];
  visited[model.fixedFaceIndex] = true;
  while (queue.length > 0) {
    const faceIndex = queue.shift() as number;
    faceOrder.push(faceIndex);
    for (const edgeIndex of model.facesEdges[faceIndex]) {
      for (const neighbor of model.edgeFaces[edgeIndex]) {
        if (visited[neighbor]) continue;
        visited[neighbor] = true;
        queue.push(neighbor);
      }
    }
  }
  for (let faceIndex = 0; faceIndex < model.facesVertices.length; faceIndex += 1) {
    if (!visited[faceIndex]) faceOrder.push(faceIndex);
  }
  for (const faceIndex of faceOrder) {
    const face = faceByIndex.get(faceIndex);
    if (!face) continue;
    model.facesVertices[faceIndex].forEach((vertexIndex, localIndex) => {
      if (assigned[vertexIndex]) return;
      const point = face.positions[localIndex];
      positions[vertexIndex] = [point[0], point[1], point[2]];
      assigned[vertexIndex] = true;
    });
  }
  return positions;
}

export function solveRigidFoldTimeline(
  model: FoldModel,
  foldStepIndex: number,
  foldAngle: number,
): FoldTimelineSolve {
  const ratio = ratioForStep(model, foldStepIndex, foldAngle);
  const creaseAnglesDeg = creaseAnglesForTimeline(model, foldStepIndex, ratio);
  return {
    positions: rigidTreePositions(model, creaseAnglesDeg),
    creaseAnglesDeg,
    ratio,
    method: foldStepIndex <= 0 ? "flat" : "rigid-tree",
    maxEdgeError: 0,
    maxAngleErrorDeg: 0,
  };
}

function scaledKeyframe(keyframe: FoldKeyframe, ratio: number): FoldKeyframe {
  return {
    ...keyframe,
    creaseAnglesDeg: Object.fromEntries(
      Object.entries(keyframe.creaseAnglesDeg).map(([edge, target]) => [Number(edge), target * ratio]),
    ),
  };
}

/**
 * Resolve a paused/editor timeline position with the same sequential Newton
 * solver and merged-constraint rules as replay. Animated replay supplies its
 * persistent positions directly and therefore never re-enters this sampler.
 */
export function solveFoldTimeline(
  model: FoldModel,
  foldStepIndex: number,
  foldAngle: number,
): FoldTimelineSolve {
  if (model.rigidTimeline) {
    return solveRigidFoldTimeline(model, foldStepIndex, foldAngle);
  }
  const activeKeyframe = foldStepIndex - 1;
  const ratio = ratioForStep(model, foldStepIndex, foldAngle);
  if (activeKeyframe < 0 || !model.keyframes[activeKeyframe]) {
    return {
      positions: flatPositions(model),
      creaseAnglesDeg: {},
      ratio: 0,
      method: "flat",
      maxEdgeError: 0,
      maxAngleErrorDeg: 0,
    };
  }

  const cache = timelineCache.get(model) ?? new Map<string, FoldTimelineSolve>();
  if (!timelineCache.has(model)) timelineCache.set(model, cache);
  const cacheKey = `${foldStepIndex}:${foldAngle}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let positions = flatPositions(model);
  let priorTargets: Record<number, number> = {};
  let branchSigns: FoldBranchSigns = {};
  let creaseAnglesDeg: Record<number, number> = {};
  let maxEdgeError = 0;
  let maxAngleErrorDeg = 0;

  for (let index = 0; index <= activeKeyframe; index += 1) {
    const original = model.keyframes[index];
    if (!original) break;
    if (index === activeKeyframe && ratio <= 0.001) break;
    const keyframe = index === activeKeyframe && ratio < 0.999
      ? scaledKeyframe(original, ratio)
      : original;
    creaseAnglesDeg = sourceStageConstraintAngles(
      model,
      keyframe,
      positions,
      priorTargets,
      branchSigns,
    );
    const solved = foldNewtonStage(model, creaseAnglesDeg, {
      maxIterations: MAX_SOLVER_ITERATIONS,
      seed: positions,
      fixedFaceIndices: keyframe.fixedFaceIndices,
      fixedVertexIndices: keyframe.fixedVertexIndices,
      solvedEdgeIndices: Object.keys(keyframe.creaseAnglesDeg).map(Number),
      branchSigns,
      scale: boundingExtent(positions),
    });
    positions = solved.positions;
    branchSigns = solved.branchSigns;
    maxEdgeError = solved.maxEdgeError;
    maxAngleErrorDeg = solved.maxAngleErrorDeg;
    if (index < activeKeyframe || ratio >= 0.999) {
      priorTargets = appendPriorTargets(priorTargets, original);
    }
  }

  const result: FoldTimelineSolve = {
    positions,
    creaseAnglesDeg,
    ratio,
    method: "newton-sequence",
    maxEdgeError,
    maxAngleErrorDeg,
  };
  cache.set(cacheKey, result);
  return result;
}
