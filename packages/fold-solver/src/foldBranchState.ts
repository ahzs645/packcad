// Per-edge fold-angle branch state, ported from the reference app.
//
// The reference does NOT measure fold angles on the (-180, 180] principal
// branch. `PEdge.foldAngle3DRadians` measures the wrapped angle from the two
// half-face normals and then unwraps it through a sticky per-edge sign:
//
//   let a = foldAngle3DRadiansFromNormals(n1, n2, edgeDirection);
//   if (preferred === 1  && a < 0) a += 2*PI;   // -> ( PI,  2*PI)
//   if (preferred === -1 && a > 0) a -= 2*PI;   // -> (-2*PI, -PI)
//
// `preferredFoldAngle3DSign` is a hysteresis latch maintained by
// `CreaseDihedralConstraint.updateCurrentValue`:
//
//   preferred = Math.abs(currentValue) < 1.5 ? undefined : Math.sign(currentValue)
//
// so a crease latches its side once it folds past ~85.94 degrees and releases
// the latch when it relaxes back below that. Three properties matter:
//
//   1. Angles may legitimately leave (-180, 180]; the reference's `isHardStopped`
//      test (|angle| > PI) exists precisely to detect that.
//   2. The latch is maintained for EVERY manifold edge on every solver cycle,
//      not only the edges a keyframe drives -- `ConstraintManager.resetConstraints`
//      builds a `CreaseDihedralConstraint` per pEdge pair, and the inactive ones
//      (stiffness 0, zero energy) exist only to carry this state.
//   3. It survives across folding stages: `PEdge.copyGeometry` copies
//      `__preferredFoldAngle3DSign` when one operation's ending graph becomes
//      the next operation's starting graph.
//
// Without it, a crease that folds through flat-back reads as +179 on one cycle
// and -179 on the next, and every "hold this component where it is" constraint
// derived from that reading mirrors the panel.

import { triangulateFaceDelaunay } from "./faceTriangulation";
import type { FoldModel } from "@packcad/format";

const TWO_PI = Math.PI * 2;
/** `Math.abs(currentValue) < 1.5` in the reference; ~85.94 degrees. */
const BRANCH_LATCH_RADIANS = 1.5;

/** FOLD edge index -> latched branch sign, mirroring `preferredFoldAngle3DSign`.
 *  An absent entry is the reference's `undefined` (no latch, no unwrapping). */
export type FoldBranchSigns = Record<number, -1 | 1>;

/** One dihedral hinge: edge (a,b) with the apex of the triangle on each side.
 *  `w1` belongs to the face whose loop traverses a->b, matching the reference's
 *  halfEdge1/halfEdge2 pairing. */
export type FoldHinge = {
  edge: number;
  a: number;
  b: number;
  w1: number;
  w2: number;
};

/** +1 if loop traverses a->b, -1 if b->a, 0 otherwise. */
export function edgeTraversal(loop: number[], a: number, b: number): number {
  for (let index = 0; index < loop.length; index += 1) {
    const u = loop[index];
    const v = loop[(index + 1) % loop.length];
    if (u === a && v === b) return 1;
    if (u === b && v === a) return -1;
  }
  return 0;
}

/**
 * Every two-sided (manifold) edge of the model, with a stable orientation. This
 * is the set the reference builds crease dihedral constraints for, so it is
 * also the set whose branch signs are latched.
 */
export function manifoldHinges(model: FoldModel): FoldHinge[] {
  const triangles = model.facesVertices.map((loop) => triangulateFaceDelaunay(loop, model.verticesCoords));
  const hinges: FoldHinge[] = [];
  model.edgeFaces.forEach((faces, edge) => {
    if (faces.length !== 2) return;
    const [a, b] = model.edgesVertices[edge];
    let [first, second] = faces;
    if (
      edgeTraversal(model.facesVertices[first], a, b) !== 1
      && edgeTraversal(model.facesVertices[second], a, b) === 1
    ) {
      [first, second] = [second, first];
    }
    const firstTriangle = triangles[first].find((t) => t.includes(a) && t.includes(b));
    const secondTriangle = triangles[second].find((t) => t.includes(a) && t.includes(b));
    if (!firstTriangle || !secondTriangle) return;
    const w1 = firstTriangle.find((v) => v !== a && v !== b);
    const w2 = secondTriangle.find((v) => v !== a && v !== b);
    if (w1 === undefined || w2 === undefined) return;
    hinges.push({ edge, a, b, w1, w2 });
  });
  return hinges;
}

/** `PEdge.foldAngle3DRadians`: lift a wrapped angle onto the latched branch. */
export function unwrapFoldAngle(wrappedRadians: number, sign: -1 | 1 | undefined): number {
  if (sign === 1 && wrappedRadians < 0) return wrappedRadians + TWO_PI;
  if (sign === -1 && wrappedRadians > 0) return wrappedRadians - TWO_PI;
  return wrappedRadians;
}

/** `CreaseDihedralConstraint.updateCurrentValue`: the hysteresis latch itself.
 *  Takes the already-unwrapped current value, as the reference does. */
export function latchedBranchSign(unwrappedRadians: number): -1 | 1 | undefined {
  if (Math.abs(unwrappedRadians) < BRANCH_LATCH_RADIANS) return undefined;
  return unwrappedRadians < 0 ? -1 : 1;
}

/** Apply the latch for one edge, returning the next state for that entry. */
export function updateBranchSign(
  signs: FoldBranchSigns,
  edge: number,
  wrappedRadians: number,
): void {
  const next = latchedBranchSign(unwrapFoldAngle(wrappedRadians, signs[edge]));
  if (next === undefined) delete signs[edge];
  else signs[edge] = next;
}
