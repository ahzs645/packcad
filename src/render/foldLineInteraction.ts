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
