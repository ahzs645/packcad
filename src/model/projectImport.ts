import {
  importPackCadProject,
  type PackagingProject,
} from "@packcad/format";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPackagingProject(value: unknown): value is PackagingProject {
  return isRecord(value)
    && Array.isArray(value.foldingSteps)
    && typeof value.activeStepId === "string"
    && typeof value.viewMode === "string";
}

function restoreDerivedSampleMetadata(project: PackagingProject): PackagingProject {
  const model = project.foldModel;
  if (
    model
    && project.dieline?.name === "vhs-slipcover-production-trace.svg"
    && model.facesVertices.length === 9
    && (model.interiorFaceIndices?.length ?? 0) === 0
  ) {
    // Drafts created before cavity-side rendering did not persist this derived
    // sample metadata. Without it, the two closure ears and tuck/glue flaps
    // are restored as exterior faces and their cut lines leak through the box.
    model.interiorFaceIndices = [4, 6, 7, 8];
  }
  return project;
}

/** Accept both new-framework saves and original PACKCAD_MOCKUP source values. */
export function projectFromUnknown(parsed: unknown): PackagingProject {
  if (isRecord(parsed) && parsed.app_id === "PACKCAD_MOCKUP") {
    return importPackCadProject(JSON.stringify(parsed));
  }
  if (isPackagingProject(parsed)) return restoreDerivedSampleMetadata(parsed);
  throw new Error("Unsupported PackCAD project document");
}

export function projectFromFileText(text: string): PackagingProject {
  return projectFromUnknown(JSON.parse(text) as unknown);
}
