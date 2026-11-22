import { describe, expect, it } from "vitest";
import {
  createMailerBoxProject,
  createPillowBoxProject,
  createSideLoadVhsProject,
  createVhsSlipcoverProject,
} from "@packcad/fold-solver";
import type { OrigamiSimulationOperation } from "@packcad/format";
import { projectFromFileText } from "./projectImport";
import { renameOperation } from "./operationPipeline";

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

  it("preserves source-atlas artwork through source and editable save/open", () => {
    const design = structuredClone(createSideLoadVhsProject().design);
    if (!design) throw new Error("VHS fixture did not produce a design");
    design.modifiers.OPERATION_ARTWORK = {
      id: "OPERATION_ARTWORK",
      type: "OPERATION_ARTWORK",
      name: "Registered source artwork",
      enabled: true,
      uvConvention: "source-atlas",
      frontArtwork: "data:image/png;base64,front",
      backArtwork: "data:image/png;base64,back",
    };
    const sourceFile = { app_id: "PACKCAD_MOCKUP", app_version: "0.1.0", design };
    const imported = projectFromFileText(JSON.stringify(sourceFile));
    expect(imported.artwork.uvConvention).toBe("source-atlas");
    expect(imported.design?.modifiers.OPERATION_ARTWORK?.uvConvention).toBe("source-atlas");

    const editableReopened = projectFromFileText(JSON.stringify(imported));
    expect(editableReopened.artwork).toEqual(imported.artwork);
    const sourceReopened = projectFromFileText(JSON.stringify({
      ...sourceFile,
      design: imported.design,
    }));
    expect(sourceReopened.artwork.uvConvention).toBe("source-atlas");
    expect(sourceReopened.design?.modifiers.OPERATION_ARTWORK).toEqual(design.modifiers.OPERATION_ARTWORK);
  });

  it("keeps unmarked source documents on the legacy artwork convention", () => {
    const source = createMailerBoxProject();
    const imported = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP",
      app_version: "1.3.31",
      design: source.design,
    }));
    expect(source.artwork.uvConvention).toBeUndefined();
    expect(imported.artwork.uvConvention).toBeUndefined();
  });

  it("retains opt-in surface layers through source import, native open, and operation edits", () => {
    const source = createMailerBoxProject();
    const design = structuredClone(source.design);
    const model = source.foldModel;
    const thickness = design?.modifiers.OPERATION_THICKNESS;
    if (!design || !model || !thickness) throw new Error("Mailer fixture lacks source thickness");
    const firstFace = model.facesIDs[0];
    const secondFace = model.facesIDs[1];
    thickness.faceSurfaceLayers = { [firstFace]: -1.05, [secondFace]: 2.05 };
    const imported = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP", app_version: "0.1.0", design,
    }));
    expect(imported.design?.modifiers.OPERATION_THICKNESS?.faceSurfaceLayers).toEqual(
      thickness.faceSurfaceLayers,
    );
    expect(imported.foldModel?.faceSurfaceLayers?.slice(0, 3)).toEqual([-1.05, 2.05, null]);
    imported.foldModel!.rigidTimeline = true;
    const reopened = projectFromFileText(JSON.stringify(imported));
    expect(reopened.foldModel?.faceSurfaceLayers).toEqual(imported.foldModel?.faceSurfaceLayers);
    const renamed = renameOperation(reopened, reopened.foldModel!.keyframes[0].id, "Layered fold");
    expect(renamed.foldModel?.faceSurfaceLayers).toEqual(imported.foldModel?.faceSurfaceLayers);
    expect(renamed.foldModel?.rigidTimeline).toBe(true);
    expect(renamed.design?.modifiers.OPERATION_THICKNESS?.faceSurfaceLayers).toEqual(
      thickness.faceSurfaceLayers,
    );
  });

  it("does not opt unmarked projects into surface layering", () => {
    const source = createMailerBoxProject();
    const imported = projectFromFileText(JSON.stringify({
      app_id: "PACKCAD_MOCKUP", app_version: "0.1.0", design: source.design,
    }));
    expect(Object.hasOwn(imported.foldModel!, "faceSurfaceLayers")).toBe(false);
    expect(Object.hasOwn(imported.design!.modifiers.OPERATION_THICKNESS!, "faceSurfaceLayers")).toBe(false);
  });

  it("restores cavity metadata missing from older VHS sample drafts", () => {
    const saved = createVhsSlipcoverProject();
    if (!saved.foldModel) throw new Error("VHS sample did not produce a fold model");
    delete saved.foldModel.interiorFaceIndices;

    const restored = projectFromFileText(JSON.stringify(saved));

    expect(restored.foldModel?.interiorFaceIndices).toEqual([4, 6, 7, 8]);
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
