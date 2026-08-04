import type { FoldKeyframe, FoldModel } from "@packcad/format";
import {
  manifoldHinges,
  faceLoopNormal,
  unwrapFoldAngle,
  type FoldBranchSigns,
} from "./foldBranchState";
import type { Vec3 } from "./foldSolver";

const PRIOR_ANGLE_TOLERANCE_RADIANS = 0.01;

type FaceGraphLink = { face: number; edge: number };

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

/**
 * Signed current dihedral angles in the same face/edge orientation as the
 * solver, lifted onto each edge's latched fold branch. This is the reference's
 * `PEdge.foldAngle3DDegrees`, so values may fall outside (-180, 180] for creases
 * that have folded past flat-back -- which is exactly what keeps a "hold this
 * component where it is" constraint from mirroring the panel it holds.
 */
export function measureCreaseAnglesDegrees(
  model: FoldModel,
  positions: Vec3[],
  branchSigns: FoldBranchSigns = {},
): Record<number, number> {
  const measured: Record<number, number> = {};
  for (const hinge of manifoldHinges(model)) {
    const { edge, a, b, f1, f2 } = hinge;
    // `PEdge.foldAngle3DRadians` -- the two adjacent faces' normals, not the
    // apex triangles'. This has to agree with the solver's crease measure,
    // because the implicit "hold at the incoming angle" targets are read here.
    const firstNormal = faceLoopNormal(positions, model.facesVertices[f1]);
    const secondNormal = faceLoopNormal(positions, model.facesVertices[f2]);
    const edgeDirection = normalize(subtract(positions[b], positions[a]));
    const wrapped = Math.atan2(
      dot(cross(firstNormal, secondNormal), edgeDirection),
      dot(firstNormal, secondNormal),
    );
    measured[edge] = unwrapFoldAngle(wrapped, branchSigns[edge]) * 180 / Math.PI;
  }
  return measured;
}

function isNearPrior(currentDegrees: number, priorDegrees: number): boolean {
  return Math.abs((currentDegrees - priorDegrees) * Math.PI / 180) <= PRIOR_ANGLE_TOLERANCE_RADIANS;
}

/**
 * A keyframe's authored crease targets. The reference feeds
 * `foldingEdgeGroups[].targetAngleDegrees` straight to
 * `CreaseDihedralConstraint.activateConstraint`, so the authored number is the
 * target -- the branch is decided by the solver's per-edge latch, not here.
 */
export function resolvedKeyframeAngles(
  keyframe: FoldKeyframe,
): Record<number, number> {
  return { ...keyframe.creaseAnglesDeg };
}

/** Reproduce OrigamiSimulation.__updateMergedConstraints from the source app.
 * Explicit targets always win. Prior targets are retained only when the stage
 * asks to enforce them and the incoming geometry is already within tolerance.
 * Crease biconnected components without an explicit target are held at their
 * incoming angle so unrelated parts of the package do not drift.
 */
export function sourceStageConstraintAngles(
  model: FoldModel,
  keyframe: FoldKeyframe,
  positions: Vec3[],
  priorTargets: Record<number, number>,
  branchSigns: FoldBranchSigns = {},
): Record<number, number> {
  const measured = measureCreaseAnglesDegrees(model, positions, branchSigns);
  const merged: Record<number, number> = {};

  if (keyframe.enforcePriorConstraints) {
    for (const [edgeKey, prior] of Object.entries(priorTargets)) {
      const edge = Number(edgeKey);
      const current = measured[edge];
      if (current !== undefined && isNearPrior(current, prior)) merged[edge] = prior;
    }
  }
  Object.assign(merged, resolvedKeyframeAngles(keyframe));

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

export function appendPriorTargets(
  priorTargets: Record<number, number>,
  keyframe: FoldKeyframe,
): Record<number, number> {
  return { ...priorTargets, ...resolvedKeyframeAngles(keyframe) };
}
