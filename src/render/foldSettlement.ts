import type { FoldKeyframe, FoldModel } from "@packcad/format";
import type { V3 } from "./foldSceneBuilder";

export type FoldSettlementRequest = {
  foldStepIndex: number;
  foldAngle: number;
};

export type CachedFoldSettlement = {
  positions: V3[];
  maxEdgeError: number;
  maxAngleErrorDeg: number;
  converged: boolean;
};

export type FoldDiagnostics =
  | { status: "settling" }
  | {
      status: "settled";
      maxEdgeError: number;
      maxAngleErrorDeg: number;
      converged: boolean;
    }
  | { status: "error"; message: string };

export function settledFoldModel(
  model: FoldModel,
  foldStepIndex: number,
  foldAngle: number,
): FoldModel {
  const activeKeyframeIndex = foldStepIndex - 1;
  const active = model.keyframes[activeKeyframeIndex];
  if (!active) return model;

  const targetMaximum = Math.max(
    1,
    ...Object.values(active.creaseAnglesDeg).map((angle) => Math.abs(angle)),
  );
  const ratio = Math.max(0, Math.min(1, foldAngle / targetMaximum));
  const scaled: FoldKeyframe = {
    ...active,
    creaseAnglesDeg: Object.fromEntries(
      Object.entries(active.creaseAnglesDeg).map(([edgeIndex, angle]) => [
        Number(edgeIndex),
        angle * ratio,
      ]),
    ),
  };
  return {
    ...model,
    keyframes: model.keyframes.map((keyframe, index) =>
      index === activeKeyframeIndex ? scaled : keyframe),
  };
}
