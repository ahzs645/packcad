import {
  applyTransforms,
  createMailerBoxProject,
  foldNewtonSequence,
} from "@packcad/fold-solver";
import { describe, expect, it } from "vitest";
import { settledFoldModel } from "./foldSettlement";

function faceNormal(
  positions: Array<[number, number, number]>,
  loop: number[],
): [number, number, number] {
  const normal: [number, number, number] = [0, 0, 0];
  loop.forEach((vertex, index) => {
    const current = positions[vertex];
    const next = positions[loop[(index + 1) % loop.length]];
    normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
    normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
    normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
  });
  const length = Math.hypot(...normal);
  return normal.map((component) => component / length) as [number, number, number];
}

describe("settled fold worker input", () => {
  it("settles the Mailer Box into a closed rigid solid", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const foldStepIndex = project.foldingSteps.length - 1;
    const foldAngle = project.foldingSteps[foldStepIndex]?.angle ?? 0;
    const settled = settledFoldModel(model, foldStepIndex, foldAngle);

    const solve = foldNewtonSequence(
      settled,
      { uptoKeyframe: foldStepIndex - 1 },
    );

    expect(solve.isSolved).toBe(true);
    expect(solve.maxEdgeError).toBeLessThan(5e-7);
    expect(solve.maxAngleErrorDeg).toBeLessThan(1e-5);

    const finalTargets = settled.keyframes.at(-1)?.creaseAnglesDeg ?? {};
    expect(finalTargets[8]).toBe(90);
    expect(finalTargets[19]).toBe(90);

    const oriented = applyTransforms(solve.positions, model.transforms);
    const lidNormal = faceNormal(oriented, model.facesVertices[2]);
    const tuckNormal = faceNormal(oriented, model.facesVertices[11]);
    expect(Math.abs(lidNormal[2])).toBeGreaterThan(0.999);
    expect(Math.abs(tuckNormal[1])).toBeGreaterThan(0.999);
  });
});
