import { createMailerBoxProject } from "@packcad/fold-solver";
import { describe, expect, it } from "vitest";
import {
  foldEdgeId,
  isSelectableCrease,
  sourceEdgeIndexFromPickSegment,
} from "./foldLineInteraction";

describe("fold-line selection mapping", () => {
  it("maps Atelier LineSegments hits back to source FOLD edges", () => {
    const mapping = Int32Array.from([7, 2, 11]);
    expect(sourceEdgeIndexFromPickSegment(mapping, 0)).toBe(7);
    expect(sourceEdgeIndexFromPickSegment(mapping, 2)).toBe(11);
    expect(sourceEdgeIndexFromPickSegment(mapping, 3)).toBeNull();
    expect(sourceEdgeIndexFromPickSegment(mapping, undefined)).toBeNull();
    expect(sourceEdgeIndexFromPickSegment(mapping, -1)).toBeNull();
  });

  it("identifies selectable creases and reconstructs their command edge ids", () => {
    const model = createMailerBoxProject().foldModel;
    if (!model) throw new Error("Mailer Box fixture did not produce a fold model");
    const creaseIndex = model.edgesAssignment.findIndex(
      (assignment, index) =>
        assignment !== "B" && (model.edgeFaces[index]?.length ?? 0) >= 2,
    );
    const boundaryIndex = model.edgesAssignment.findIndex(
      (assignment) => assignment === "B",
    );

    expect(creaseIndex).toBeGreaterThanOrEqual(0);
    expect(isSelectableCrease(model, creaseIndex)).toBe(true);
    expect(foldEdgeId(model, creaseIndex)).toMatch(/.+-.+/);
    expect(boundaryIndex).toBeGreaterThanOrEqual(0);
    expect(isSelectableCrease(model, boundaryIndex)).toBe(false);
  });
});
