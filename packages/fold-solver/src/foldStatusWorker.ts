/// <reference lib="webworker" />

import {
  serveSteadySolverPlugin,
  type SolveWorkerScope,
  type SteadySolverPlugin,
} from "@atelier/sim";
import type { FoldModel } from "@packcad/format";
import { summarizeFolds } from "./foldConstrainedSolver";

type FoldStatusSummary = ReturnType<typeof summarizeFolds>;

const plugin: SteadySolverPlugin<
  FoldModel,
  "summary",
  FoldStatusSummary
> = {
  id: "packcad.fold-status.worker",
  backend: "cpu",
  prepare: async (model) => ({
    solve: async () => summarizeFolds(model),
    dispose: () => undefined,
  }),
};

serveSteadySolverPlugin(self as unknown as SolveWorkerScope, plugin);
