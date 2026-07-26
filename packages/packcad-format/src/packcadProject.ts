// Importer for the real PackCAD Mockup project format.
//
// The captured app (`app_id: "PACKCAD_MOCKUP"`) serializes
// designs as an ordered operation pipeline plus a `modifiers` map, where folding
// geometry lives in a FOLD (https://github.com/edemaine/fold) crease pattern.
// The editable rebuild uses a much simpler `PackagingProject` shape, so this
// module does two things:
//
//   1. `parsePackCadProject` parses + lightly validates the real document into
//      faithful, typed structures (operations + parsedFOLD + modifiers).
//   2. `packCadProjectToProject` maps that faithful model onto the rebuild's
//      `PackagingProject` so the existing editor can actually open the samples.
//
// Mapping is intentionally best-effort and lossy.

import {
  createProject,
  materials,
  type DielineSource,
  type FoldingStep,
  type MaterialId,
  type PackagingProject,
} from "./packaging";
import { buildFoldModel } from "./foldGeometry";
import { resolveMaterialSpec } from "./materialCatalog";

export const packCadAppId = "PACKCAD_MOCKUP";

export type PackCadOperationType =
  | "OPERATION_IMPORT_SVG"
  | "OPERATION_IMPORT_MESH"
  | "OPERATION_TRANSFORM_3D_ROTATE_AXIS_ANGLE"
  | "OPERATION_TRANSFORM_3D_ROTATE_VECTOR_TO_VECTOR"
  | "OPERATION_TRANSFORM_3D_TRANSLATE"
  | "OPERATION_FOLDING_SETUP"
  | "OPERATION_ORIGAMI_SIMULATION";

// FOLD crease pattern (subset observed in the reference samples).
export type ParsedFold = {
  file_spec?: number;
  file_creator?: string;
  file_classes?: string[];
  frame_classes?: string[];
  frame_attributes?: string[];
  frame_unit?: string;
  vertices_coords: number[][];
  edges_vertices: number[][];
  edges_assignment: string[];
  faces_edges: number[][];
  faces_edges_orientation?: boolean[][];
  vertices_uv?: number[][];
  controlPoints_coords?: number[][];
};

export type ImportSvgFilter = {
  style: { key: string; value: string; tolerance: number };
  assignment: string;
};

export type PackCadOperationBase = {
  id: string;
  type: PackCadOperationType | string;
  name: string;
  enabled: boolean;
};

export type ImportSvgOperation = PackCadOperationBase & {
  type: "OPERATION_IMPORT_SVG";
  filename: string;
  svgString: string;
  preferredUnits?: string;
  filters?: ImportSvgFilter[];
  parsedFOLD?: ParsedFold;
  verticesAdded?: string[];
  facesAdded?: string[];
};

export type RotateAxisAngleOperation = PackCadOperationBase & {
  type: "OPERATION_TRANSFORM_3D_ROTATE_AXIS_ANGLE";
  originPositionOrElement: number[];
  axisOrientationOrElement: number[];
  angleDegrees: number;
};

export type TranslateOperation = PackCadOperationBase & {
  type: "OPERATION_TRANSFORM_3D_TRANSLATE";
  fromPositionOrElement: number[];
  toPositionOrElement: number[];
};

export type RotateVectorToVectorOperation = PackCadOperationBase & {
  type: "OPERATION_TRANSFORM_3D_ROTATE_VECTOR_TO_VECTOR";
  originPositionOrElement: number[];
  fromOrientationOrElement: number[];
  toOrientationOrElement: number[];
};

export type FoldingSetupOperation = PackCadOperationBase & {
  type: "OPERATION_FOLDING_SETUP";
  fixedFaceID: string;
};

export type FoldingEdgeGroup = {
  edgeIDs: string[];
  targetAngleDegrees: number;
  enabled: boolean;
};

export type OrigamiSimulationOperation = PackCadOperationBase & {
  type: "OPERATION_ORIGAMI_SIMULATION";
  foldingEdgeGroups: FoldingEdgeGroup[];
  fixedVertexIDs: string[];
  fixedFaceIDs: string[];
  enforcePriorConstraints: boolean;
};

export type PackCadOperation =
  | ImportSvgOperation
  | RotateAxisAngleOperation
  | TranslateOperation
  | RotateVectorToVectorOperation
  | FoldingSetupOperation
  | OrigamiSimulationOperation
  | PackCadOperationBase;

export type ThicknessModifier = {
  id: string;
  type: "OPERATION_THICKNESS";
  name: string;
  enabled: boolean;
  materialType: string;
  materialSubType?: string;
  thickness: number;
  thicknessOffsetDirection: string;
  materialRotationDegrees: number;
};

export type ArtworkModifier = {
  id: string;
  type: "OPERATION_ARTWORK";
  name: string;
  enabled: boolean;
  frontArtwork?: string;
  frontArtworkFilename?: string;
  backArtwork?: string;
  backArtworkFilename?: string;
};

export type PackCadModifiers = {
  OPERATION_THICKNESS?: ThicknessModifier;
  OPERATION_ARTWORK?: ArtworkModifier;
  [key: string]: { id: string; type: string; name: string; enabled: boolean } | undefined;
};

export type PackCadDesign = {
  id: string;
  name: string;
  units: string;
  operations: PackCadOperation[];
  modifiers: PackCadModifiers;
};

export type PackCadProjectFile = {
  app_version: string;
  app_id: string;
  design: PackCadDesign;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumberArray(value: unknown): number[] {
  return asArray(value).map((n) => asNumber(n));
}

/** True when a parsed JSON value looks like a real PackCAD project document. */
export function isPackCadProjectFile(value: unknown): boolean {
  return isRecord(value) && value.app_id === packCadAppId && isRecord(value.design);
}

function parseFold(value: unknown): ParsedFold | undefined {
  if (!isRecord(value)) return undefined;
  return {
    file_spec: typeof value.file_spec === "number" ? value.file_spec : undefined,
    file_creator: typeof value.file_creator === "string" ? value.file_creator : undefined,
    file_classes: asArray(value.file_classes).map((item) => asString(item)),
    frame_classes: asArray(value.frame_classes).map((item) => asString(item)),
    frame_attributes: asArray(value.frame_attributes).map((item) => asString(item)),
    frame_unit: typeof value.frame_unit === "string" ? value.frame_unit : undefined,
    vertices_coords: asArray(value.vertices_coords).map((row) =>
      asArray(row).map((n) => asNumber(n)),
    ),
    edges_vertices: asArray(value.edges_vertices).map((row) => asArray(row).map((n) => asNumber(n))),
    edges_assignment: asArray(value.edges_assignment).map((item) => asString(item)),
    faces_edges: asArray(value.faces_edges).map((row) => asArray(row).map((n) => asNumber(n))),
    faces_edges_orientation: asArray(value.faces_edges_orientation).map((row) =>
      asArray(row).map((b) => asBoolean(b)),
    ),
    vertices_uv: asArray(value.vertices_uv).map((row) => asArray(row).map((n) => asNumber(n))),
    controlPoints_coords: asArray(value.controlPoints_coords).map((row) =>
      asArray(row).map((n) => asNumber(n)),
    ),
  };
}

function parseOperation(value: unknown): PackCadOperation | null {
  if (!isRecord(value)) return null;
  const base: PackCadOperationBase = {
    id: asString(value.id),
    type: asString(value.type),
    name: asString(value.name),
    enabled: asBoolean(value.enabled, true),
  };

  switch (base.type) {
    case "OPERATION_IMPORT_SVG":
      return {
        ...base,
        type: "OPERATION_IMPORT_SVG",
        filename: asString(value.filename),
        svgString: asString(value.svgString),
        preferredUnits: typeof value.preferredUnits === "string" ? value.preferredUnits : undefined,
        filters: asArray(value.filters)
          .filter(isRecord)
          .map((filter) => ({
            style: {
              key: asString((filter.style as UnknownRecord)?.key),
              value: asString((filter.style as UnknownRecord)?.value),
              tolerance: asNumber((filter.style as UnknownRecord)?.tolerance),
            },
            assignment: asString(filter.assignment),
          })),
        parsedFOLD: parseFold(value.parsedFOLD),
        verticesAdded: asArray(value.verticesAdded).map((item) => asString(item)),
        facesAdded: asArray(value.facesAdded).map((item) => asString(item)),
      };
    case "OPERATION_TRANSFORM_3D_ROTATE_AXIS_ANGLE":
      return {
        ...base,
        type: "OPERATION_TRANSFORM_3D_ROTATE_AXIS_ANGLE",
        originPositionOrElement: asNumberArray(value.originPositionOrElement),
        axisOrientationOrElement: asNumberArray(value.axisOrientationOrElement),
        angleDegrees: asNumber(value.angleDegrees),
      };
    case "OPERATION_TRANSFORM_3D_TRANSLATE":
      return {
        ...base,
        type: "OPERATION_TRANSFORM_3D_TRANSLATE",
        fromPositionOrElement: asNumberArray(value.fromPositionOrElement),
        toPositionOrElement: asNumberArray(value.toPositionOrElement),
      };
    case "OPERATION_TRANSFORM_3D_ROTATE_VECTOR_TO_VECTOR":
      return {
        ...base,
        type: "OPERATION_TRANSFORM_3D_ROTATE_VECTOR_TO_VECTOR",
        originPositionOrElement: asNumberArray(value.originPositionOrElement),
        fromOrientationOrElement: asNumberArray(value.fromOrientationOrElement),
        toOrientationOrElement: asNumberArray(value.toOrientationOrElement),
      };
    case "OPERATION_FOLDING_SETUP":
      return {
        ...base,
        type: "OPERATION_FOLDING_SETUP",
        fixedFaceID: asString(value.fixedFaceID),
      };
    case "OPERATION_ORIGAMI_SIMULATION":
      return {
        ...base,
        type: "OPERATION_ORIGAMI_SIMULATION",
        foldingEdgeGroups: asArray(value.foldingEdgeGroups)
          .filter(isRecord)
          .map((group) => ({
            edgeIDs: asArray(group.edgeIDs).map((item) => asString(item)),
            targetAngleDegrees: asNumber(group.targetAngleDegrees),
            enabled: asBoolean(group.enabled, true),
          })),
        fixedVertexIDs: asArray(value.fixedVertexIDs).map((item) => asString(item)),
        fixedFaceIDs: asArray(value.fixedFaceIDs).map((item) => asString(item)),
        enforcePriorConstraints: asBoolean(value.enforcePriorConstraints),
      };
    default:
      // Preserve unknown operation payloads so downstream recovery code can
      // inspect fields from newer source versions instead of silently no-oping.
      return { ...value, ...base } as PackCadOperationBase;
  }
}

function parseModifiers(value: unknown): PackCadModifiers {
  if (!isRecord(value)) return {};
  const modifiers: PackCadModifiers = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const common = {
      id: asString(raw.id, key),
      type: asString(raw.type, key),
      name: asString(raw.name, key),
      enabled: asBoolean(raw.enabled, true),
    };
    if (key === "OPERATION_THICKNESS") {
      modifiers.OPERATION_THICKNESS = {
        ...common,
        type: "OPERATION_THICKNESS",
        materialType: asString(raw.materialType, "MATERIAL_NONE"),
        materialSubType:
          typeof raw.materialSubType === "string" ? raw.materialSubType : undefined,
        thickness: asNumber(raw.thickness),
        thicknessOffsetDirection: asString(
          raw.thicknessOffsetDirection,
          "THICKNESS_OFFSET_DIRECTION_BOTH",
        ),
        materialRotationDegrees: asNumber(raw.materialRotationDegrees),
      };
    } else if (key === "OPERATION_ARTWORK") {
      modifiers.OPERATION_ARTWORK = {
        ...common,
        type: "OPERATION_ARTWORK",
        frontArtwork: asString(raw.frontArtwork) || undefined,
        frontArtworkFilename: asString(raw.frontArtworkFilename) || undefined,
        backArtwork: asString(raw.backArtwork) || undefined,
        backArtworkFilename: asString(raw.backArtworkFilename) || undefined,
      };
    } else {
      modifiers[key] = common;
    }
  }
  return modifiers;
}

export type SourceArtwork = {
  frontArtwork?: string;
  frontArtworkFilename?: string;
  backArtwork?: string;
  backArtworkFilename?: string;
};

export function getEnabledSourceArtwork(design?: PackCadDesign | null): SourceArtwork | null {
  const artwork = design?.modifiers.OPERATION_ARTWORK;
  if (!artwork?.enabled) return null;
  const source = {
    frontArtwork: artwork.frontArtwork,
    frontArtworkFilename: artwork.frontArtworkFilename,
    backArtwork: artwork.backArtwork,
    backArtworkFilename: artwork.backArtworkFilename,
  };
  return source.frontArtwork || source.backArtwork ? source : null;
}

/**
 * Parse a real PackCAD Mockup project document into faithful typed structures.
 * Throws when the text is not JSON or is not a PackCAD document.
 */
export function parsePackCadProject(text: string): PackCadProjectFile {
  const parsed = JSON.parse(text) as unknown;
  if (!isPackCadProjectFile(parsed)) {
    throw new Error('Not a PackCAD project document (expected app_id "PACKCAD_MOCKUP").');
  }
  const root = parsed as UnknownRecord;
  const design = root.design as UnknownRecord;
  return {
    app_version: asString(root.app_version),
    app_id: asString(root.app_id, packCadAppId),
    design: {
      id: asString(design.id),
      name: asString(design.name, "Untitled"),
      units: asString(design.units, "in"),
      operations: asArray(design.operations)
        .map(parseOperation)
        .filter((op): op is PackCadOperation => op !== null),
      modifiers: parseModifiers(design.modifiers),
    },
  };
}

// --- Mapping onto the rebuild's simplified PackagingProject -------------------

/** Map a captured MATERIAL_* id onto one of the rebuild's swatch ids. */
export function mapMaterial(materialType: string, materialSubType?: string): MaterialId {
  if (materialType === "MATERIAL_CHIPBOARD") return "chipboard";
  if (materialType === "MATERIAL_KRAFT_PAPERBOARD") return "kraft";
  if (materialType === "MATERIAL_CORRUGATED_CARDBOARD") {
    // Single-wall flute sub-types map onto the dedicated "flute" swatch.
    return materialSubType && materialSubType.includes("FLUTE") ? "flute" : "corrugated";
  }
  return "kraft";
}

/** Convert a thickness expressed in the design's units to millimetres. */
export function thicknessToMm(thickness: number, units: string): number {
  const mm = units === "in" ? thickness * 25.4 : thickness;
  return Math.max(0.1, Math.min(12, Number.isFinite(mm) && mm > 0 ? mm : 1.6));
}

function dielineFromOperations(design: PackCadDesign): DielineSource {
  // The `default` branch of parseOperation can yield a bare base op, so the
  // discriminated union includes a member without `svgString`; narrow by hand.
  const importOp = design.operations.find((op) => op.type === "OPERATION_IMPORT_SVG") as
    | ImportSvgOperation
    | undefined;
  if (!importOp || !importOp.svgString) return createProject().dieline;
  return {
    name: importOp.filename || `${design.name}.svg`,
    kind: "svg",
    text: importOp.svgString,
  };
}

function foldingStepsFromOperations(design: PackCadDesign): FoldingStep[] {
  const steps: FoldingStep[] = [{ id: "setup", label: "Folding Setup", angle: 0 }];
  for (const op of design.operations) {
    if (op.type !== "OPERATION_ORIGAMI_SIMULATION" || !op.enabled) continue;
    const origami = op as OrigamiSimulationOperation;
    const groups = origami.foldingEdgeGroups.filter((group) => group.enabled);
    // Use the largest-magnitude target so negative (opposite-direction) folds
    // like a lid closure aren't collapsed to 0; the signed per-edge angles live
    // in the keyframe and are scaled by this step's fold ratio.
    const target = groups.reduce((max, group) => Math.max(max, Math.abs(group.targetAngleDegrees)), 0);
    steps.push({
      id: origami.id,
      label: origami.name || "Folding Keyframe",
      angle: Math.max(0, Math.min(180, target)),
    });
  }
  return steps;
}

/**
 * Best-effort projection of a faithful PackCAD design onto the editable
 * `PackagingProject` so the existing UI can open it. Geometry that the rebuild
 * cannot yet represent (FOLD mesh, per-edge fold solving, 3D transforms) is
 * dropped.
 */
/**
 * Derive the design-driven slice of a PackagingProject from a (possibly edited)
 * PackCAD design: material, thickness, dieline, fold steps, fold model, and the
 * source-owned design itself. View/edit settings are left to the caller.
 */
export function deriveFromDesign(design: PackCadDesign): Partial<PackagingProject> {
  const defaults = createProject();
  const thicknessMod =
    design.modifiers.OPERATION_THICKNESS && design.modifiers.OPERATION_THICKNESS.enabled
      ? design.modifiers.OPERATION_THICKNESS
      : undefined;
  const steps = foldingStepsFromOperations(design);
  const spec = thicknessMod
    ? resolveMaterialSpec(thicknessMod.materialType, thicknessMod.materialSubType)
    : resolveMaterialSpec(defaults.materialSpec);
  const material = spec.swatch in materials ? spec.swatch : defaults.material;

  return {
    material,
    materialSpec: spec.id,
    thicknessMm: thicknessMod ? thicknessToMm(thicknessMod.thickness, design.units) : defaults.thicknessMm,
    foldingSteps: steps,
    activeStepId: "setup",
    dieline: dielineFromOperations(design),
    foldModel: buildFoldModel(design),
    design,
  };
}

export function packCadProjectToProject(file: PackCadProjectFile): PackagingProject {
  const project = { ...createProject(), ...deriveFromDesign(file.design) };
  const lastStep = project.foldingSteps[project.foldingSteps.length - 1];
  return lastStep ? { ...project, activeStepId: lastStep.id } : project;
}

/** Convenience: parse text and project it onto a PackagingProject in one step. */
export function importPackCadProject(text: string): PackagingProject {
  return packCadProjectToProject(parsePackCadProject(text));
}
