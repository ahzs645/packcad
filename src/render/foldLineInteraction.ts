import type { FoldModel } from "@packcad/format";

export type FoldLineKind = "boundary" | "crease" | "locked";

function activeKeyframe(model: FoldModel, foldStepIndex: number) {
  return foldStepIndex > 0 ? model.keyframes[foldStepIndex - 1] : undefined;
}

export function activeLockedFaceIndices(model: FoldModel, foldStepIndex: number): Set<number> {
  const faces = new Set<number>([model.fixedFaceIndex]);
  for (const faceIndex of activeKeyframe(model, foldStepIndex)?.fixedFaceIndices ?? []) {
    faces.add(faceIndex);
  }
  return faces;
}

export function isFoldEdgeLocked(model: FoldModel, edgeIndex: number, foldStepIndex: number): boolean {
  const lockedFaces = activeLockedFaceIndices(model, foldStepIndex);
  if ((model.edgeFaces[edgeIndex] ?? []).some((faceIndex) => lockedFaces.has(faceIndex))) return true;

  const fixedVertices = activeKeyframe(model, foldStepIndex)?.fixedVertexIndices ?? [];
  if (fixedVertices.length === 0) return false;
  const [a, b] = model.edgesVertices[edgeIndex] ?? [];
  return fixedVertices.includes(a) && fixedVertices.includes(b);
}

export function foldLineKind(model: FoldModel, edgeIndex: number, foldStepIndex: number): FoldLineKind {
  if (isFoldEdgeLocked(model, edgeIndex, foldStepIndex)) return "locked";
  const assignment = model.edgesAssignment[edgeIndex] ?? "B";
  return assignment === "B" || (model.edgeFaces[edgeIndex]?.length ?? 0) < 2 ? "boundary" : "crease";
}

/** Map Atelier's LineSegments-local segment index back to the FOLD edge index. */
export function sourceEdgeIndexFromPickSegment(
  segmentEdgeIndex: ArrayLike<number>,
  pickSegmentIndex: number | undefined,
): number | null {
  if (
    pickSegmentIndex === undefined
    || !Number.isInteger(pickSegmentIndex)
    || pickSegmentIndex < 0
  ) return null;
  const edgeIndex = segmentEdgeIndex[pickSegmentIndex];
  return edgeIndex === undefined || edgeIndex < 0 ? null : edgeIndex;
}

/** Boundaries are visible pick targets but cannot receive an origami angle. */
export function isSelectableCrease(model: FoldModel, edgeIndex: number): boolean {
  return Boolean(
    model.edgesVertices[edgeIndex]
    && model.edgesAssignment[edgeIndex] !== "B"
    && (model.edgeFaces[edgeIndex]?.length ?? 0) >= 2,
  );
}

/** Recreate the `<uuidA>-<uuidB>` identifier consumed by pipeline.setCreaseAngle. */
export function foldEdgeId(model: FoldModel, edgeIndex: number): string | null {
  const pair = model.edgesVertices[edgeIndex];
  if (!pair) return null;
  const first = model.verticesIDs[pair[0]];
  const second = model.verticesIDs[pair[1]];
  return first && second ? `${first}-${second}` : null;
}
