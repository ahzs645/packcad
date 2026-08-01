// FOLD crease-pattern geometry utilities (framework-free, node-verifiable).
//
// Turns a captured `parsedFOLD` block
// plus the operation pipeline into a `FoldModel`: ordered face vertex loops,
// triangulation, edge adjacency, the fixed reference face, and a cumulative
// fold timeline resolved from OPERATION_ORIGAMI_SIMULATION edge groups.

import {
  faceVertexLoop,
  orientFacesConsistently,
} from "@atelier/geometry";
import type {
  OrigamiSimulationOperation,
  PackCadDesign,
  ImportSvgFilter,
  ParsedFold,
  RotateAxisAngleOperation,
} from "./packcadProject";
import { buildFoldFromSvg } from "./svgFold";

// A 3D transform from the operation pipeline (OPERATION_TRANSFORM_3D_*).
export type FoldTransform =
  | { kind: "rotateAxisAngle"; origin: number[]; axis: number[]; angleDegrees: number }
  | { kind: "translate"; offset: number[] }
  | { kind: "rotateVectorToVector"; origin: number[]; from: number[]; to: number[] };

export type FoldKeyframe = {
  id: string;
  label: string;
  /** Crease angles introduced *by this keyframe*, keyed by FOLD edge index. */
  creaseAnglesDeg: Record<number, number>;
  /**
   * Optional per-crease branch chosen by the source simulation. PackCAD stores
   * an unsigned UI angle for ambiguous flat hinges; this preserves the branch
   * observed during source playback without changing the authored angle shown
   * in the editor. Missing entries default to +1.
   */
  creaseBranchSigns?: Record<number, -1 | 1>;
  /** FOLD edge index -> index of the operation's foldingEdgeGroup that drives it.
   *  Lets the editor map a clicked crease back to the constraint it belongs to. */
  creaseEdgeGroup: Record<number, number>;
  /**
   * Faces held rigid while THIS keyframe folds (the reference's per-operation
   * `fixedFaceIDs`). e.g. milk_carton's top closure fixes the already-folded
   * body (6 faces) and folds only the lid against it. Empty -> fall back to the
   * model's global `fixedFaceIndex`.
   */
  fixedFaceIndices: number[];
  /** Extra individual vertices held rigid this keyframe (`fixedVertexIDs`). */
  fixedVertexIndices: number[];
  /** Match PackCAD's per-operation prior-target constraint policy. */
  enforcePriorConstraints: boolean;
};

export type FoldModel = {
  verticesCoords: number[][]; // 2D [x, y]
  /** Unit used by verticesCoords (PackCAD/FOLD `frame_unit`). */
  coordinateUnit: string;
  verticesUv: number[][]; // normalized [u, v] (may be empty)
  /** Per-vertex UUIDs (importer `verticesAdded`), index-aligned to verticesCoords.
   *  Lets the editor turn a clicked edge back into an `<uuidA>-<uuidB>` edge id. */
  verticesIDs: string[];
  /** Per-face UUIDs (importer `facesAdded`), index-aligned to facesVertices. */
  facesIDs: string[];
  edgesVertices: Array<[number, number]>;
  /**
   * Bézier control points for each edge, in the edge's v0 -> v1 direction.
   * PackCAD stores control-point indices after the two endpoint indices in
   * `edges_vertices`.  The solver only needs the endpoints, while the renderer
   * needs these coordinates to reproduce the authored curved cut boundary.
   */
  edgeControlPoints?: number[][][];
  edgesAssignment: string[];
  facesVertices: number[][]; // ordered vertex-index loop per face
  facesEdges: number[][];
  /** edge index -> the (1 or 2) faces touching it */
  edgeFaces: number[][];
  fixedFaceIndex: number;
  keyframes: FoldKeyframe[];
  /** Ordered 3D transforms from the pipeline that orient the sheet. */
  transforms: FoldTransform[];
  /** Thickness modifier (value in design units) + offset direction + rotation. */
  thickness: { value: number; direction: string; units: string; rotationDegrees: number } | null;
};

function vector3Or(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const vector: [number, number, number] = [Number(value[0]), Number(value[1]), Number(value[2])];
  return vector.every(Number.isFinite) ? vector : fallback;
}

function parseTransforms(design: PackCadDesign): FoldTransform[] {
  const transforms: FoldTransform[] = [];
  for (const op of design.operations) {
    if (!op.enabled) continue;
    if (op.type === "OPERATION_TRANSFORM_3D_ROTATE_AXIS_ANGLE") {
      const t = op as RotateAxisAngleOperation;
      transforms.push({
        kind: "rotateAxisAngle",
        origin: vector3Or(t.originPositionOrElement, [0, 0, 0]),
        axis: vector3Or(t.axisOrientationOrElement, [0, 1, 0]),
        angleDegrees: t.angleDegrees ?? 0,
      });
    } else if (op.type === "OPERATION_TRANSFORM_3D_TRANSLATE") {
      // The reference serializes a translate as from/to positions (the offset is
      // their difference), not a single `translation`/`offset` vector -- the old
      // field names never matched, so every translate silently no-op'd.
      // `*OrElement` fields can also be a UUID element reference; only treat
      // arrays as literal positions (an element ref falls back to no-op).
      const raw = op as unknown as { fromPositionOrElement?: unknown; toPositionOrElement?: unknown };
      const from = vector3Or(raw.fromPositionOrElement, [0, 0, 0]);
      const to = vector3Or(raw.toPositionOrElement, [0, 0, 0]);
      transforms.push({ kind: "translate", offset: [to[0] - from[0], to[1] - from[1], to[2] - from[2]] });
    } else if (op.type === "OPERATION_TRANSFORM_3D_ROTATE_VECTOR_TO_VECTOR") {
      // Reference fields: from/to *orientation* vectors, rotated about an origin
      // position (the old `fromVector`/`toVector` never matched -> no-op).
      const raw = op as unknown as {
        originPositionOrElement?: unknown;
        fromOrientationOrElement?: unknown;
        toOrientationOrElement?: unknown;
      };
      transforms.push({
        kind: "rotateVectorToVector",
        origin: vector3Or(raw.originPositionOrElement, [0, 0, 0]),
        from: vector3Or(raw.fromOrientationOrElement, [0, 0, 1]),
        to: vector3Or(raw.toOrientationOrElement, [0, 0, 1]),
      });
    }
  }
  return transforms;
}

function uuidPairFromEdgeId(edgeId: string): [string, string] | null {
  // edgeId is "<uuidA>-<uuidB>", each uuid being 5 hyphen-separated groups.
  const parts = edgeId.split("-");
  if (parts.length !== 10) return null;
  return [parts.slice(0, 5).join("-"), parts.slice(5, 10).join("-")];
}

/**
 * Build an ordered vertex loop from a face's edges using the FOLD
 * `faces_edges_orientation` flags (true = edge traversed v0->v1). This preserves
 * the importer's globally-consistent CCW winding, which is required for the
 * dihedral sign convention to match the reference's foldAngle3DRadians.
 */
function faceVertexLoopFromOrientation(
  faceEdges: number[],
  orientation: boolean[],
  edgesVertices: Array<[number, number]>,
): number[] {
  return faceEdges.map((ei, k) => {
    const [a, b] = edgesVertices[ei];
    return orientation[k] ? a : b;
  });
}

function normalizeEdge(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Build a FoldModel from a captured design. Returns null when the design has no
 * parsed FOLD geometry to render.
 */
export function buildFoldModel(design: PackCadDesign): FoldModel | null {
  // Prefer an embedded parsedFOLD (exact); otherwise reconstruct one from the
  // raw dieline SVG (svgFold) so dielines without a pre-computed pattern fold.
  const importOp = design.operations.find((op) => op.type === "OPERATION_IMPORT_SVG") as
    | { parsedFOLD?: ParsedFold; svgString?: string; preferredUnits?: string; filters?: ImportSvgFilter[]; verticesAdded?: string[]; facesAdded?: string[] }
    | undefined;
  const embedded = importOp?.parsedFOLD;
  const fold =
    embedded && embedded.vertices_coords.length > 0 && embedded.faces_edges.length > 0
      ? embedded
      : importOp?.svgString
        ? buildFoldFromSvg(importOp.svgString, importOp.filters ?? [])
        : undefined;
  if (!fold || fold.vertices_coords.length === 0 || fold.faces_edges.length === 0) return null;

  const verticesAdded = importOp?.verticesAdded ?? [];
  const facesAdded = importOp?.facesAdded ?? [];
  const vertexIndexByUuid = new Map<string, number>();
  verticesAdded.forEach((uuid, i) => vertexIndexByUuid.set(uuid, i));
  const faceIndexByUuid = new Map<string, number>();
  facesAdded.forEach((uuid, i) => faceIndexByUuid.set(uuid, i));

  const edgesVertices = fold.edges_vertices.map(([a, b]) => [a, b] as [number, number]);
  const edgeControlPoints = fold.edges_vertices.map((edge) =>
    edge.slice(2).flatMap((controlPointIndex) => {
      const point = fold.controlPoints_coords?.[controlPointIndex];
      return point && point.length >= 2 ? [[point[0], point[1]]] : [];
    }));
  const facesEdges = fold.faces_edges.map((edges) => edges.slice());
  // Build face vertex loops with a globally-consistent CCW winding: prefer the
  // importer's `faces_edges_orientation` (exact); otherwise reconstruct by edge
  // walk and orient consistently below. Consistent winding is what makes the
  // dihedral sign convention agree with the reference's foldAngle3DRadians.
  const orientation = fold.faces_edges_orientation;
  const hasOrientation = Array.isArray(orientation) && orientation.length === facesEdges.length;
  const facesVertices = facesEdges.map((edges, fi) =>
    hasOrientation && orientation![fi]?.length === edges.length
      ? faceVertexLoopFromOrientation(edges, orientation![fi], edgesVertices)
      : faceVertexLoop(edges, edgesVertices),
  );

  // edge index -> faces touching it
  const edgeFaces: number[][] = edgesVertices.map(() => []);
  facesEdges.forEach((edges, faceIndex) => {
    for (const ei of edges) edgeFaces[ei]?.push(faceIndex);
  });

  // Resolve the fixed reference face from OPERATION_FOLDING_SETUP.
  const setupOp = design.operations.find((op) => op.type === "OPERATION_FOLDING_SETUP") as
    | { fixedFaceID?: string }
    | undefined;
  let fixedFaceIndex = 0;
  if (setupOp?.fixedFaceID && faceIndexByUuid.has(setupOp.fixedFaceID)) {
    fixedFaceIndex = faceIndexByUuid.get(setupOp.fixedFaceID) as number;
  }

  // Fallback: if the importer's winding was unavailable, make the reconstructed
  // loops globally consistent so dihedral signs are still coherent.
  if (!hasOrientation) {
    orientFacesConsistently(
      { edgesVertices, facesEdges, facesVertices, edgeFaces },
      fixedFaceIndex,
    );
  }

  // Map every FOLD edge to a lookup so origami edge UUIDs resolve to indices.
  const edgeIndexByVertexPair = new Map<string, number>();
  edgesVertices.forEach(([a, b], i) => edgeIndexByVertexPair.set(normalizeEdge(a, b), i));

  const origamiOps = design.operations.filter(
    (op): op is OrigamiSimulationOperation =>
      op.type === "OPERATION_ORIGAMI_SIMULATION" && op.enabled,
  );

  const keyframes: FoldKeyframe[] = origamiOps.map((op) => {
    const creaseAnglesDeg: Record<number, number> = {};
    const creaseEdgeGroup: Record<number, number> = {};
    op.foldingEdgeGroups.forEach((group, groupIndex) => {
      if (!group.enabled) return;
      for (const edgeId of group.edgeIDs) {
        const pair = uuidPairFromEdgeId(edgeId);
        if (!pair) continue;
        const ia = vertexIndexByUuid.get(pair[0]);
        const ib = vertexIndexByUuid.get(pair[1]);
        if (ia === undefined || ib === undefined) continue;
        const edgeIndex = edgeIndexByVertexPair.get(normalizeEdge(ia, ib));
        if (edgeIndex === undefined) continue;
        creaseAnglesDeg[edgeIndex] = group.targetAngleDegrees;
        creaseEdgeGroup[edgeIndex] = groupIndex;
      }
    });
    // Per-keyframe anchors: resolve the operation's fixedFaceIDs / fixedVertexIDs
    // (UUIDs) to indices. These hold part of the model rigid while this keyframe
    // folds (the reference solves each keyframe with its own fixed set).
    const fixedFaceIndices: number[] = [];
    for (const uuid of op.fixedFaceIDs ?? []) {
      const fi = faceIndexByUuid.get(uuid);
      if (fi !== undefined) fixedFaceIndices.push(fi);
    }
    const fixedVertexIndices: number[] = [];
    for (const uuid of op.fixedVertexIDs ?? []) {
      const vi = vertexIndexByUuid.get(uuid);
      if (vi !== undefined) fixedVertexIndices.push(vi);
    }
    return {
      id: op.id,
      label: op.name || "Folding Keyframe",
      creaseAnglesDeg,
      creaseEdgeGroup,
      fixedFaceIndices,
      fixedVertexIndices,
      enforcePriorConstraints: op.enforcePriorConstraints ?? false,
    };
  });

  return {
    verticesCoords: fold.vertices_coords.map((v) => v.slice()),
    coordinateUnit: fold.frame_unit ?? importOp?.preferredUnits ?? design.units,
    verticesUv: (fold.vertices_uv ?? []).map((v) => v.slice()),
    verticesIDs: verticesAdded.slice(),
    facesIDs: facesAdded.slice(),
    edgesVertices,
    edgeControlPoints,
    edgesAssignment: fold.edges_assignment.slice(),
    facesVertices,
    facesEdges,
    edgeFaces,
    fixedFaceIndex,
    keyframes,
    transforms: parseTransforms(design),
    thickness: design.modifiers.OPERATION_THICKNESS
      ? {
          value: design.modifiers.OPERATION_THICKNESS.thickness,
          direction: design.modifiers.OPERATION_THICKNESS.thicknessOffsetDirection,
          units: design.units,
          rotationDegrees: design.modifiers.OPERATION_THICKNESS.materialRotationDegrees ?? 0,
        }
      : null,
  };
}

/** Total number of resolved crease folds across all keyframes (diagnostics). */
export function totalResolvedCreases(model: FoldModel): number {
  return model.keyframes.reduce((sum, kf) => sum + Object.keys(kf.creaseAnglesDeg).length, 0);
}

/**
 * Expand a keyframe angle map with zero-angle constraints for every currently
 * inactive interior crease. PackCAD carries panels through inactive creases as
 * coplanar branches until those creases receive their own target angle; without
 * these zero targets, downstream panels can remain flat instead of riding up
 * with the wall that is folding in the current keyframe.
 */
export function withInactiveCreaseCarryAngles(
  model: FoldModel,
  creaseAnglesDeg: Record<number, number>,
): Record<number, number> {
  const expanded: Record<number, number> = {};
  model.edgesVertices.forEach((_, edgeIndex) => {
    const isInteriorCrease = (model.edgeFaces[edgeIndex]?.length ?? 0) >= 2;
    const assignment = model.edgesAssignment[edgeIndex];
    if (isInteriorCrease && assignment !== "B") expanded[edgeIndex] = 0;
  });
  for (const [edgeIndex, angle] of Object.entries(creaseAnglesDeg)) {
    expanded[Number(edgeIndex)] = angle;
  }
  return expanded;
}
