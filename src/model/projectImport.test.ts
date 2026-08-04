import { describe, expect, it } from "vitest";
import {
  createMailerBoxProject,
  createPillowBoxProject,
} from "@packcad/fold-solver";
import { projectFromFileText } from "./projectImport";

describe("project file import", () => {
  it("loads an original PACKCAD_MOCKUP source through the format adapter", () => {
    const source = createMailerBoxProject();
    const project = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP",
      app_version: "1.3.31",
      design: source.design,
    }));
    expect(project.foldModel?.verticesCoords).toHaveLength(104);
    expect(project.foldModel?.facesVertices).toHaveLength(19);
    expect(project.foldingSteps).toHaveLength(6);
  });

  it("imports a document purely from its own contents, with no per-file fixups", () => {
    const source = createPillowBoxProject();
    const project = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP",
      app_version: "1.3.31",
      design: source.design,
    }));
    // Importing the same design must reproduce the bundled sample exactly:
    // nothing may recognise a document and substitute captured state for it.
    expect(project.foldModel).toEqual(source.foldModel);
    expect(project.foldModel?.keyframes.map((keyframe) => keyframe.creaseAnglesDeg)).toEqual([
      { 56: 95, 89: 95, 160: 95, 193: 95 },
      { 0: 89, 1: 105 },
    ]);
  });

  it("continues to load new-framework project saves", () => {
    const saved = createMailerBoxProject();
    expect(projectFromFileText(JSON.stringify(saved))).toEqual(saved);
  });

  it("rejects arbitrary JSON before it can crash playback", () => {
    expect(() => projectFromFileText('{"name":"not a project"}')).toThrow(
      "Unsupported PackCAD project document",
    );
  });
});
