// R2 outcome gate (atelier/docs/MIGRATION.md): the production solver now uses
// PackCAD's cdt2d backend directly, so guard the resulting fold rather than
// mocking an obsolete @atelier/geometry import.

import { describe, expect, it } from "vitest";
import { triangulateFoldModelFaces } from "./faceTriangulation";
import { foldNewtonSequence } from "./foldNewtonSolver";
import { createMailerBoxProject, createPillowBoxProject } from "./sample";

describe("R2: production cdt2d fold outcome", () => {
  it("constructs a complete triangulation for every source face", () => {
    for (const project of [createMailerBoxProject(), createPillowBoxProject()]) {
      const model = project.foldModel;
      if (!model) throw new Error("Fixture did not produce a fold model");
      const triangulations = triangulateFoldModelFaces(model);
      expect(triangulations).toHaveLength(model.facesVertices.length);
      triangulations.forEach((triangles, face) => {
        expect(triangles).toHaveLength(model.facesVertices[face].length - 2);
      });
    }
  });

  it("settles the MailerBox deterministically with the production mesh", () => {
    const model = createMailerBoxProject().foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const first = foldNewtonSequence(model);
    const second = foldNewtonSequence(model);

    expect(second.positions).toEqual(first.positions);
    expect(second.energy).toBe(first.energy);
    expect(first.maxEdgeError).toBeLessThan(1e-6);
    expect(first.stuck).toBe(false);
  });
});
