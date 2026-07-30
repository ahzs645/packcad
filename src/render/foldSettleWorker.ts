/// <reference lib="webworker" />

import {
  serveSteadySolverPlugin,
  type SolveWorkerScope,
  type SteadySolverPlugin,
} from "@atelier/sim";
import { foldNewtonSequence } from "@packcad/fold-solver";
import type { FoldModel } from "@packcad/format";
import type {
  CachedFoldSettlement,
  FoldSettlementRequest,
} from "./foldSettlement";
import { settledFoldModel } from "./foldSettlement";

const plugin: SteadySolverPlugin<
  FoldModel,
  FoldSettlementRequest,
  CachedFoldSettlement
> = {
  id: "packcad.fold-settlement.worker",
  backend: "cpu",
  prepare: async (model) => ({
    solve: async ({ foldStepIndex, foldAngle }) => {
      const activeKeyframeIndex = foldStepIndex - 1;
      const solve = foldNewtonSequence(
        settledFoldModel(model, foldStepIndex, foldAngle),
        { uptoKeyframe: activeKeyframeIndex },
      );
      return {
        positions: solve.positions,
        maxEdgeError: solve.maxEdgeError,
        maxAngleErrorDeg: solve.maxAngleErrorDeg,
        converged: solve.isSolved,
      };
    },
    dispose: () => undefined,
  }),
};

serveSteadySolverPlugin(self as unknown as SolveWorkerScope, plugin);
