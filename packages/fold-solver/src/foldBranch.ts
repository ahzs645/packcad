import type { FoldModel } from "@packcad/format";
import { foldFaces, type Vec3 } from "./foldSolver";

const EPS = 1e-6;

export type DevelopedFacePositions = Map<number, Map<number, Vec3>>;

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm3(v: Vec3): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < EPS) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function buildDevelopedFacePositions(
  model: FoldModel,
  creaseAnglesDeg: Record<number, number>,
): DevelopedFacePositions {
  const result: DevelopedFacePositions = new Map();
  for (const face of foldFaces(model, creaseAnglesDeg)) {
    const vertices = new Map<number, Vec3>();
    const loop = model.facesVertices[face.faceIndex];
    loop.forEach((vertexIndex, localIndex) => {
      const p = face.positions[localIndex];
      vertices.set(vertexIndex, [p[0], p[1], p[2]]);
    });
    result.set(face.faceIndex, vertices);
  }
  return result;
}

function developedPoint(
  developed: DevelopedFacePositions,
  faceIndex: number,
  vertexIndex: number,
): Vec3 | null {
  return developed.get(faceIndex)?.get(vertexIndex) ?? null;
}

export function developedNormal(
  developed: DevelopedFacePositions,
  faceIndex: number,
  a: number,
  b: number,
  c: number,
): Vec3 | null {
  const pa = developedPoint(developed, faceIndex, a);
  const pb = developedPoint(developed, faceIndex, b);
  const pc = developedPoint(developed, faceIndex, c);
  if (!pa || !pb || !pc) return null;
  return norm3(cross3(sub3(pb, pa), sub3(pc, pa)));
}

export function developedEdgeDirection(
  developed: DevelopedFacePositions,
  faceIndex: number,
  a: number,
  b: number,
): Vec3 | null {
  const pa = developedPoint(developed, faceIndex, a);
  const pb = developedPoint(developed, faceIndex, b);
  if (!pa || !pb) return null;
  return norm3(sub3(pb, pa));
}

export function signedTargetRadiansFromDeveloped(
  developedAngleRadians: number,
  targetAngleDegrees: number,
): number {
  const fallbackSign = Math.sign(targetAngleDegrees) || 1;
  const branchSign = Math.abs(developedAngleRadians) > EPS
    ? Math.sign(developedAngleRadians)
    : fallbackSign;
  return branchSign * Math.abs(targetAngleDegrees) * Math.PI / 180;
}
