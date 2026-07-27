import type { FoldKeyframe, FoldModel } from "@packcad/format";
import type { V3 } from "./foldSceneBuilder";

export type FoldSettlementRequest = {
  requestId: number;
  model: FoldModel;
  foldStepIndex: number;
  foldAngle: number;
};

export type FoldSettlementSuccess = {
  requestId: number;
  ok: true;
  positions: V3[];
  maxEdgeError: number;
  maxAngleErrorDeg: number;
  converged: boolean;
};

export type FoldSettlementFailure = {
  requestId: number;
  ok: false;
  message: string;
};

export type FoldSettlementResponse = FoldSettlementSuccess | FoldSettlementFailure;

export type FoldDiagnostics =
  | { status: "settling" }
  | {
      status: "settled";
      maxEdgeError: number;
      maxAngleErrorDeg: number;
      converged: boolean;
    }
  | { status: "error"; message: string };

export type CachedFoldSettlement = Omit<FoldSettlementSuccess, "requestId" | "ok">;

function finalImplicitClosureAngles(
  model: FoldModel,
  activeKeyframeIndex: number,
  foldAngle: number,
): Record<number, number> {
  if (activeKeyframeIndex !== model.keyframes.length - 1) return {};

  const explicitlyKeyed = new Set(
    model.keyframes.flatMap((keyframe) =>
      Object.keys(keyframe.creaseAnglesDeg).map(Number)),
  );
  const closureAngles: Record<number, number> = {};
  model.edgesVertices.forEach((_, edgeIndex) => {
    // The Mailer Box source leaves its body-to-lid and lid-to-tuck hinges as
    // interior "U" folds rather than assigning them to a keyframe. They must
    // stay untouched while scrubbing the authored stages, then complete with
    // the last settled fold so the deliverable is a closed package.
    if (
      model.edgesAssignment[edgeIndex] === "U"
      && model.edgeFaces[edgeIndex]?.length === 2
      && !explicitlyKeyed.has(edgeIndex)
    ) {
      closureAngles[edgeIndex] = foldAngle;
    }
  });
  return closureAngles;
}

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
    creaseAnglesDeg: {
      ...Object.fromEntries(
        Object.entries(active.creaseAnglesDeg).map(([edgeIndex, angle]) => [
          Number(edgeIndex),
          angle * ratio,
        ]),
      ),
      ...finalImplicitClosureAngles(model, activeKeyframeIndex, foldAngle),
    },
  };
  return {
    ...model,
    keyframes: model.keyframes.map((keyframe, index) =>
      index === activeKeyframeIndex ? scaled : keyframe),
  };
}
