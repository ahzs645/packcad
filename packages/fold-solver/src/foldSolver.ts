// Rigid origami fold solver (framework-free, node-verifiable).
//
// Implements spanning-tree rigid folding: faces are rigid plates, creases are
// hinges. Starting from the fixed reference face, a breadth-first traversal of
// the face-adjacency graph rotates each child face's subtree about the shared
// edge by that crease's fold angle. Because every face keeps a rigid transform
// and hinge vertices lie on the rotation axis, shared hinge edges stay welded.
//
// This is an honest geometric fold of the captured data, not the reference's
// iterative constraint solver: it cannot guarantee closure of cyclic crease
// loops (a single vertex surrounded by several creases may leave a small gap).

import type { FoldModel, FoldTransform } from "@packcad/format";
import { triangulateFaceDelaunay } from "./faceTriangulation";

export type Vec3 = [number, number, number];

const EPS = 1e-9;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < EPS) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Rotate point `p` about the line through `origin` with unit direction `axis` by `angle` (radians). */
function rotateAboutLine(p: Vec3, origin: Vec3, axis: Vec3, angle: number): Vec3 {
  const d = sub(p, origin);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [kx, ky, kz] = axis;
  const dot = kx * d[0] + ky * d[1] + kz * d[2];
  // Rodrigues' rotation formula.
  const cross: Vec3 = [ky * d[2] - kz * d[1], kz * d[0] - kx * d[2], kx * d[1] - ky * d[0]];
  const rx = d[0] * cos + cross[0] * sin + kx * dot * (1 - cos);
  const ry = d[1] * cos + cross[1] * sin + ky * dot * (1 - cos);
  const rz = d[2] * cos + cross[2] * sin + kz * dot * (1 - cos);
  return [origin[0] + rx, origin[1] + ry, origin[2] + rz];
}

/** Per-face rigid transform expressed as an ordered list of hinge rotations. */
type Hinge = { origin: Vec3; axis: Vec3; angle: number };

function applyHinges(flat: Vec3, hinges: Hinge[]): Vec3 {
  // Hinges are stored root->leaf, and each child hinge axis is already computed
  // in its parent-folded frame. Applying them in that same order keeps nested
  // flaps on the developed branch instead of rotating around a world-space child
  // hinge before its parent transform exists.
  let p = flat;
  for (const h of hinges) {
    p = rotateAboutLine(p, h.origin, h.axis, h.angle);
  }
  return p;
}

function sharedEdgeIndex(model: FoldModel, faceA: number, faceB: number): number | null {
  for (const ei of model.facesEdges[faceA]) {
    if (model.edgeFaces[ei].includes(faceB)) return ei;
  }
  return null;
}

/**
 * Direction the edge {va,vb} is traversed in a face's CCW boundary loop:
 * +1 for va->vb, -1 for vb->va. Used to orient the hinge axis by the parent
 * face's winding so the signed fold matches the reference's convention
 * (foldAngle = acos(n1·n2) signed by sign((n1×n2)·edge)).
 */
function edgeTraversalSign(loop: number[], va: number, vb: number): number {
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (a === va && b === vb) return 1;
    if (a === vb && b === va) return -1;
  }
  return 1;
}

export type FoldedFace = {
  faceIndex: number;
  /** Folded 3D positions, one per vertex in the face's ordered loop. */
  positions: Vec3[];
  /** UV per vertex in the loop (empty when the model has no UVs). */
  uv: Array<[number, number]>;
  /** Triangle index triples into this face's `positions`/`uv` arrays. */
  triangles: Array<[number, number, number]>;
};

/**
 * Fold the model. `creaseAnglesDeg` maps FOLD edge index -> fold angle in
 * degrees (0 = flat). Returns folded geometry as independent (unwelded) faces,
 * each carrying its own positions/UVs/triangles for direct mesh assembly.
 */
export function foldFaces(model: FoldModel, creaseAnglesDeg: Record<number, number>): FoldedFace[] {
  const flat3 = (vi: number): Vec3 => {
    const v = model.verticesCoords[vi];
    return [v[0], v[1], 0];
  };

  // Per-face cumulative hinge stack (root has none).
  const hingesByFace: Array<Hinge[] | null> = model.facesVertices.map(() => null);
  hingesByFace[model.fixedFaceIndex] = [];

  // BFS across face adjacency from the fixed face.
  const queue: number[] = [model.fixedFaceIndex];
  while (queue.length > 0) {
    const face = queue.shift() as number;
    const parentHinges = hingesByFace[face] as Hinge[];
    for (const ei of model.facesEdges[face]) {
      for (const neighbor of model.edgeFaces[ei]) {
        if (neighbor === face || hingesByFace[neighbor]) continue;
        const angleDeg = creaseAnglesDeg[ei] ?? 0;
        const sharedEi = sharedEdgeIndex(model, face, neighbor);
        let childHinges = parentHinges;
        if (sharedEi !== null && Math.abs(angleDeg) > EPS) {
          const [va, vb] = model.edgesVertices[sharedEi];
          // Orient the hinge axis along the parent face's CCW traversal of the
          // edge so a +angle rotation produces the reference's signed dihedral.
          const sign = edgeTraversalSign(model.facesVertices[face], va, vb);
          const headV = sign > 0 ? va : vb;
          const tailV = sign > 0 ? vb : va;
          const originFolded = applyHinges(flat3(headV), parentHinges);
          const tipFolded = applyHinges(flat3(tailV), parentHinges);
          const axis = normalize(sub(tipFolded, originFolded));
          childHinges = [...parentHinges, { origin: originFolded, axis, angle: (angleDeg * Math.PI) / 180 }];
        }
        hingesByFace[neighbor] = childHinges;
        queue.push(neighbor);
      }
    }
  }

  return model.facesVertices.map((loop, faceIndex) => {
    const hinges = hingesByFace[faceIndex] ?? [];
    const positions = loop.map((vi) => applyHinges(flat3(vi), hinges));
    const uv = loop.map((vi): [number, number] => {
      const t = model.verticesUv[vi];
      return t ? [t[0], t[1]] : [0, 0];
    });
    // Triangulate (ear-clip) over local loop indices using each vertex's flat 2D
    // coords, so non-convex / collinear panels don't get degenerate triangles.
    const local = loop.map((_, i) => i);
    const localCoords = loop.map((vi) => model.verticesCoords[vi]);
    const triangles = triangulateFaceDelaunay(local, localCoords);
    return { faceIndex, positions, uv, triangles };
  });
}

/**
 * Resolve the cumulative crease-angle map for a fold timeline at a given step.
 * Keyframes before `activeStepIndex` are fully applied; the active keyframe is
 * scaled by `activeRatio` (0..1); later keyframes are not applied. Index 0 is
 * the flat "Folding Setup" state (no keyframe applied).
 */
export function creaseAnglesForTimeline(
  model: FoldModel,
  activeStepIndex: number,
  activeRatio: number,
): Record<number, number> {
  const result: Record<number, number> = {};
  // activeStepIndex counts the synthetic setup step as 0, so keyframe k lives at
  // step k+1.
  const activeKeyframe = activeStepIndex - 1;
  model.keyframes.forEach((kf, k) => {
    const isPast = k < activeKeyframe;
    const isActive = k === activeKeyframe;
    if (!isPast && !isActive) return;
    const ratio = isPast ? 1 : Math.max(0, Math.min(1, activeRatio));
    for (const [edgeIndex, angle] of Object.entries(kf.creaseAnglesDeg)) {
      const index = Number(edgeIndex);
      const previous = result[index] ?? 0;
      result[index] = previous + (angle - previous) * ratio;
    }
  });
  return result;
}

// --- Iterative loop-closing solver ------------------------------------------
//
// Spanning-tree folding cannot close cyclic crease loops, leaving gaps at
// multi-crease vertices. This refines it: weld every FOLD vertex to a single
// position (initialized from the spanning-tree fold) and run Gauss-Seidel
// distance-constraint projection over a bar network (every edge + every
// in-face diagonal => rest length from the flat pattern). The fold shape is
// carried by the initial guess; relaxation removes the seam gaps while keeping
// faces rigid. The fixed reference face is pinned to anchor the result.

// Solver diagnostic, mirroring the captured runtime's OPERATION_WARNING_*
// vocabulary. Over-constrained closure seams that cannot be satisfied rigidly
// surface here the way the reference reports CONVERGED_UNSOLVED.
export type FoldWarning = {
  code: "OPERATION_WARNING_CONVERGED_UNSOLVED";
  edge: [number, number];
  /** Relative edge-length error at the unresolved seam. */
  error: number;
  message: string;
};

export type WeldedFold = {
  /** One welded 3D position per FOLD vertex index. */
  positions: Vec3[];
  /** Per-vertex UV (empty entries default to [0, 0]). */
  uv: Array<[number, number]>;
  /** Triangle index triples into `positions`. */
  triangles: Array<[number, number, number]>;
  /** Max relative bar-length error after solving (rigidity quality, 0 = perfect). */
  rigidityError: number;
  /** Unresolved over-constrained seams (edges past the residual tolerance). */
  warnings: FoldWarning[];
  iterations: number;
};

/** Residual edge-error tolerance above which a seam is reported as unresolved. */
export const unresolvedSeamTolerance = 0.1;

type Bar = { i: number; j: number; rest: number };

function flatDist(model: FoldModel, a: number, b: number): number {
  const va = model.verticesCoords[a];
  const vb = model.verticesCoords[b];
  return Math.hypot(va[0] - vb[0], va[1] - vb[1]);
}

// BFS face order from the fixed reference face (matches foldFaces traversal).
function bfsFaceOrder(model: FoldModel): number[] {
  const order: number[] = [];
  const visited = new Array<boolean>(model.facesVertices.length).fill(false);
  const queue: number[] = [model.fixedFaceIndex];
  visited[model.fixedFaceIndex] = true;
  while (queue.length > 0) {
    const f = queue.shift() as number;
    order.push(f);
    for (const ei of model.facesEdges[f]) {
      for (const neighbor of model.edgeFaces[ei]) {
        if (!visited[neighbor]) {
          visited[neighbor] = true;
          queue.push(neighbor);
        }
      }
    }
  }
  for (let f = 0; f < model.facesVertices.length; f += 1) if (!visited[f]) order.push(f);
  return order;
}

// Welded seed for a fold state: each vertex takes the rigid position from the
// spanning-tree-earliest face that contains it.
function seedPositions(model: FoldModel, order: number[], creaseAnglesDeg: Record<number, number>): Vec3[] {
  const faces = foldFaces(model, creaseAnglesDeg);
  const faceByIndex = new Map<number, FoldedFace>();
  for (const face of faces) faceByIndex.set(face.faceIndex, face);
  const positions: Vec3[] = model.verticesCoords.map((v) => [v[0], v[1], 0]);
  const assigned = new Array<boolean>(model.verticesCoords.length).fill(false);
  for (const faceIndex of order) {
    const face = faceByIndex.get(faceIndex);
    if (!face) continue;
    model.facesVertices[faceIndex].forEach((vi, k) => {
      if (assigned[vi]) return;
      positions[vi] = [face.positions[k][0], face.positions[k][1], face.positions[k][2]];
      assigned[vi] = true;
    });
  }
  return positions;
}

export function foldWelded(
  model: FoldModel,
  creaseAnglesDeg: Record<number, number>,
  options: { steps?: number; iterations?: number; stiffness?: number; enforceCreaseAngles?: boolean } = {},
): WeldedFold {
  const steps = Math.max(1, options.steps ?? 48);
  const relaxIters = options.iterations ?? 60;
  const stiffness = options.stiffness ?? 1;
  const vertexCount = model.verticesCoords.length;
  const order = bfsFaceOrder(model);

  // Pin the fixed reference face's vertices to anchor position/orientation.
  const pinned = new Array<boolean>(vertexCount).fill(false);
  for (const vi of model.facesVertices[model.fixedFaceIndex]) pinned[vi] = true;

  // Bars: edges + in-face diagonals (dedup by vertex pair).
  const bars: Bar[] = [];
  const seen = new Set<string>();
  const addBar = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    bars.push({ i: a, j: b, rest: flatDist(model, a, b) });
  };
  for (const [a, b] of model.edgesVertices) addBar(a, b);
  // Fan-triangulation diagonals: keep every triangle rigid (so edge lengths are
  // preserved) while letting non-triangular faces flex slightly about a diagonal
  // -- which relieves the otherwise over-constrained loop closure (the reference
  // reports CONVERGED_UNSOLVED on those). The welded loop-closer is tuned to this
  // bar network; ear-clip diagonals are used for the rendered mesh display only.
  for (const loop of model.facesVertices) {
    for (let i = 2; i < loop.length - 1; i += 1) addBar(loop[0], loop[i]);
  }

  // Crease-angle constraints: drive each creased edge's dihedral to its target
  // (the reference enforces these as hard constraints; relying only on the
  // spanning-tree seed lets the fold drift off-target). For a hinge A-B shared
  // by two faces, an off-hinge vertex P (face 1) and Q (face 2) sit at fixed
  // perpendicular distances dp, dq from the hinge line and a fixed along-hinge
  // separation (h2). The dihedral then fixes |P-Q|, so we add it as a bar whose
  // rest length is recomputed from the (ramped) target fold angle each step.
  type CreaseSpec = { i: number; j: number; h2: number; dp: number; dq: number; edge: number };
  const creaseSpecs: CreaseSpec[] = [];
  const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const key of Object.keys(creaseAnglesDeg)) {
    const ei = Number(key);
    const faces = model.edgeFaces[ei];
    if (!faces || faces.length < 2) continue; // boundary crease has no dihedral
    const [a, b] = model.edgesVertices[ei];
    const p = model.facesVertices[faces[0]].find((v) => v !== a && v !== b);
    const q = model.facesVertices[faces[1]].find((v) => v !== a && v !== b);
    if (p === undefined || q === undefined) continue;
    const va = model.verticesCoords[a];
    const vb = model.verticesCoords[b];
    const flat = (vi: number): Vec3 => [model.verticesCoords[vi][0], model.verticesCoords[vi][1], 0];
    const A: Vec3 = [va[0], va[1], 0];
    const u = normalize([vb[0] - va[0], vb[1] - va[1], 0]);
    if (length(u) < EPS) continue;
    const perp = (vi: number) => {
      const rel = sub(flat(vi), A);
      const along = dot3(rel, u);
      const pp = sub(rel, [u[0] * along, u[1] * along, u[2] * along]);
      return { along, d: length(pp) };
    };
    const pp = perp(p);
    const qq = perp(q);
    creaseSpecs.push({ i: p, j: q, h2: (pp.along - qq.along) ** 2, dp: pp.d, dq: qq.d, edge: ei });
  }

  const relax = (positions: Vec3[], extra: Bar[]) => {
    for (let iter = 0; iter < relaxIters; iter += 1) {
      for (let b = 0; b < bars.length + extra.length; b += 1) {
        const bar = b < bars.length ? bars[b] : extra[b - bars.length];
        const pi = positions[bar.i];
        const pj = positions[bar.j];
        const dx = pj[0] - pi[0];
        const dy = pj[1] - pi[1];
        const dz = pj[2] - pi[2];
        const len = Math.hypot(dx, dy, dz);
        if (len < EPS) continue;
        const correction = (stiffness * (len - bar.rest)) / len;
        const pinI = pinned[bar.i];
        const pinJ = pinned[bar.j];
        if (pinI && pinJ) continue;
        const wI = pinI ? 0 : pinJ ? 1 : 0.5;
        const wJ = pinJ ? 0 : pinI ? 1 : 0.5;
        pi[0] += wI * correction * dx;
        pi[1] += wI * correction * dy;
        pi[2] += wI * correction * dz;
        pj[0] -= wJ * correction * dx;
        pj[1] -= wJ * correction * dy;
        pj[2] -= wJ * correction * dz;
      }
    }
  };

  // Crease bars for a given ramp factor (target fold angles scaled by `factor`).
  const creaseBarsFor = (factor: number): Bar[] =>
    creaseSpecs.map((c) => {
      const ang = (creaseAnglesDeg[c.edge] * factor * Math.PI) / 180;
      const rest = Math.sqrt(Math.max(0, c.h2 + c.dp * c.dp + c.dq * c.dq + 2 * c.dp * c.dq * Math.cos(ang)));
      return { i: c.i, j: c.j, rest };
    });

  // Incremental folding: advance the spanning-tree seed in small angle steps,
  // carry the welded state forward by each step's seed delta, then relax. Small
  // steps keep seam gaps tiny, so the state stays near-rigid and converges.
  const scale = (factor: number): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const [edge, angle] of Object.entries(creaseAnglesDeg)) out[Number(edge)] = angle * factor;
    return out;
  };

  const positions: Vec3[] = model.verticesCoords.map((v) => [v[0], v[1], 0]);
  let prevSeed = seedPositions(model, order, scale(0));
  for (let s = 1; s <= steps; s += 1) {
    const seed = seedPositions(model, order, scale(s / steps));
    for (let v = 0; v < vertexCount; v += 1) {
      if (pinned[v]) {
        positions[v] = [seed[v][0], seed[v][1], seed[v][2]];
      } else {
        positions[v][0] += seed[v][0] - prevSeed[v][0];
        positions[v][1] += seed[v][1] - prevSeed[v][1];
        positions[v][2] += seed[v][2] - prevSeed[v][2];
      }
    }
    // Crease-angle enforcement is opt-in: it drives target dihedrals (toward the
    // reference's hard-constraint behavior) but, on genuinely non-rigid patterns,
    // necessarily trades edge rigidity to chase the angles. The default keeps the
    // rigid, loop-closing behavior used by the renderer.
    relax(positions, options.enforceCreaseAngles ? creaseBarsFor(s / steps) : []);
    prevSeed = seed;
  }

  // Rigidity quality over real edges only; unresolved seams become warnings.
  let rigidityError = 0;
  const warnings: FoldWarning[] = [];
  for (const [a, b] of model.edgesVertices) {
    const rest = flatDist(model, a, b);
    if (rest < EPS) continue;
    const len = length(sub(positions[b], positions[a]));
    const error = Math.abs(len - rest) / rest;
    rigidityError = Math.max(rigidityError, error);
    if (error > unresolvedSeamTolerance) {
      warnings.push({
        code: "OPERATION_WARNING_CONVERGED_UNSOLVED",
        edge: [a, b],
        error,
        message: `Crease seam ${a}-${b} did not close rigidly (${(error * 100).toFixed(0)}% strain).`,
      });
    }
  }

  const triangles: Array<[number, number, number]> = [];
  for (const loop of model.facesVertices) {
    for (const t of triangulateFaceDelaunay(loop, model.verticesCoords)) triangles.push(t);
  }
  const uv: Array<[number, number]> = model.verticesCoords.map((_, vi) => {
    const t = model.verticesUv[vi];
    return t ? [t[0], t[1]] : [0, 0];
  });

  return { positions, uv, triangles, rigidityError, warnings, iterations: steps * relaxIters };
}

// --- 3D pipeline transforms (OPERATION_TRANSFORM_3D_*) ----------------------

function asVec3(a: number[] | undefined, fallback: Vec3): Vec3 {
  if (!a || a.length < 3) return fallback;
  return [a[0], a[1], a[2]];
}

/** Apply one pipeline transform to a point. */
function applyTransform(p: Vec3, t: FoldTransform): Vec3 {
  if (t.kind === "rotateAxisAngle") {
    const origin = asVec3(t.origin, [0, 0, 0]);
    const axis = normalize(asVec3(t.axis, [0, 1, 0]));
    if (length(axis) < EPS) return p;
    return rotateAboutLine(p, origin, axis, (t.angleDegrees * Math.PI) / 180);
  }
  if (t.kind === "translate") {
    const o = asVec3(t.offset, [0, 0, 0]);
    return [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
  }
  // rotateVectorToVector: rotate about the axis perpendicular to (from,to),
  // through the operation's origin (the reference's originPositionOrElement).
  const origin = asVec3(t.origin, [0, 0, 0]);
  const from = normalize(asVec3(t.from, [0, 0, 1]));
  const to = normalize(asVec3(t.to, [0, 0, 1]));
  const axis: Vec3 = [
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
  ];
  const axisLen = length(axis);
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  if (axisLen < EPS) {
    if (dot > 0) return p;
    const fallback: Vec3 = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perpendicular = normalize([
      from[1] * fallback[2] - from[2] * fallback[1],
      from[2] * fallback[0] - from[0] * fallback[2],
      from[0] * fallback[1] - from[1] * fallback[0],
    ]);
    return rotateAboutLine(p, origin, perpendicular, Math.PI);
  }
  return rotateAboutLine(p, origin, normalize(axis), Math.acos(dot));
}

/** Apply the ordered pipeline transforms to every position. */
export function applyTransforms(positions: Vec3[], transforms: FoldTransform[]): Vec3[] {
  if (transforms.length === 0) return positions;
  return positions.map((p) => transforms.reduce((acc, t) => applyTransform(acc, t), p));
}

export type SolveStatus = "Solved" | "Non-Rigid";

// Verbatim from the captured runtime's Folding Keyframe panel (Non-Rigid state).
// The reference says "creases", not "edges" -- the violated constraints are the
// per-crease target fold angles.
export const nonRigidMessage =
  "Some creases could not reach their target fold angles. This usually means the geometry cannot fold rigidly with the given angle constraints.";

// The fully-folded and per-keyframe Solve verdicts now come from the faithful
// constrained solve (foldConstrainedSolver `summarizeFolds`, run off-thread in
// foldStatusWorker), which tests isometry AND crease-angle targets like the
// reference's `isSolved`. The old welded-strain-only `summarizeFullFold` /
// `keyframeStatuses` helpers were removed: they ignored crease-angle violations
// (reporting "Solved" for folds that close geometrically but miss their angles)
// and fed a separate UI surface that could contradict the pill.

/** Axis-aligned bounding box of welded folded positions. */
export function weldedBounds(positions: Vec3[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let i = 0; i < 3; i += 1) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  return { min, max };
}

/** Axis-aligned bounding box of folded geometry (for camera framing/tests). */
export function foldedBounds(faces: FoldedFace[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const face of faces) {
    for (const p of face.positions) {
      for (let i = 0; i < 3; i += 1) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    }
  }
  return { min, max };
}
