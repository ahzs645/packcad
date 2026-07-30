import {
  createSolveHost,
  createWorkerSteadySolverPlugin,
  type SolveHost,
  type SteadySolverPlugin,
} from "@atelier/sim";
import type {
  FoldSummary,
  KeyframeSummary,
} from "@packcad/fold-solver";
import type { FoldModel } from "@packcad/format";

export type FoldStatusSummary = {
  overall: FoldSummary;
  keyframes: KeyframeSummary[];
};

export type FoldStatusState =
  | { status: "idle" }
  | { status: "solving" }
  | { status: "ready"; summary: FoldStatusSummary }
  | { status: "error"; message: string };

type FoldStatusPlugin = SteadySolverPlugin<
  FoldModel,
  "summary",
  FoldStatusSummary
>;

function createFoldStatusWorkerPlugin(): FoldStatusPlugin {
  return createWorkerSteadySolverPlugin({
    id: "packcad.fold-status",
    createWorker: () => new Worker(
      new URL("../../packages/fold-solver/src/foldStatusWorker.ts", import.meta.url),
      { type: "module" },
    ),
    cancelMode: "terminate",
  });
}

export function createFoldStatusHost(
  model: FoldModel,
): Promise<SolveHost<"summary", FoldStatusSummary>> {
  return createSolveHost(createFoldStatusWorkerPlugin(), {
    input: model,
    cacheKey: () => "summary",
  });
}
