// Faithful port of the reference rigid-origami solver (OrigamiSimulation +
// ConstraintManager). The reference defines the classes Constraint /
// DihedralConstraint / DistanceConstraint / FacetDihedralConstraint /
// CreaseDihedralConstraint / ConstraintManager / OrigamiSimulation.
//
// The reference works on a TRIANGULATED mesh and minimises, by a Newton /
// projective step with a mass-matrix regulariser, four constraint families:
//   - DistanceConstraint           on every real edge          G = 1000·L/scale
//   - TriangulationDistance        on every fan diagonal        G = 1000·L/scale
//   - FacetDihedralConstraint      hold each facet flat (t=0)   G =    1·L/scale  (soft)
//   - CreaseDihedralConstraint     drive crease to fold angle    G =   10·L/scale
// Each step assembles  (CᵀGC + M) Δ = CᵀG·c  (c = signed constraint error),
// solves it by dense Cholesky, and applies it with an adaptive binary line
// search (energy must decrease AND all edges stay within 5% strain).
//
// The two mechanisms that make it fold *from flat* (which a plain Gauss-Newton
// cannot): (1) the dihedral error is CLAMPED to ±π/25 (7.2°) per step — a
// built-in homotopy that ramps every crease to its target a few degrees at a
// time, keeping each linearisation valid; (2) the mass matrix M (lumped from
// triangle areas) regularises the otherwise rank-deficient flat configuration
// into a rigid-body-like folding motion instead of a facet-tilting one. Facets
// are SOFT (G=1) so they do not block the fold, edges STIFF (G=1000) so the
// paper stays isometric.
//
// Framework-free + node-verifiable. Constants are the reference's verbatim.

import { triangulateFace } from "@atelier/geometry";
import type { FoldModel } from "@packcad/format";
import { appendPriorTargets, sourceStageConstraintAngles } from "./foldPlaybackConstraints";
import type { Vec3 } from "./foldSolver";

type V3 = Vec3;

// ---- reference constants (verbatim) ----------------------------------------
const STIFFNESS_EDGE_LENGTH = 1000;
const STIFFNESS_ACTIVE_CREASE = 10;
const STIFFNESS_FACET_CREASE = 1;
const MASS_MULTIPLIER = 0.001;
const CREASE_ANGLE_ERROR_CLAMP = Math.PI / 25; // 7.2° max error per step
const ADAPTIVE_STEP_DEFAULT_STEP_SIZE = 0.9;
const ADAPTIVE_STEP_SIZE_MIN = 1e-12;
const ADAPTIVE_STEP_REFINEMENT_ITERATIONS = 3;
const INCREMENTAL_SOLVE_TOL_DISTANCE = 0.05; // 5% strain ceiling for a valid step
const FINAL_SOLVE_TOL_DISTANCE = 0.001;
const FINAL_SOLVE_TOL_ANGULAR_RADIANS = 0.01;
const ENERGY_HISTORY_MAX_LENGTH = 15;
const ENERGY_DETECTION_WINDOW = 5;
const ENERGY_ABSOLUTE_CHANGE_THRESHOLD = 0.0001;
const ENERGY_PLATEAU_DETECTION_THRESHOLD = 0.001;
const FINAL_SOLVE_ENERGY_PLATEAU_DETECTION_THRESHOLD = 0.01;
const MAX_SOLVER_ITERATIONS = 250;

// ---- small vec helpers ------------------------------------------------------
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
function triNormal(P: V3[], a: number, b: number, c: number): V3 {
  return norm(cross(sub(P[b], P[a]), sub(P[c], P[a])));
}
/** Perpendicular distance from apex w to the line through the hinge (a,b). */
function leverArm(P: V3[], w: number, a: number, b: number): number {
  const e = norm(sub(P[b], P[a]));
  const d = sub(P[w], P[a]);
  const par = dot(d, e);
  return Math.sqrt(Math.max(0, dot(d, d) - par * par));
}
/** Signed fold angle: acos(n1·n2) signed by sign((n1×n2)·ê). flat = 0. */
function foldAngle(n1: V3, n2: V3, eHat: V3): number {
  const c = Math.max(-1, Math.min(1, dot(n1, n2)));
  let a = Math.acos(c);
  if (dot(cross(n1, n2), eHat) < 0) a = -a;
  return a;
}

type Tri = [number, number, number];
function triEdgeDir(tri: Tri, a: number, b: number): number {
  for (let i = 0; i < 3; i += 1) {
    const u = tri[i];
    const v = tri[(i + 1) % 3];
    if (u === a && v === b) return 1;
    if (u === b && v === a) return -1;
  }
  return 0;
}
function triApex(tri: Tri, a: number, b: number): number {
  return tri.find((v) => v !== a && v !== b) as number;
}

// ---- constraints ------------------------------------------------------------
type EdgeC = { kind: "edge"; i: number; j: number; rest: number; G: number };
// Dihedral: hinge (a,b); tri1 (winding a->b, apex w1), tri2 (b->a, apex w2).
type DihC = { kind: "dih"; a: number; b: number; w1: number; w2: number; target: number; G: number; edge: number };

export type NewtonFold = {
  positions: V3[];
  iterations: number;
  maxEdgeError: number;
  maxAngleErrorDeg: number;
  converged: boolean;
  isSolved: boolean;
  /** Total unconstrained solver energy after the last accepted step. */
  energy: number;
  /** Adaptive line-search step to reuse on the next incremental update. */
  stepSize: number;
  /** True when no valid decreasing/isometric step could be found. */
  stuck: boolean;
};

/** Dense Cholesky solve of SPD A x = b (A row-major n×n). null if not PD. */
function choleskySolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k += 1) s -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (s <= 0) return null;
        L[i * n + i] = Math.sqrt(s);
      } else {
        L[i * n + j] = s / L[j * n + j];
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = b[i];
    for (let k = 0; k < i; k += 1) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i];
    for (let k = i + 1; k < n; k += 1) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** +1 if loop traverses a->b, -1 if b->a, 0 otherwise. */
function edgeTraversal(loop: number[], a: number, b: number): number {
  for (let i = 0; i < loop.length; i += 1) {
    const u = loop[i];
    const v = loop[(i + 1) % loop.length];
    if (u === a && v === b) return 1;
    if (u === b && v === a) return -1;
  }
  return 0;
}
export function foldNewton(
  model: FoldModel,
  creaseAnglesDeg: Record<number, number>,
  options: {
    maxIterations?: number;
    seed?: V3[];
    strainTol?: number;
    /** Faces held rigid this solve (default: the model's global fixed face).
     *  The reference's per-keyframe `fixedFaceIDs` -- e.g. hold the already-folded
     *  carton body while only the lid creases solve. */
    fixedFaceIndices?: number[];
    /** Extra individual vertices to pin (`fixedVertexIDs`). */
    fixedVertexIndices?: number[];
    /** Persistent OrigamiSimulation line-search state (default 0.9). */
    initialStepSize?: number;
  } = {},
): NewtonFold {
  const maxIters = options.maxIterations ?? MAX_SOLVER_ITERATIONS;
  const strainTol = options.strainTol ?? INCREMENTAL_SOLVE_TOL_DISTANCE;
  const N = model.verticesCoords.length;
  const flat = (vi: number): V3 => [model.verticesCoords[vi][0], model.verticesCoords[vi][1], 0];
  const flatDist = (a: number, b: number) => len(sub(flat(a), flat(b)));

  // scaleFactor = max bbox dimension of the (flat) geometry — held constant, as
  // the reference caches the M/G matrices and only invalidates on topology change.
  const mn: V3 = [Infinity, Infinity, Infinity];
  const mx: V3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < N; v += 1) {
    const p = flat(v);
    for (let k = 0; k < 3; k += 1) {
      mn[k] = Math.min(mn[k], p[k]);
      mx[k] = Math.max(mx[k], p[k]);
    }
  }
  const scale = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;

  // ---- triangulate every face (ear clipping on the flat polygon) -----------
  const faceTris: Tri[][] = model.facesVertices.map((loop) => triangulateFace(loop, model.verticesCoords));

  // ---- isometry bars: real edges + triangulation diagonals -----------------
  const edges: EdgeC[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenEdge.has(k)) return;
    seenEdge.add(k);
    const rest = flatDist(a, b) / scale;
    edges.push({ kind: "edge", i: a, j: b, rest, G: STIFFNESS_EDGE_LENGTH * rest });
  };
  for (const [a, b] of model.edgesVertices) addEdge(a, b);
  for (const tris of faceTris) for (const [i, j, k] of tris) {
    addEdge(i, j);
    addEdge(j, k);
    addEdge(k, i);
  }

  // ---- FacetDihedral: hold each internal diagonal coplanar (target 0, soft) -
  const dihs: DihC[] = [];
  for (const tris of faceTris) {
    // internal edges = those shared by two triangles of this face (the diagonals)
    const byEdge = new Map<string, Tri[]>();
    for (const t of tris) {
      for (let e = 0; e < 3; e += 1) {
        const u = t[e];
        const v = t[(e + 1) % 3];
        const key = u < v ? `${u}:${v}` : `${v}:${u}`;
        const arr = byEdge.get(key);
        if (arr) arr.push(t);
        else byEdge.set(key, [t]);
      }
    }
    for (const [key, arr] of byEdge) {
      if (arr.length !== 2) continue;
      const [as, bs] = key.split(":").map(Number);
      // tri1 traverses a->b, tri2 traverses b->a (opposite sides of the diagonal)
      let t1 = arr[0];
      let t2 = arr[1];
      if (triEdgeDir(t1, as, bs) !== 1) [t1, t2] = [t2, t1];
      const rest = flatDist(as, bs) / scale;
      dihs.push({
        kind: "dih",
        a: as,
        b: bs,
        w1: triApex(t1, as, bs),
        w2: triApex(t2, as, bs),
        target: 0,
        G: STIFFNESS_FACET_CREASE * rest,
        edge: -1,
      });
    }
  }

  // ---- CreaseDihedral: real folded edges driven to their (signed) target ----
  // tri1 is the face triangle traversing a->b (reference's parent-face-CCW fold).
  const findTri = (fi: number, a: number, b: number): Tri | null =>
    faceTris[fi].find((t) => t.includes(a) && t.includes(b)) ?? null;
  const creases: DihC[] = [];
  for (const key of Object.keys(creaseAnglesDeg)) {
    const ei = Number(key);
    const targetDeg = creaseAnglesDeg[ei];
    const faces = model.edgeFaces[ei];
    if (!faces || faces.length < 2) continue;
    const [a, b] = model.edgesVertices[ei];
    let f1 = faces[0];
    let f2 = faces[1];
    if (edgeTraversal(model.facesVertices[f1], a, b) !== 1 && edgeTraversal(model.facesVertices[f2], a, b) === 1) {
      [f1, f2] = [f2, f1];
    }
    const t1 = findTri(f1, a, b);
    const t2 = findTri(f2, a, b);
    if (!t1 || !t2) continue;
    const w1 = triApex(t1, a, b);
    const w2 = triApex(t2, a, b);
    const rest = flatDist(a, b) / scale;
    const c: DihC = {
      kind: "dih",
      a,
      b,
      w1,
      w2,
      target: targetDeg * Math.PI / 180,
      G: STIFFNESS_ACTIVE_CREASE * rest,
      edge: ei,
    };
    creases.push(c);
    dihs.push(c);
  }

  // ---- mass matrix (lumped triangle areas, flat) ---------------------------
  const mass = new Float64Array(N);
  const invScale2 = 1 / (scale * scale);
  for (const tris of faceTris) {
    for (const [i, j, k] of tris) {
      const area = 0.5 * len(cross(sub(flat(j), flat(i)), sub(flat(k), flat(i))));
      const share = (area * invScale2) / 3;
      mass[i] += share;
      mass[j] += share;
      mass[k] += share;
    }
  }
  for (let v = 0; v < N; v += 1) {
    mass[v] *= MASS_MULTIPLIER;
    if (mass[v] === 0) mass[v] = 1e-6;
  }

  // ---- free DOF map (pin the fixed face(s) + any fixed vertices) -----------
  // Per-keyframe anchors hold part of the model rigid (the reference's
  // fixedFaceIDs/fixedVertexIDs): e.g. the carton body is pinned while the lid
  // folds against it, which both anchors the solve and holds the prior folds.
  const pinned = new Array<boolean>(N).fill(false);
  const fixedFaces =
    options.fixedFaceIndices && options.fixedFaceIndices.length > 0
      ? options.fixedFaceIndices
      : [model.fixedFaceIndex];
  for (const fi of fixedFaces) for (const vi of model.facesVertices[fi]) pinned[vi] = true;
  for (const vi of options.fixedVertexIndices ?? []) pinned[vi] = true;
  const col = new Int32Array(N * 3).fill(-1);
  let F = 0;
  for (let v = 0; v < N; v += 1) if (!pinned[v]) for (let ax = 0; ax < 3; ax += 1) col[v * 3 + ax] = F++;

  // ---- state ----------------------------------------------------------------
  const x: V3[] = (options.seed ?? model.verticesCoords.map((v) => [v[0], v[1], 0] as V3)).map(
    (p) => [p[0], p[1], p[2]] as V3,
  );

  // Gradient stencil of one dihedral: returns {cols[], grads[]} as flat DOF
  // contributions of d(foldAngle)/dx, plus the current signed fold angle.
  type DihEval = { current: number; entries: Array<{ col: number; d: number }> } | null;
  const evalDih = (c: DihC): DihEval => {
    const n1 = triNormal(x, c.a, c.b, c.w1);
    const n2 = triNormal(x, c.b, c.a, c.w2);
    const eHat = norm(sub(x[c.b], x[c.a]));
    const current = foldAngle(n1, n2, eHat);
    const E0 = leverArm(x, c.w2, c.a, c.b) / scale;
    const F0 = leverArm(x, c.w1, c.a, c.b) / scale;
    if (E0 < 1e-12 || F0 < 1e-12) return { current, entries: [] };
    const ang = (at: number, p: number, q: number) => {
      const u = norm(sub(x[p], x[at]));
      const v = norm(sub(x[q], x[at]));
      return Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
    };
    const k0 = ang(c.a, c.b, c.w1); // tri1 angle at a
    const R0 = ang(c.b, c.a, c.w1); // tri1 angle at b
    const N0 = ang(c.a, c.b, c.w2); // tri2 angle at a
    const n0 = ang(c.b, c.a, c.w2); // tri2 angle at b
    const tanTol = 1e-12;
    const tans = [Math.tan(n0), Math.tan(R0), Math.tan(N0), Math.tan(k0)];
    if (tans.some((t) => Math.abs(t) < tanTol)) return { current, entries: [] };
    const G0 = 1 / tans[0];
    const H0 = 1 / tans[1];
    const q0 = 1 / tans[2];
    const K0 = 1 / tans[3];
    const j0 = 1 / (q0 + G0);
    const z0 = 1 / (K0 + H0);
    const Z0 = G0 * j0;
    const Sr = q0 * j0;
    const kr = H0 * z0;
    const dr = K0 * z0;
    const Nf = mul(n2, 1 / E0);
    const Nt = mul(n1, 1 / F0);
    const gW2 = mul(Nf, -1);
    const gW1 = mul(Nt, -1);
    const gA = add(mul(Nf, Z0), mul(Nt, kr));
    const gB = add(mul(Nf, Sr), mul(Nt, dr));
    const entries: Array<{ col: number; d: number }> = [];
    const push = (v: number, g: V3) => {
      for (let ax = 0; ax < 3; ax += 1) {
        const cc = col[v * 3 + ax];
        if (cc >= 0 && g[ax] !== 0) entries.push({ col: cc, d: g[ax] });
      }
    };
    push(c.w2, gW2);
    push(c.w1, gW1);
    push(c.a, gA);
    push(c.b, gB);
    return { current, entries };
  };

  // signed error (residual c), clamped to ±π/25 for the solve.
  const dihError = (c: DihC, current: number): number => {
    let e = c.target - current;
    e = Math.min(e, CREASE_ANGLE_ERROR_CLAMP);
    e = Math.max(e, -CREASE_ANGLE_ERROR_CLAMP);
    return e;
  };

  // total energy = Σ G·err²  (edges + dihedrals, dihedral error UNCLAMPED).
  const energy = (): number => {
    let e = 0;
    for (const c of edges) {
      const cur = len(sub(x[c.i], x[c.j])) / scale;
      const err = c.rest - cur;
      e += c.G * err * err;
    }
    for (const c of dihs) {
      const ev = evalDih(c);
      if (!ev) continue;
      const err = c.target - ev.current; // unclamped
      e += c.G * err * err;
    }
    return e;
  };

  // edges within 5% strain (the reference's satisfiesCreaseConstraintsForEdges).
  const edgesWithinTol = (tol: number): boolean => {
    for (const c of edges) {
      const cur = len(sub(x[c.i], x[c.j])) / scale;
      if (Math.abs(c.rest - cur) / (c.rest || 1) > tol) return false;
    }
    return true;
  };

  // ---- line search (apply pos = prev + Δ·step·scale) -----------------------
  const prev = new Float64Array(F);
  const applyStep = (delta: Float64Array, step: number) => {
    const A = step * scale;
    for (let v = 0; v < N; v += 1) {
      for (let ax = 0; ax < 3; ax += 1) {
        const cc = col[v * 3 + ax];
        if (cc >= 0) x[v][ax] = prev[cc] + delta[cc] * A;
      }
    }
  };
  let cachedEnergy = Infinity;
  const isValidStep = (delta: Float64Array, step: number, prevEnergy: number, tol: number): boolean => {
    applyStep(delta, step);
    const e = energy();
    if (e >= prevEnergy || !edgesWithinTol(tol)) return false;
    cachedEnergy = e;
    return true;
  };
  const binarySearch = (delta: Float64Array, lo: number, hi: number, prevEnergy: number, tol: number): number => {
    let lastValid = true;
    let low = lo;
    let high = hi;
    for (let i = 0; i < ADAPTIVE_STEP_REFINEMENT_ITERATIONS; i += 1) {
      const mid = (low + high) / 2;
      if (isValidStep(delta, mid, prevEnergy, tol)) {
        low = mid;
        lastValid = true;
      } else {
        high = mid;
        lastValid = false;
      }
    }
    if (!lastValid) applyStep(delta, low);
    return low;
  };
  const adaptiveStep = (delta: Float64Array, initial: number, prevEnergy: number): number | undefined => {
    const tol = strainTol;
    if (isValidStep(delta, initial, prevEnergy, tol)) {
      if (initial < ADAPTIVE_STEP_DEFAULT_STEP_SIZE) {
        return binarySearch(delta, initial, ADAPTIVE_STEP_DEFAULT_STEP_SIZE, prevEnergy, tol);
      }
      return initial;
    }
    let high = initial;
    let mid = initial / 2;
    let found = false;
    while (mid >= ADAPTIVE_STEP_SIZE_MIN) {
      if (isValidStep(delta, mid, prevEnergy, tol)) {
        found = true;
        break;
      }
      high = mid;
      mid /= 2;
    }
    if (found) return binarySearch(delta, mid, high, prevEnergy, tol);
    applyStep(delta, 0);
    return undefined;
  };

  // ---- solver loop ----------------------------------------------------------
  const K = new Float64Array(F * F);
  const rhs = new Float64Array(F);
  const energyHistory = new Float64Array(ENERGY_HISTORY_MAX_LENGTH);
  let historyIndex = 0;
  let historyCount = 0;
  let lastStepSize = options.initialStepSize ?? ADAPTIVE_STEP_DEFAULT_STEP_SIZE;
  let converged = false;
  let totalEnergy = energy();
  let stuck = false;
  let iter = 0;

  const isSolved = (): boolean => {
    if (!edgesWithinTol(FINAL_SOLVE_TOL_DISTANCE)) return false;
    for (const c of creases) {
      const ev = evalDih(c);
      if (!ev) continue;
      if (Math.abs(c.target - ev.current) > FINAL_SOLVE_TOL_ANGULAR_RADIANS) return false;
    }
    return true;
  };
  const isEnergyPlateau = (rel: number): boolean => {
    if (historyCount < ENERGY_DETECTION_WINDOW) return false;
    const s0 = (historyIndex - ENERGY_DETECTION_WINDOW + ENERGY_HISTORY_MAX_LENGTH) % ENERGY_HISTORY_MAX_LENGTH;
    const s1 = (historyIndex - 1 + ENERGY_HISTORY_MAX_LENGTH) % ENERGY_HISTORY_MAX_LENGTH;
    const c0 = energyHistory[s0];
    const c1 = energyHistory[s1];
    const change = Math.abs(c1 - c0);
    if (change <= ENERGY_ABSOLUTE_CHANGE_THRESHOLD) return true;
    return change / (c0 + 1e-10) <= rel;
  };

  for (; iter < maxIters; iter += 1) {
    // assemble K = CᵀGC + M, rhs = CᵀG·c
    K.fill(0);
    rhs.fill(0);
    for (const c of edges) {
      const dv = sub(x[c.j], x[c.i]);
      const l = len(dv) || 1e-12;
      const u: V3 = [dv[0] / l, dv[1] / l, dv[2] / l]; // unit edge (reference: no /scale on C)
      const err = c.rest - l / scale; // signedError = target - current
      const entries: Array<{ col: number; d: number }> = [];
      for (let ax = 0; ax < 3; ax += 1) {
        const ci = col[c.i * 3 + ax];
        if (ci >= 0) entries.push({ col: ci, d: -u[ax] });
        const cj = col[c.j * 3 + ax];
        if (cj >= 0) entries.push({ col: cj, d: u[ax] });
      }
      for (let p = 0; p < entries.length; p += 1) {
        const ep = entries[p];
        rhs[ep.col] += c.G * ep.d * err;
        for (let q = 0; q < entries.length; q += 1) {
          const eq = entries[q];
          K[ep.col * F + eq.col] += c.G * ep.d * eq.d;
        }
      }
    }
    for (const c of dihs) {
      const ev = evalDih(c);
      if (!ev) continue;
      const err = dihError(c, ev.current);
      const { entries } = ev;
      for (let p = 0; p < entries.length; p += 1) {
        const ep = entries[p];
        rhs[ep.col] += c.G * ep.d * err;
        for (let q = 0; q < entries.length; q += 1) {
          const eq = entries[q];
          K[ep.col * F + eq.col] += c.G * ep.d * eq.d;
        }
      }
    }
    // + mass matrix on the diagonal
    for (let v = 0; v < N; v += 1) {
      for (let ax = 0; ax < 3; ax += 1) {
        const cc = col[v * 3 + ax];
        if (cc >= 0) K[cc * F + cc] += mass[v];
      }
    }

    const delta = choleskySolve(K, rhs, F);
    if (!delta) break;

    // store previous (free) positions for the line search
    for (let v = 0; v < N; v += 1) {
      for (let ax = 0; ax < 3; ax += 1) {
        const cc = col[v * 3 + ax];
        if (cc >= 0) prev[cc] = x[v][ax];
      }
    }
    const prevEnergy = energy();
    const step = adaptiveStep(delta, lastStepSize, prevEnergy);
    if (step === undefined) {
      stuck = true;
      lastStepSize = ADAPTIVE_STEP_DEFAULT_STEP_SIZE;
      break;
    }
    lastStepSize = step;
    totalEnergy = cachedEnergy;

    energyHistory[historyIndex] = totalEnergy;
    historyIndex = (historyIndex + 1) % ENERGY_HISTORY_MAX_LENGTH;
    if (historyCount < ENERGY_HISTORY_MAX_LENGTH) historyCount += 1;

    if (isEnergyPlateau(FINAL_SOLVE_ENERGY_PLATEAU_DETECTION_THRESHOLD)) {
      if (isEnergyPlateau(ENERGY_PLATEAU_DETECTION_THRESHOLD)) {
        converged = true;
        iter += 1;
        break;
      }
      if (isSolved()) {
        converged = true;
        iter += 1;
        break;
      }
    }
  }

  // ---- metrics --------------------------------------------------------------
  let maxEdgeError = 0;
  for (const [a, b] of model.edgesVertices) {
    const rest = flatDist(a, b);
    if (rest < 1e-9) continue;
    maxEdgeError = Math.max(maxEdgeError, Math.abs(len(sub(x[a], x[b])) - rest) / rest);
  }
  let maxAngleErrorDeg = 0;
  for (const c of creases) {
    const ev = evalDih(c);
    if (!ev) continue;
    maxAngleErrorDeg = Math.max(maxAngleErrorDeg, (Math.abs(c.target - ev.current) * 180) / Math.PI);
  }
  return {
    positions: x,
    iterations: iter,
    maxEdgeError,
    maxAngleErrorDeg,
    converged,
    isSolved: isSolved(),
    energy: totalEnergy,
    stepSize: lastStepSize,
    stuck,
  };
}

/**
 * Sequential keyframe drive, mirroring the reference's operation pipeline: each
 * OPERATION_ORIGAMI_SIMULATION (keyframe) is folded in order, each stage seeded
 * from the previous stage's rigid result so the per-step 5%-strain gate is met
 * (a torn one-shot development seed would be rejected immediately). Folding from
 * flat all-at-once lands in an ambiguous bifurcation (creases fight, flip sign,
 * strain-lock); folding the body before the lid establishes the branch the way
 * the reference does. Folds keyframes [0 .. uptoKeyframe] inclusive
 * (uptoKeyframe = activeStepIndex - 1; default: all keyframes).
 */
export function foldNewtonSequence(
  model: FoldModel,
  options: { uptoKeyframe?: number; maxIterationsPerStage?: number } = {},
): NewtonFold {
  const last = options.uptoKeyframe ?? model.keyframes.length - 1;
  const cap = options.maxIterationsPerStage ?? MAX_SOLVER_ITERATIONS;
  let seed: V3[] | undefined;
  let priorTargets: Record<number, number> = {};
  let result: NewtonFold | null = null;
  for (let k = 0; k <= last && k < model.keyframes.length; k += 1) {
    const kf = model.keyframes[k];
    const startingPositions = seed ?? model.verticesCoords.map((v) => [v[0], v[1], 0] as V3);
    const stageAngles = sourceStageConstraintAngles(model, kf, startingPositions, priorTargets);
    // Hold this keyframe's fixed faces/vertices rigid (the reference's per-stage
    // fixedFaceIDs) -- e.g. the milk_carton top closure pins the already-folded
    // body so the solve only moves the lid against it instead of letting the
    // whole carton drift.
    result = foldNewton(model, stageAngles, {
      maxIterations: cap,
      seed,
      fixedFaceIndices: kf.fixedFaceIndices,
      fixedVertexIndices: kf.fixedVertexIndices,
    });
    seed = result.positions;
    priorTargets = appendPriorTargets(priorTargets, kf);
  }
  return (
    result ?? {
      positions: model.verticesCoords.map((v) => [v[0], v[1], 0] as V3),
      iterations: 0,
      maxEdgeError: 0,
      maxAngleErrorDeg: 0,
      converged: true,
      isSolved: true,
      energy: 0,
      stepSize: ADAPTIVE_STEP_DEFAULT_STEP_SIZE,
      stuck: false,
    }
  );
}
