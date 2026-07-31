import { describe, expect, it } from "vitest";
import { createMailerBoxProject } from "@packcad/fold-solver";
import { projectFromFileText } from "./projectImport";

describe("project file import", () => {
  it("loads an original PACKCAD_MOCKUP source through the format adapter", () => {
    const source = createMailerBoxProject();
    const project = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP",
      app_version: "1.3.31",
      design: source.design,
    }));
    expect(project.foldModel?.verticesCoords).toHaveLength(74);
    expect(project.foldModel?.facesVertices).toHaveLength(19);
    expect(project.foldingSteps).toHaveLength(6);
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
