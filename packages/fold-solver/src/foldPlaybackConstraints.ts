import { triangulateFace } from "@atelier/geometry";
import type { FoldKeyframe, FoldModel } from "@packcad/format";
import type { Vec3 } from "./foldSolver";

const PRIOR_ANGLE_TOLERANCE_RADIANS = 0.01;

type FaceGraphLink = { face: number; edge: number };

function edgeTraversal(loop: number[], a: number, b: number): number {
  for (let index = 0; index < loop.length; index += 1) {
    const u = loop[index];
    const v = loop[(index + 1) % loop.length];
    if (u === a && v === b) return 1;
    if (u === b && v === a) return -1;
  }
  return 0;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function triangleNormal(positions: Vec3[], a: number, b: number, c: number): Vec3 {
  return normalize(cross(subtract(positions[b], positions[a]), subtract(positions[c], positions[a])));
}

/**
 * Port of PackCAD's findCreaseEdgeBiconnectedComponents. Nodes are faces and
 * graph edges are physical two-sided FOLD edges. Each returned block may move
 * together without an explicit constraint leaking in from another block.
 */
export function findCreaseEdgeBiconnectedComponents(model: FoldModel): number[][] {
  const adjacency: FaceGraphLink[][] = model.facesVertices.map(() => []);
  model.edgeFaces.forEach((faces, edge) => {
    if (faces.length !== 2) return;
    const [a, b] = faces;
    adjacency[a]?.push({ face: b, edge });
    adjacency[b]?.push({ face: a, edge });
  });

  const discovery = new Int32Array(adjacency.length);
  discovery.fill(-1);
  const low = new Int32Array(adjacency.length);
  let nextDiscovery = 0;
  const edgeStack: number[] = [];
  const components: number[][] = [];

  const visit = (face: number, parentEdge: number): void => {
    discovery[face] = nextDiscovery;
    low[face] = nextDiscovery;
    nextDiscovery += 1;

    for (const link of adjacency[face]) {
      if (link.edge === parentEdge) continue;
      if (discovery[link.face] < 0) {
        edgeStack.push(link.edge);
        visit(link.face, link.edge);
        low[face] = Math.min(low[face], low[link.face]);
        if (low[link.face] >= discovery[face]) {
          const component: number[] = [];
          const seen = new Set<number>();
          while (edgeStack.length > 0) {
            const edge = edgeStack.pop() as number;
            if (!seen.has(edge)) {
              seen.add(edge);
              component.push(edge);
            }
            if (edge === link.edge) break;
          }
          if (component.length > 0) components.push(component);
        }
      } else if (discovery[link.face] < discovery[face]) {
        low[face] = Math.min(low[face], discovery[link.face]);
        edgeStack.push(link.edge);
      }
    }
  };

  for (let face = 0; face < adjacency.length; face += 1) {
    if (discovery[face] < 0 && adjacency[face].length > 0) visit(face, -1);
  }
  return components;
}

/** Signed current dihedral angles in the same face/edge orientation as the solver. */
export function measureCreaseAnglesDegrees(
  model: FoldModel,
  positions: Vec3[],
): Record<number, number> {
  const triangles = model.facesVertices.map((loop) => triangulateFace(loop, model.verticesCoords));
  const measured: Record<number, number> = {};

  model.edgeFaces.forEach((faces, edge) => {
    if (faces.length !== 2) return;
    const [a, b] = model.edgesVertices[edge];
    let [firstFace, secondFace] = faces;
    if (
      edgeTraversal(model.facesVertices[firstFace], a, b) !== 1 &&
      edgeTraversal(model.facesVertices[secondFace], a, b) === 1
    ) {
      [firstFace, secondFace] = [secondFace, firstFace];
    }
    const firstTriangle = triangles[firstFace].find((triangle) => triangle.includes(a) && triangle.includes(b));
    const secondTriangle = triangles[secondFace].find((triangle) => triangle.includes(a) && triangle.includes(b));
    if (!firstTriangle || !secondTriangle) return;
    const firstApex = firstTriangle.find((vertex) => vertex !== a && vertex !== b);
    const secondApex = secondTriangle.find((vertex) => vertex !== a && vertex !== b);
    if (firstApex === undefined || secondApex === undefined) return;
    const firstNormal = triangleNormal(positions, a, b, firstApex);
    const secondNormal = triangleNormal(positions, b, a, secondApex);
    const edgeDirection = normalize(subtract(positions[b], positions[a]));
    measured[edge] = Math.atan2(
      dot(cross(firstNormal, secondNormal), edgeDirection),
      dot(firstNormal, secondNormal),
    ) * 180 / Math.PI;
  });
  return measured;
}

function isNearPrior(currentDegrees: number, priorDegrees: number): boolean {
  return Math.abs((currentDegrees - priorDegrees) * Math.PI / 180) <= PRIOR_ANGLE_TOLERANCE_RADIANS;
}

/**
 * Reproduce the source player's staged result: explicit targets win and folds
 * reached by earlier stages stay at their attained target. The source's
 * iterative player preserves those angles through its continuous solve even
 * when the UI's "enforce prior constraints" switch is off. Our per-stage
 * Newton solve otherwise re-minimises the entire connected crease block and
 * visibly unfolds the earlier walls between keyframes.
 */
export function sourceStageConstraintAngles(
  model: FoldModel,
  keyframe: FoldKeyframe,
  positions: Vec3[],
  priorTargets: Record<number, number>,
): Record<number, number> {
  const measured = measureCreaseAnglesDegrees(model, positions);
  const merged: Record<number, number> = {};

  for (const [edgeKey, prior] of Object.entries(priorTargets)) {
    const edge = Number(edgeKey);
    if (measured[edge] !== undefined) merged[edge] = prior;
  }
  Object.assign(merged, keyframe.creaseAnglesDeg);

  for (const component of findCreaseEdgeBiconnectedComponents(model)) {
    if (component.some((edge) => edge in merged)) continue;
    for (const edge of component) {
      const current = measured[edge];
      if (current === undefined) continue;
      const prior = priorTargets[edge];
      merged[edge] = prior !== undefined && isNearPrior(current, prior) ? prior : current;
    }
  }
  return merged;
}

function faceArea(model: FoldModel, faceIndex: number): number {
  const loop = model.facesVertices[faceIndex] ?? [];
  let twiceArea = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const a = model.verticesCoords[loop[index]];
    const b = model.verticesCoords[loop[(index + 1) % loop.length]];
    if (!a || !b) continue;
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Reproduce the source player's quasi-static parent choice. PackCAD keeps the
 * larger panel beside each driven crease on its attained pose and moves the
 * smaller flap. A position-only Newton solve otherwise has an equally valid
 * branch where the flap stays put and the entire lid moves (the old MailerBox
 * keyframe-5 behavior). Explicit locked panels remain authoritative.
 */
export function sourceStageFixedFaceIndices(
  model: FoldModel,
  keyframe: FoldKeyframe,
): number[] {
  const fixed = new Set(keyframe.fixedFaceIndices);
  for (const edgeKey of Object.keys(keyframe.creaseAnglesDeg)) {
    const faces = model.edgeFaces[Number(edgeKey)] ?? [];
    if (faces.length !== 2) continue;
    if (faces.some((face) => fixed.has(face))) continue;
    const [first, second] = faces;
    fixed.add(faceArea(model, first) >= faceArea(model, second) ? first : second);
  }
  return [...fixed];
}

export function appendPriorTargets(
  priorTargets: Record<number, number>,
  keyframe: FoldKeyframe,
): Record<number, number> {
  return { ...priorTargets, ...keyframe.creaseAnglesDeg };
}
