/// <reference lib="webworker" />

import { foldNewtonSequence } from "@packcad/fold-solver";
import type {
  FoldSettlementRequest,
  FoldSettlementResponse,
} from "./foldSettlement";
import { settledFoldModel } from "./foldSettlement";

self.onmessage = (event: MessageEvent<FoldSettlementRequest>): void => {
  const { requestId, model, foldStepIndex, foldAngle } = event.data;
  let response: FoldSettlementResponse;
  try {
    const activeKeyframeIndex = foldStepIndex - 1;
    const solve = foldNewtonSequence(
      settledFoldModel(model, foldStepIndex, foldAngle),
      { uptoKeyframe: activeKeyframeIndex },
    );
    response = {
      requestId,
      ok: true,
      positions: solve.positions,
      maxEdgeError: solve.maxEdgeError,
      maxAngleErrorDeg: solve.maxAngleErrorDeg,
      converged: solve.isSolved,
    };
  } catch (error) {
    response = {
      requestId,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
