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

/** Accept both new-framework saves and original PACKCAD_MOCKUP source values. */
export function projectFromUnknown(parsed: unknown): PackagingProject {
  if (isRecord(parsed) && parsed.app_id === "PACKCAD_MOCKUP") {
    return importPackCadProject(JSON.stringify(parsed));
  }
  if (isPackagingProject(parsed)) return parsed;
  throw new Error("Unsupported PackCAD project document");
}

export function projectFromFileText(text: string): PackagingProject {
  return projectFromUnknown(JSON.parse(text) as unknown);
}
