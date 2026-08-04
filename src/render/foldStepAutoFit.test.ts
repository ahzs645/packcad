import { describe, expect, it } from "vitest";
import type { FoldModel } from "@packcad/format";
import {
  beginSettledFoldStepAutoFit,
  foldStepFitPadding,
  foldStepFrame,
  hasFoldPositionsForModel,
  isSameFoldStepFrame,
  updateSettledFoldStepAutoFit,
  type FoldStepFrame,
} from "./foldStepAutoFit";

const model = {} as FoldModel;

function frame(foldStepIndex: number): FoldStepFrame {
  return { model, viewMode: "3d", foldStepIndex };
}

describe("fold-step auto fit", () => {
  it("treats direct step selection as a new frame", () => {
    expect(isSameFoldStepFrame(frame(0), frame(0))).toBe(true);
    expect(isSameFoldStepFrame(frame(0), frame(1))).toBe(false);
    expect(isSameFoldStepFrame(frame(1), frame(2))).toBe(false);
  });

  it("keeps every fold step in the same flat-view camera frame", () => {
    const setup = foldStepFrame(model, "2d", 0);
    const keyframe = foldStepFrame(model, "2d", 2);

    expect(isSameFoldStepFrame(setup, keyframe)).toBe(true);
  });

  it("accepts only position buffers belonging to the current model", () => {
    const currentModel = {
      verticesCoords: Array.from({ length: 3 }, () => [0, 0]),
    } as unknown as FoldModel;

    expect(hasFoldPositionsForModel(currentModel, null, undefined)).toBe(false);
    expect(hasFoldPositionsForModel(currentModel, [[0, 0, 0]])).toBe(false);
    expect(hasFoldPositionsForModel(currentModel, [[], [], []])).toBe(true);
  });

  it("keeps compact 3D framing padded after settlement", () => {
    expect(foldStepFitPadding("3d", false)).toBeCloseTo(1 / 0.9, 12);
    expect(foldStepFitPadding("3d", true)).toBe(1.55);
    expect(foldStepFitPadding("2d", true)).toBe(1.08);
  });

  it("refits a directly selected step once its settled positions arrive", () => {
    const pending = beginSettledFoldStepAutoFit(frame(1), false, false);
    const waiting = updateSettledFoldStepAutoFit(
      pending,
      frame(1),
      false,
      false,
    );
    const settled = updateSettledFoldStepAutoFit(
      waiting.state,
      frame(1),
      false,
      true,
    );
    const repeated = updateSettledFoldStepAutoFit(
      settled.state,
      frame(1),
      false,
      true,
    );

    expect(waiting.fit).toBe(false);
    expect(settled.fit).toBe(true);
    expect(repeated.fit).toBe(false);
  });

  it("does not continuously refit playback and fits once when it stops", () => {
    const started = beginSettledFoldStepAutoFit(frame(2), true, true);
    const moving = updateSettledFoldStepAutoFit(
      started,
      frame(2),
      true,
      true,
    );
    const movingAgain = updateSettledFoldStepAutoFit(
      moving.state,
      frame(2),
      true,
      true,
    );
    const stopped = updateSettledFoldStepAutoFit(
      movingAgain.state,
      frame(2),
      false,
      true,
    );
    const settledAgain = updateSettledFoldStepAutoFit(
      stopped.state,
      frame(2),
      false,
      true,
    );

    expect(moving.fit).toBe(false);
    expect(movingAgain.fit).toBe(false);
    expect(stopped.fit).toBe(true);
    expect(settledAgain.fit).toBe(false);
  });
});
