import { createMailerBoxProject } from "@packcad/fold-solver";
import { describe, expect, it } from "vitest";
import {
  BOUNDARY_EDGE_COLOR,
  LOCKED_FACE_TINT_OPACITY,
  SELECTED_EDGE_COLOR,
  SELECTED_FACE_TINT,
  SOURCE_2D_CREASE_COLOR,
  SOURCE_3D_CREASE_COLOR,
  resolveEdgeStyle,
} from "./edgeStyle";

describe("source edge appearance", () => {
  const project = createMailerBoxProject();
  const model = project.foldModel;
  if (!model) throw new Error("MailerBox fixture did not produce a fold model");

  it("uses thin-layer-ready solid boundary and U-crease colors in 3D", () => {
    const boundary = model.edgesAssignment.findIndex((value) => value === "B");
    const crease = model.edgesAssignment.findIndex((value) => value === "U");

    expect(resolveEdgeStyle(
      model, boundary, 0, "mountain-valley", "folded-3d", false, false,
    )).toMatchObject({ color: BOUNDARY_EDGE_COLOR, dashed: false });
    expect(resolveEdgeStyle(
      model, crease, 0, "mountain-valley", "folded-3d", false, false,
    )).toMatchObject({ color: SOURCE_3D_CREASE_COLOR, dashed: false });
    expect(resolveEdgeStyle(
      model, crease, 0, "mountain-valley", "flat-2d", false, false,
    )).toMatchObject({ color: SOURCE_2D_CREASE_COLOR, dashed: false });
    expect(SOURCE_3D_CREASE_COLOR).toBe("#b66a61");
  });

  it("uses one blue panel selection with a white perimeter", () => {
    expect(LOCKED_FACE_TINT_OPACITY).toBe(0);
    expect(SELECTED_FACE_TINT).toBe("#1677ff");
    expect(SELECTED_EDGE_COLOR).toBe("#ffffff");
  });

  it("colors active flat creases from their signed source fold angle", () => {
    const [edgeKey, angle] = Object.entries(model.keyframes[0]?.creaseAnglesDeg ?? {})
      .find(([, value]) => value !== 0) ?? [];
    if (edgeKey === undefined || angle === undefined) {
      throw new Error("MailerBox fixture is missing an active signed crease");
    }
    expect(resolveEdgeStyle(
      model,
      Number(edgeKey),
      1,
      "mountain-valley",
      "flat-2d",
      false,
      false,
    ).color).toBe(angle > 0 ? "#d93025" : "#2f6fed");
  });

  it("does not recolor edges merely because their panel is fixed", () => {
    const lockedBoundary = model.edgesAssignment.findIndex((assignment, edgeIndex) =>
      assignment === "B"
      && resolveEdgeStyle(
        model, edgeIndex, 5, "mountain-valley", "folded-3d", false, false,
      ).kind === "locked");
    expect(lockedBoundary).toBeGreaterThanOrEqual(0);
    expect(resolveEdgeStyle(
      model, lockedBoundary, 5, "mountain-valley", "folded-3d", false, false,
    )).toMatchObject({ color: BOUNDARY_EDGE_COLOR, dashed: false });
  });
});
