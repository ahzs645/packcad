import { describe, expect, it } from "vitest";
import {
  createMailerBoxProject,
  createVhsSlipcoverProject,
  solveFoldTimeline,
} from "@packcad/fold-solver";
import { renameOperation, setOperationTargetAngle } from "./operationPipeline";

describe("operation pipeline playback choice", () => {
  it("keeps rigid playback after changing an authored fold angle and operation name", () => {
    const original = createVhsSlipcoverProject();
    const firstStage = original.foldModel?.keyframes[0];
    if (!firstStage) throw new Error("Rigid fixture did not produce a folding stage");
    expect(original.foldModel?.rigidTimeline).toBe(true);

    const angled = setOperationTargetAngle(original, firstStage.id, -45);
    const edited = renameOperation(angled, firstStage.id, "Revised rigid fold");
    const model = edited.foldModel;
    if (!model) throw new Error("Operation edit removed the fold model");

    expect(model).not.toBe(original.foldModel);
    expect(model.rigidTimeline).toBe(true);
    expect(model.keyframes[0].label).toBe("Revised rigid fold");
    expect(Object.values(model.keyframes[0].creaseAnglesDeg)).not.toHaveLength(0);
    expect(Object.values(model.keyframes[0].creaseAnglesDeg).every(angle => angle === -45)).toBe(true);
    expect(solveFoldTimeline(model, 1, 45).method).toBe("rigid-tree");
    expect(original.foldModel?.keyframes[0].label).toBe(firstStage.label);
    expect(Object.values(original.foldModel!.keyframes[0].creaseAnglesDeg)).not.toContain(-45);
  });

  it.each([false, undefined])("retains the legacy playback choice %s after an operation edit", (choice) => {
    const original = createMailerBoxProject();
    const model = original.foldModel;
    if (!model) throw new Error("Mailer fixture did not produce a fold model");
    if (choice === undefined) delete model.rigidTimeline;
    else model.rigidTimeline = choice;

    const edited = renameOperation(original, model.keyframes[0].id, "Renamed mailer fold");
    expect(edited.foldModel?.rigidTimeline).toBe(choice);
    expect(Object.hasOwn(edited.foldModel!, "rigidTimeline")).toBe(choice !== undefined);
    expect(edited.foldModel?.keyframes[0].label).toBe("Renamed mailer fold");
  });
});
