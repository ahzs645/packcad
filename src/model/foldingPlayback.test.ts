import {
  createFoldingPlayer,
  createMailerBoxProject,
  getFoldingPlayerFrame,
} from "@packcad/fold-solver";
import { describe, expect, it } from "vitest";
import {
  foldingPlaybackProgress,
  projectForFoldingFrame,
} from "./foldingPlayback";

describe("folding playback view state", () => {
  it("projects a reducer frame without mutating the editable project", () => {
    const project = createMailerBoxProject();
    const target = project.foldingSteps[2];
    if (!target) throw new Error("Mailer box fixture is missing its second fold step");
    const player = {
      ...createFoldingPlayer(project),
      stepIndex: 2,
      progress: 0.5,
      sourceDriven: false,
    };
    const frame = getFoldingPlayerFrame(project, player);
    const displayed = projectForFoldingFrame(project, frame);

    expect(displayed).not.toBe(project);
    expect(displayed.activeStepId).toBe(target.id);
    expect(displayed.foldingSteps[2]?.angle).toBeCloseTo(target.angle * 0.5);
    expect(project.activeStepId).not.toBe(target.id);
    expect(project.foldingSteps[2]?.angle).toBe(target.angle);
    expect(foldingPlaybackProgress(project, frame)).toBeCloseTo(0.3);
  });
});
