// Off-main-thread fold solve for the Project inspector's Solve status AND the
// per-keyframe badges. The source-style sequential Newton solve
// (summarizeFolds) can take a few seconds on dense patterns, so -- like the
// reference, whose solve is kept off the UI lifecycle -- we compute it here and
// post the verdict back, keeping the editor responsive. Both the overall pill
// and the keyframe badges come from this one solve so they cannot disagree.
import type { FoldModel } from "@packcad/format";
import { summarizeFolds } from "./foldConstrainedSolver";

self.onmessage = (event: MessageEvent<FoldModel>) => {
  const model = event.data;
  try {
    (self as unknown as Worker).postMessage(summarizeFolds(model));
  } catch {
    (self as unknown as Worker).postMessage({
      overall: {
        status: "Non-Rigid",
        message: "Fold solve failed before producing a verdict.",
        unresolvedSeams: model.keyframes.length,
        maxStrainPct: 0,
        maxAngleErrorDeg: 0,
      },
      keyframes: model.keyframes.map((keyframe) => ({
        id: keyframe.id,
        label: keyframe.label,
        status: "Non-Rigid",
        unresolvedSeams: 0,
      })),
    });
  }
};
