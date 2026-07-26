// Global constrained rigid-origami solver (Gauss-Newton / Levenberg-Marquardt).
//
// Clean-room port of the reference's energy-minimization solve (OrigamiSimulation
// + ConstraintManager). The
// reference works on a TRIANGULATED mesh with four constraint families:
//   1. edge-length on every real edge        (isometry)
//   2. edge-length on triangulation diagonals (isometry of the triangulation)
//   3. facet dihedrals held flat              (each polygon facet stays planar)
//   4. crease dihedrals driven to target      (the actual fold angles)
// minimized as  E(x) = 1/2 Σ w_c · r_c(x)^2  over welded vertex positions, fixed
// face pinned, via the damped normal equations (JᵀWJ + λI) Δ = -Jᵀ W r solved by
// dense Cholesky with a backtracking line search.
//
// Branch selection (the dominant source of shape divergence in the old version)
// is handled the way the reference does it: the fold is *seeded* by the signed
// spanning-tree development (foldWelded), and every crease dihedral target takes
// its SIGN from that seed's measured dihedral. Gauss-Newton then refines toward
// the seed's branch instead of a globally-voted sign that can flip flaps to the
// wrong side.
//
// Framework-free + node-verifiable (small dense systems: 3·#verts unknowns).

import { withInactiveCreaseCarryAngles, type FoldModel } from "@packcad/format";
import {
  buildDevelopedFacePositions,
  cross3,
  developedEdgeDirection,
  developedNormal,
  dot3,
  signedTargetRadiansFromDeveloped,
} from "./foldBranch";
import { foldFaces, nonRigidMessage, type SolveStatus, type Vec3 } from "./foldSolver";
import { foldNewton } from "./foldNewtonSolver";
import { appendPriorTargets, sourceStageConstraintAngles } from "./foldPlaybackConstraints";

type V3 = Vec3;
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Unit normal of triangle (a,b,c) by right-hand rule of that winding. */
function triNormal(P: V3[], a: number, b: number, c: number): V3 {
  return norm(cross(sub(P[b], P[a]), sub(P[c], P[a])));
}

type EdgeC = { kind: "edge"; i: number; j: number; rest: number; w: number };
// Dihedral about hinge (a,b) between two triangles, signed by the hinge
// direction (b-a). `target` is in radians; flat = 0. Matches the reference's
// foldAngle3DRadiansFromNormals = acos(nA·nB) signed by sign((nA×nB)·ê).
type DihedralC = {
  kind: "dihedral";
  a: number;
  b: number;
  triA: [number, number, number];
  triB: [number, number, number];
  target: number;
  w: number;
  stencil: number[];
  edge: number; // -1 for facet (internal) dihedrals
};
type Constraint = EdgeC | DihedralC;

function dihedralAngle(P: V3[], c: DihedralC): number {
  const nA = triNormal(P, c.triA[0], c.triA[1], c.triA[2]);
  const nB = triNormal(P, c.triB[0], c.triB[1], c.triB[2]);
  const e = norm(sub(P[c.b], P[c.a]));
  return Math.atan2(dot(cross(nA, nB), e), dot(nA, nB));
}

/** Fan triangulation of an ordered face loop (loop[0] as the fan apex). */
function fanTriangles(loop: number[]): Array<[number, number, number]> {
  const tris: Array<[number, number, number]> = [];
  for (let i = 1; i < loop.length - 1; i += 1) tris.push([loop[0], loop[i], loop[i + 1]]);
  return tris;
}

/** The fan triangle of `loop` that contains both vertices u and v, or null. */
function triangleWithEdge(loop: number[], u: number, v: number): [number, number, number] | null {
  for (const t of fanTriangles(loop)) {
    if (t.includes(u) && t.includes(v)) return t;
  }
  return null;
}

export type ConstrainedFold = {
  positions: V3[];
  iterations: number;
  maxEdgeError: number; // relative
  maxAngleErrorDeg: number;
  converged: boolean;
};

// Dense Cholesky solve of SPD A x = b (A is n×n row-major). Returns null if not PD.
function choleskySolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = A[i][j];
      for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) return null;
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let s = b[i];
    for (let k = 0; k < i; k += 1) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i];
    for (let k = i + 1; k < n; k += 1) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * Build the reference's constraint set for a model + fold seed: isometry bars
 * (real edges + triangulation diagonals), facet dihedrals (each polygon facet
 * held flat), and crease dihedrals whose targets take their sign from the seed
 * (branch selection). Returns the constraints plus the crease subset (for
 * reporting).
 */
function scaleAngles(angles: Record<number, number>, factor: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(angles)) out[Number(k)] = v * factor;
  return out;
}

/**
 * Welded seed from the rigid spanning-tree development (foldFaces): each vertex
 * takes its position from the BFS-earliest face containing it. This is the
 * reference's developmentTransform seeding -- it folds every tree crease to its
 * exact (signed) target so the seed is in the data's branch; cyclic loops are
 * left with small gaps for Gauss-Newton to close.
 */
function developSeed(model: FoldModel, anglesDeg: Record<number, number>): Vec3[] {
  const faces = foldFaces(model, anglesDeg);
  const byIndex = new Map(faces.map((f) => [f.faceIndex, f]));
  const positions: Vec3[] = model.verticesCoords.map((v) => [v[0], v[1], 0]);
  const assigned = new Array<boolean>(positions.length).fill(false);
  const order: number[] = [];
  const seen = new Array<boolean>(model.facesVertices.length).fill(false);
  const queue = [model.fixedFaceIndex];
  seen[model.fixedFaceIndex] = true;
  while (queue.length > 0) {
    const f = queue.shift() as number;
    order.push(f);
    for (const ei of model.facesEdges[f]) for (const nb of model.edgeFaces[ei]) {
      if (!seen[nb]) {
        seen[nb] = true;
        queue.push(nb);
      }
    }
  }
  for (const fi of order) {
    const face = byIndex.get(fi);
    if (!face) continue;
    model.facesVertices[fi].forEach((vi, k) => {
      if (assigned[vi]) return;
      positions[vi] = [face.positions[k][0], face.positions[k][1], face.positions[k][2]];
      assigned[vi] = true;
    });
  }
  return positions;
}

function buildConstraints(
  model: FoldModel,
  creaseAnglesDeg: Record<number, number>,
  weights: { edge: number; facet: number; dihedral: number },
): { constraints: Constraint[]; creases: DihedralC[] } {
  const flat = (vi: number): V3 => [model.verticesCoords[vi][0], model.verticesCoords[vi][1], 0];
  const flatDist = (a: number, b: number) => len(sub(flat(a), flat(b)));
  const developed = buildDevelopedFacePositions(model, creaseAnglesDeg);

  const constraints: Constraint[] = [];

  // (1+2) Isometry: real edges + fan diagonals (dedup by vertex pair).
  const seenEdge = new Set<string>();
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenEdge.has(k)) return;
    seenEdge.add(k);
    constraints.push({ kind: "edge", i: a, j: b, rest: flatDist(a, b), w: weights.edge });
  };
  for (const [a, b] of model.edgesVertices) addEdge(a, b);
  for (const loop of model.facesVertices) for (let i = 2; i < loop.length - 1; i += 1) addEdge(loop[0], loop[i]);

  // (3) Facet dihedrals: hold each internal triangulation diagonal coplanar so
  // a polygon facet stays planar (target 0). Without these a quad+ facet can
  // fold about its own diagonal -- the reference's __facetDihedralConstraints.
  for (const loop of model.facesVertices) {
    const tris = fanTriangles(loop);
    for (let i = 1; i < tris.length; i += 1) {
      const triA = tris[i - 1];
      const triB = tris[i];
      const a = loop[0];
      const b = loop[i + 1]; // shared diagonal is (loop[0], loop[i+1])
      const stencil = Array.from(new Set([...triA, ...triB]));
      constraints.push({ kind: "dihedral", a, b, triA, triB, target: 0, w: weights.facet, stencil, edge: -1 });
    }
  }

  // (4) Crease dihedrals: real folded edges driven to their target angle, with
  // the SIGN locked to the seed's measured dihedral (branch selection).
  const creases: DihedralC[] = [];
  for (const key of Object.keys(creaseAnglesDeg)) {
    const ei = Number(key);
    const target = creaseAnglesDeg[ei];
    const faces = model.edgeFaces[ei];
    if (!faces || faces.length < 2) continue;
    const [a, b] = model.edgesVertices[ei];
    // Order the faces by the half-edge convention (faceA traverses a->b) so the
    // measured dihedral sign matches the reference's foldAngle3DRadiansFromNormals.
    let faceA = faces[0];
    let faceB = faces[1];
    let loopA = model.facesVertices[faceA];
    let loopB = model.facesVertices[faceB];
    if (edgeTraversal(loopA, a, b) !== 1 && edgeTraversal(loopB, a, b) === 1) {
      [faceA, faceB] = [faceB, faceA];
      [loopA, loopB] = [loopB, loopA];
    }
    const triA = triangleWithEdge(loopA, a, b);
    const triB = triangleWithEdge(loopB, a, b);
    if (!triA || !triB) continue;
    const stencil = Array.from(new Set([...triA, ...triB]));
    const seedNormalA = developedNormal(developed, faceA, triA[0], triA[1], triA[2]);
    const seedNormalB = developedNormal(developed, faceB, triB[0], triB[1], triB[2]);
    const seedEdge = developedEdgeDirection(developed, faceA, a, b);
    const seedAngle = seedNormalA && seedNormalB && seedEdge
      ? Math.atan2(dot3(cross3(seedNormalA, seedNormalB), seedEdge), dot3(seedNormalA, seedNormalB))
      : 0;
    const c: DihedralC = {
      kind: "dihedral",
      a,
      b,
      triA,
      triB,
      target: signedTargetRadiansFromDeveloped(seedAngle, target),
      w: weights.dihedral,
      stencil,
      edge: ei,
    };
    creases.push(c);
    constraints.push(c);
  }

  return { constraints, creases };
}

/** +1 if loop traverses a->b in order, -1 if b->a, 0 if not adjacent. */
function edgeTraversal(loop: number[], a: number, b: number): number {
  for (let i = 0; i < loop.length; i += 1) {
    const u = loop[i];
    const v = loop[(i + 1) % loop.length];
    if (u === a && v === b) return 1;
    if (u === b && v === a) return -1;
  }
  return 0;
}

/**
 * Evaluate how well an arbitrary fold (e.g. the reference's) satisfies this
 * model's constraints: max relative edge error + max crease-angle error (deg).
 * Used to distinguish "my solver found a different valid branch" (reference
 * satisfies my constraints) from "my constraints differ from the reference's".
 */
export function evaluateFold(
  model: FoldModel,
  creaseAnglesDeg: Record<number, number>,
  positions: V3[],
): { maxEdgeError: number; maxAngleErrorDeg: number } {
  const flat = (vi: number): V3 => [model.verticesCoords[vi][0], model.verticesCoords[vi][1], 0];
  const flatDist = (a: number, b: number) => len(sub(flat(a), flat(b)));
  let maxEdgeError = 0;
  for (const [a, b] of model.edgesVertices) {
    const rest = flatDist(a, b);
    if (rest < 1e-9) continue;
    maxEdgeError = Math.max(maxEdgeError, Math.abs(len(sub(positions[a], positions[b])) - rest) / rest);
  }
  // Sign-agnostic angle error (magnitude) so branch/sign differences don't mask
  // whether the crease angles themselves are met.
  let maxAngleErrorDeg = 0;
  for (const key of Object.keys(creaseAnglesDeg)) {
    const ei = Number(key);
    const fcs = model.edgeFaces[ei];
    if (!fcs || fcs.length < 2) continue;
    const [a, b] = model.edgesVertices[ei];
    const triA = triangleWithEdge(model.facesVertices[fcs[0]], a, b);
    const triB = triangleWithEdge(model.facesVertices[fcs[1]], a, b);
    if (!triA || !triB) continue;
    const c: DihedralC = { kind: "dihedral", a, b, triA, triB, target: 0, w: 1, stencil: [], edge: ei };
    const got = (Math.abs(dihedralAngle(positions, c)) * 180) / Math.PI;
    maxAngleErrorDeg = Math.max(maxAngleErrorDeg, Math.abs(got - Math.abs(creaseAnglesDeg[ei])));
  }
  return { maxEdgeError, maxAngleErrorDeg };
}

export function foldConstrained(
  model: FoldModel,
  creaseAnglesDeg: Record<number, number>,
  options: {
    iterations?: number;
    steps?: number;
    edgeWeight?: number;
    facetWeight?: number;
    dihedralWeight?: number;
    seed?: V3[];
    /** Per-edge angles (deg) already folded by a prior stage; the homotopy ramps
     *  each crease from here to its full target instead of from flat. Used for
     *  sequential keyframe-by-keyframe solving (the reference's pipeline). */
    baseAngles?: Record<number, number>;
    /** Per-keyframe fixed faces from PackCAD's `fixedFaceIDs`. */
    fixedFaceIndices?: number[];
    /** Per-keyframe fixed vertices from PackCAD's `fixedVertexIDs`. */
    fixedVertexIndices?: number[];
  } = {},
): ConstrainedFold {
  const maxIters = options.iterations ?? 900;
  // Homotopy stages: the crease targets are ramped 0 -> full so the solve tracks
  // the continuous fold from flat (the branch the reference develops into),
  // instead of jumping to a one-shot seed's branch.
  const steps = Math.max(1, options.steps ?? 28);
  // Isometry weighted well above dihedral: keep the paper rigid and match crease
  // angles where feasible; where infeasible (non-rigid) the angle residual stays
  // high (reported) rather than tearing the paper. Facet dihedrals are stiff too
  // so polygon facets stay planar without overpowering isometry.
  const weights = {
    edge: options.edgeWeight ?? 100,
    facet: options.facetWeight ?? 20,
    dihedral: options.dihedralWeight ?? 1,
  };
  const N = model.verticesCoords.length;

  const flat = (vi: number): V3 => [model.verticesCoords[vi][0], model.verticesCoords[vi][1], 0];
  const flatDist = (a: number, b: number) => len(sub(flat(a), flat(b)));

  // Seed from the rigid development at the first homotopy factor: this picks the
  // data's branch (mountain/valley per crease) with the right small-angle sign.
  // Homotopy then tracks it continuously to full fold.
  const seed = options.seed ?? developSeed(model, scaleAngles(creaseAnglesDeg, 1 / steps));
  const x: V3[] = seed.map((p) => [p[0], p[1], p[2]]);

  const { constraints, creases } = buildConstraints(model, creaseAnglesDeg, weights);
  const fullTargets = creases.map((c) => c.target);
  // Ramp start per crease: the already-folded base angle (radians, same signed
  // convention as the target) when staging, else 0 (fold from flat).
  const baseTargets = creases.map((c) => {
    const deg = options.baseAngles?.[c.edge];
    if (deg === undefined) return 0;
    return (Math.sign(c.target) || 1) * Math.abs((deg * Math.PI) / 180);
  });

  // Free DOF map. Pin the active keyframe's captured anchors when present;
  // otherwise fall back to the global setup face.
  const pinned = new Array<boolean>(N).fill(false);
  const fixedFaces = options.fixedFaceIndices?.length
    ? options.fixedFaceIndices
    : [model.fixedFaceIndex];
  for (const faceIndex of fixedFaces) {
    for (const vi of model.facesVertices[faceIndex] ?? []) pinned[vi] = true;
  }
  for (const vi of options.fixedVertexIndices ?? []) {
    if (vi >= 0 && vi < pinned.length) pinned[vi] = true;
  }
  const col = new Array<number>(N * 3).fill(-1);
  let F = 0;
  for (let v = 0; v < N; v += 1) if (!pinned[v]) for (let ax = 0; ax < 3; ax += 1) col[v * 3 + ax] = F++;

  const residual = (c: Constraint): number => {
    if (c.kind === "edge") return (len(sub(x[c.i], x[c.j])) - c.rest) / (c.rest || 1);
    return dihedralAngle(x, c) - c.target;
  };
  const stencilOf = (c: Constraint): number[] => (c.kind === "edge" ? [c.i, c.j] : c.stencil);
  const energy = (): number => {
    let e = 0;
    for (const c of constraints) {
      const r = residual(c);
      e += c.w * r * r;
    }
    return 0.5 * e;
  };

  const eps = 1e-6 * (flatDist(model.edgesVertices[0][0], model.edgesVertices[0][1]) || 1);
  let lambda = 1e-3;
  let iter = 0;

  // One Gauss-Newton iteration on the current targets; returns false if no step
  // was accepted (converged or stuck at this stage).
  const gnStep = (): boolean => {
    const A: number[][] = Array.from({ length: F }, () => new Array<number>(F).fill(0));
    const g = new Array<number>(F).fill(0);
    for (const c of constraints) {
      const r = residual(c);
      const grad: Array<{ col: number; d: number }> = [];
      for (const v of stencilOf(c)) {
        if (pinned[v]) continue;
        for (let ax = 0; ax < 3; ax += 1) {
          const save = x[v][ax];
          x[v][ax] = save + eps;
          const rp = residual(c);
          x[v][ax] = save - eps;
          const rm = residual(c);
          x[v][ax] = save;
          const d = (rp - rm) / (2 * eps);
          if (d !== 0) grad.push({ col: col[v * 3 + ax], d });
        }
      }
      for (let p = 0; p < grad.length; p += 1) {
        g[grad[p].col] += c.w * grad[p].d * r;
        for (let q = 0; q < grad.length; q += 1) A[grad[p].col][grad[q].col] += c.w * grad[p].d * grad[q].d;
      }
    }
    const e0 = energy();
    for (let tries = 0; tries < 8; tries += 1) {
      for (let i = 0; i < F; i += 1) A[i][i] += lambda; // damping (incremental across tries)
      const delta = choleskySolve(A, g.map((v) => -v));
      for (let i = 0; i < F; i += 1) A[i][i] -= lambda;
      if (!delta) { lambda *= 4; continue; }
      let alpha = 1;
      const backup = x.map((p) => [p[0], p[1], p[2]] as V3);
      for (let ls = 0; ls < 6; ls += 1) {
        for (let v = 0; v < N; v += 1) for (let ax = 0; ax < 3; ax += 1) {
          const cc = col[v * 3 + ax];
          if (cc >= 0) x[v][ax] = backup[v][ax] + alpha * delta[cc];
        }
        if (energy() < e0) { lambda = Math.max(1e-6, lambda * 0.7); return true; }
        for (let v = 0; v < N; v += 1) x[v] = [backup[v][0], backup[v][1], backup[v][2]];
        alpha *= 0.4;
      }
      lambda *= 4;
    }
    return false;
  };

  // Run GN to convergence (or a cap) at the current targets.
  const settle = (cap: number) => {
    let prevEnergy = Infinity;
    let plateau = 0;
    for (let i = 0; i < cap && iter < maxIters; i += 1, iter += 1) {
      if (!gnStep()) break;
      const eNow = energy();
      if (Math.abs(prevEnergy - eNow) <= 1e-9 * (eNow + 1e-10)) {
        if (++plateau >= 4) break;
      } else plateau = 0;
      prevEnergy = eNow;
    }
  };

  // Allocate the iteration budget across the homotopy stages; each stage also
  // stops early on an energy plateau, so the spend tracks where work is needed.
  const capPerStage = Math.max(6, Math.floor(maxIters / (steps + 1)));
  for (let s = 1; s <= steps && iter < maxIters; s += 1) {
    const factor = s / steps;
    creases.forEach((c, k) => {
      c.target = baseTargets[k] + factor * (fullTargets[k] - baseTargets[k]);
    });
    settle(capPerStage);
  }
  // Final polish at the full targets.
  settle(maxIters - iter);

  // Quality metrics.
  let maxEdgeError = 0;
  for (const [a, b] of model.edgesVertices) {
    const rest = flatDist(a, b);
    if (rest < 1e-9) continue;
    maxEdgeError = Math.max(maxEdgeError, Math.abs(len(sub(x[a], x[b])) - rest) / rest);
  }
  let maxAngleErrorDeg = 0;
  for (const c of creases) {
    const got = dihedralAngle(x, c);
    maxAngleErrorDeg = Math.max(maxAngleErrorDeg, (Math.abs(got - c.target) * 180) / Math.PI);
  }
  return { positions: x, iterations: iter, maxEdgeError, maxAngleErrorDeg, converged: iter < maxIters };
}

/**
 * Sequential keyframe-by-keyframe solve, mirroring the reference's operation
 * pipeline: each OPERATION_ORIGAMI_SIMULATION is solved in order, seeded from the
 * previous result with the already-folded creases held (baseAngles). Folding a
 * package one stage at a time is far more tractable than all-at-once -- e.g. a
 * carton's walls must fold up (a closed-tube fold) before its flaps and lid can
 * close, and folding everything simultaneously from flat stalls.
 *
 * Each stage tries two seeding strategies and keeps the better (lower combined
 * isometry+angle cost): a one-shot full development (needed for closed-loop folds
 * like a tube, which homotopy cannot close) and a from-flat homotopy (needed for
 * folds that must track a continuous branch, e.g. curved creases).
 */
export function foldSequence(
  model: FoldModel,
  options: { iterations?: number } = {},
): ConstrainedFold {
  const perStageIters = options.iterations ?? 500;
  const cost = (r: ConstrainedFold) => r.maxEdgeError * 10 + r.maxAngleErrorDeg / 180;

  let positions: V3[] | undefined;
  const base: Record<number, number> = {};
  let lastIters = 0;
  for (const kf of model.keyframes) {
    const cumulative = withInactiveCreaseCarryAngles(model, {
      ...base,
      ...kf.creaseAnglesDeg,
    });
    const baseAngles = withInactiveCreaseCarryAngles(model, base);
    let best: ConstrainedFold | null = null;
    // One-shot development (steps 1) and from-flat homotopy (steps 24).
    for (const steps of [1, 24]) {
      const r = foldConstrained(model, cumulative, {
        iterations: perStageIters,
        steps,
        baseAngles,
        seed: positions,
        fixedFaceIndices: kf.fixedFaceIndices,
        fixedVertexIndices: kf.fixedVertexIndices,
      });
      if (!best || cost(r) < cost(best)) best = r;
    }
    positions = (best as ConstrainedFold).positions;
    lastIters += (best as ConstrainedFold).iterations;
    Object.assign(base, kf.creaseAnglesDeg);
  }

  // Final quality metrics against the full cumulative target.
  const flat = (vi: number): V3 => [model.verticesCoords[vi][0], model.verticesCoords[vi][1], 0];
  const flatDist = (a: number, b: number) => len(sub(flat(a), flat(b)));
  const x = positions ?? model.verticesCoords.map((v) => [v[0], v[1], 0] as V3);
  let maxEdgeError = 0;
  for (const [a, b] of model.edgesVertices) {
    const rest = flatDist(a, b);
    if (rest < 1e-9) continue;
    maxEdgeError = Math.max(maxEdgeError, Math.abs(len(sub(x[a], x[b])) - rest) / rest);
  }
  const { creases } = buildConstraints(model, base, { edge: 1, facet: 1, dihedral: 1 });
  let maxAngleErrorDeg = 0;
  for (const c of creases) {
    maxAngleErrorDeg = Math.max(maxAngleErrorDeg, (Math.abs(dihedralAngle(x, c) - c.target) * 180) / Math.PI);
  }
  return { positions: x, iterations: lastIters, maxEdgeError, maxAngleErrorDeg, converged: true };
}

export type FoldSummary = {
  status: SolveStatus;
  message: string;
  /** Creases that could not reach their target fold angle within tolerance. */
  unresolvedSeams: number;
  maxStrainPct: number;
  maxAngleErrorDeg: number;
};

export type KeyframeSummary = { id: string; label: string; status: SolveStatus; unresolvedSeams: number };

/**
 * Single source of truth for the Solve UI, mirroring the reference's pipeline:
 * solve each OPERATION_ORIGAMI_SIMULATION keyframe in order (seeded from the
 * previous stage, prior creases held), and report a `Solved` / `Non-Rigid`
 * verdict per keyframe from the same isometry-AND-crease-angle test. The overall
 * verdict is the fully-folded (final cumulative) state, so the Project
 * inspector's pill and the per-keyframe badges are computed from one solve and
 * cannot contradict each other.
 *
 * Runs in a Web Worker (`foldStatusWorker`) and uses the same sequential Newton
 * constraints as replay, so diagnostics cannot disagree with the live motion.
 */
export function summarizeFolds(model: FoldModel): { overall: FoldSummary; keyframes: KeyframeSummary[] } {
  const keyframes: KeyframeSummary[] = [];
  let priorTargets: Record<number, number> = {};
  let positions: V3[] = model.verticesCoords.map(([x, y]) => [x, y, 0]);
  let last: FoldSummary | null = null;
  for (const kf of model.keyframes) {
    const constraints = sourceStageConstraintAngles(model, kf, positions, priorTargets);
    const solve = foldNewton(model, constraints, {
      maxIterations: 250,
      seed: positions,
      fixedFaceIndices: kf.fixedFaceIndices,
      fixedVertexIndices: kf.fixedVertexIndices,
    });
    const solved = solve.isSolved;
    const summary: FoldSummary = {
      status: solved ? "Solved" : "Non-Rigid",
      message: solved ? "" : nonRigidMessage,
      unresolvedSeams: solved ? 0 : Object.keys(kf.creaseAnglesDeg).length,
      maxStrainPct: Math.round(solve.maxEdgeError * 100),
      maxAngleErrorDeg: solve.maxAngleErrorDeg,
    };
    keyframes.push({ id: kf.id, label: kf.label, status: summary.status, unresolvedSeams: summary.unresolvedSeams });
    last = summary;
    positions = solve.positions;
    priorTargets = appendPriorTargets(priorTargets, kf);
  }
  const overall: FoldSummary =
    last ?? { status: "Solved", message: "", unresolvedSeams: 0, maxStrainPct: 0, maxAngleErrorDeg: 0 };
  return { overall, keyframes };
}
