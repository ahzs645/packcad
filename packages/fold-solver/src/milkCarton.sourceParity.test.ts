import { importPackCadProject } from "@packcad/format";
import { describe, expect, it } from "vitest";
import milkCartonSource from "./fixtures/milkCarton.packcad.json";
import { summarizeFolds } from "./foldConstrainedSolver";
import { foldNewtonSequence } from "./foldNewtonSolver";
import { resolvedKeyframeAngles } from "./foldPlaybackConstraints";

function milkCartonModel() {
  const model = importPackCadProject(JSON.stringify(milkCartonSource)).foldModel;
  if (!model) throw new Error("Milk carton fixture did not produce a fold model");
  return model;
}

describe("milk carton source parity", () => {
  it("keeps the imported carton topology and authored operations as a regression fixture", () => {
    const model = milkCartonModel();

    expect(model.verticesCoords).toHaveLength(57);
    expect(model.edgesVertices).toHaveLength(81);
    expect(model.facesVertices).toHaveLength(25);
    expect(model.keyframes.map((keyframe) => keyframe.label)).toEqual([
      "vertical creases",
      "small bottom flaps",
      "large bottom flap 1",
      "large bottom flap 2",
      "top closure",
    ]);
  });

  it("preserves signed legacy targets and solves the K5 gable branch", () => {
    const model = milkCartonModel();
    const topClosure = model.keyframes[4];

    expect(resolvedKeyframeAngles(topClosure)).toEqual({
      4: -120,
      5: -120,
      6: -120,
      7: -120,
      8: -45,
      26: -45,
      29: -45,
    });

    const solved = foldNewtonSequence(model);
    expect(solved.isSolved).toBe(true);
    expect(solved.stuck).toBe(false);
    expect(solved.maxEdgeError).toBeLessThan(0.001);
    expect(solved.maxAngleErrorDeg).toBeLessThan(0.1);

    const summary = summarizeFolds(model);
    expect(summary.keyframes.map((keyframe) => keyframe.status)).toEqual([
      "Solved",
      "Solved",
      "Solved",
      "Solved",
      "Solved",
    ]);
    expect(summary.overall).toMatchObject({
      status: "Solved",
      unresolvedSeams: 0,
    });
  });
});
