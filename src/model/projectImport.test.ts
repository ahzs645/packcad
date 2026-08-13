import { describe, expect, it } from "vitest";
import {
  createMailerBoxProject,
  createPillowBoxProject,
  createSideLoadVhsProject,
} from "@packcad/fold-solver";
import type { OrigamiSimulationOperation } from "@packcad/format";
import { projectFromFileText } from "./projectImport";

describe("project file import", () => {
  it("loads an original PACKCAD_MOCKUP source through the format adapter", () => {
    const source = createMailerBoxProject();
    const project = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP",
      app_version: "1.3.31",
      design: source.design,
    }));
    expect(project.foldModel?.verticesCoords).toHaveLength(106);
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
      { 54: 95, 86: 95, 159: 95, 194: 95 },
      { 0: 89, 1: 105 },
    ]);
  });

  it("continues to load new-framework project saves", () => {
    const saved = createMailerBoxProject();
    expect(projectFromFileText(JSON.stringify(saved))).toEqual(saved);
  });

  it("preserves authored glue areas through source-format save and load", () => {
    const source = createSideLoadVhsProject();
    const project = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP",
      app_version: "0.1.0",
      design: source.design,
    }));
    const seam = project.design?.operations.find(
      (operation) => operation.name === "Close and glue side seam",
    ) as OrigamiSimulationOperation | undefined;
    expect(seam?.glueFaceIDs).toHaveLength(2);
    expect(
      project.foldModel?.keyframes.find((keyframe) => keyframe.id === seam?.id)
        ?.glueFaceIndices,
    ).toHaveLength(2);
  });

  it("rejects arbitrary JSON before it can crash playback", () => {
    expect(() => projectFromFileText('{"name":"not a project"}')).toThrow(
      "Unsupported PackCAD project document",
    );
  });
});
