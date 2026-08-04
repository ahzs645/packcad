import { describe, expect, it } from "vitest";
import referenceFixture from "./fixtures/pillowBox.referenceParity.json";
import type { FoldModel } from "@packcad/format";
import {
  boundingExtent,
  foldNewton,
  foldNewtonSequence,
  foldNewtonStage,
  type NewtonFold,
} from "./foldNewtonSolver";
import {
  appendPriorTargets,
  measureCreaseAnglesDegrees,
  sourceStageConstraintAngles,
} from "./foldPlaybackConstraints";
import { createPillowBoxProject } from "./sample";
import type { Vec3 } from "./foldSolver";

type StateName = "K0" | "K1" | "K2";

type StateMetrics = {
  vertexRmsMm: number;
  vertexMaxMm: number;
  panelRmsMaxMm: number;
  panelNormalMaxDeg: number;
  creaseRmsDeg: number;
  creaseMaxDeg: number;
  activeCreaseMaxDeg: number;
  inactiveCreaseMaxDeg: number;
  /** Best-fit rigid rotation is diagnostic only; it never weakens the gate. */
  rigidFitRmsMm: number;
  rigidFitMaxMm: number;
  rigidRotationDeg: number;
  fixedVertexRmsMm: number;
  fixedVertexMaxMm: number;
  /** Error after aligning the fixed subset's own centroid. If this is zero,
   * pinned geometry is identical and its apparent error is whole-mesh drift. */
  fixedVertexCenteredRmsMm: number;
  fixedVertexCenteredMaxMm: number;
};

type StateReport = {
  metrics: StateMetrics;
  fold: Pick<NewtonFold, "iterations" | "energy" | "maxEdgeError" | "maxAngleErrorDeg" | "isSolved" | "stuck">;
  vertices: Array<{ vertex: number; id: string; errorMm: number }>;
  faces: Array<{
    face: number;
    id: string;
    vertexRmsMm: number;
    centroidErrorMm: number;
    normalErrorDeg: number;
  }>;
  creases: Array<{
    edge: number;
    vertices: string;
    faces: string;
    active: boolean;
    sourceDeg: number;
    localDeg: number;
    errorDeg: number;
  }>;
};

/**
 * Acceptance gate for reference-level parity. These are target tolerances, not
 * snapshots of the current implementation. Keep them tight enough that a
 * visually meaningful end-cap drift cannot pass while allowing sub-pixel
 * numerical noise between the two solvers.
 */
const ACCEPTANCE: Record<StateName, Partial<StateMetrics>> = {
  K0: {
    vertexRmsMm: 0.002,
    vertexMaxMm: 0.005,
    panelRmsMaxMm: 0.005,
    panelNormalMaxDeg: 0.01,
    creaseMaxDeg: 0.01,
  },
  K1: {
    vertexRmsMm: 0.05,
    vertexMaxMm: 0.15,
    panelRmsMaxMm: 0.15,
    panelNormalMaxDeg: 0.25,
    creaseRmsDeg: 0.10,
    creaseMaxDeg: 0.50,
    activeCreaseMaxDeg: 0.10,
    inactiveCreaseMaxDeg: 0.50,
  },
  K2: {
    vertexRmsMm: 0.05,
    vertexMaxMm: 0.15,
    panelRmsMaxMm: 0.15,
    panelNormalMaxDeg: 0.25,
    creaseRmsDeg: 0.10,
    creaseMaxDeg: 0.50,
    activeCreaseMaxDeg: 0.10,
    inactiveCreaseMaxDeg: 0.50,
  },
};

const INCH_TO_MM = 25.4;

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function centroid(points: Vec3[]): Vec3 {
  const total: Vec3 = [0, 0, 0];
  for (const point of points) {
    total[0] += point[0];
    total[1] += point[1];
    total[2] += point[2];
  }
  return total.map((value) => value / points.length) as Vec3;
}

function center(points: Vec3[]): Vec3[] {
  const origin = centroid(points);
  return points.map((point) => subtract(point, origin));
}

/** Horn's absolute-orientation fit. Returns source-space rotation only: the
 * caller has already removed translation, and scale is deliberately fixed. */
function bestFitRotation(local: Vec3[], source: Vec3[]): {
  positions: Vec3[];
  angleDeg: number;
} {
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let i = 0; i < local.length; i += 1) {
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        covariance[row][column] += local[i][row] * source[i][column];
      }
    }
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = covariance;
  const matrix = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const vectors = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => Number(row === column)),
  );
  // Symmetric Jacobi eigenvalue decomposition; the largest eigenvector is the
  // unit quaternion which minimizes squared point distance.
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let p = 0;
    let q = 1;
    let largest = 0;
    for (let row = 0; row < 4; row += 1) {
      for (let column = row + 1; column < 4; column += 1) {
        const value = Math.abs(matrix[row][column]);
        if (value > largest) {
          largest = value;
          p = row;
          q = column;
        }
      }
    }
    if (largest < 1e-14) break;
    const angle = 0.5 * Math.atan2(2 * matrix[p][q], matrix[q][q] - matrix[p][p]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let k = 0; k < 4; k += 1) {
      if (k === p || k === q) continue;
      const mkp = matrix[k][p];
      const mkq = matrix[k][q];
      matrix[k][p] = matrix[p][k] = c * mkp - s * mkq;
      matrix[k][q] = matrix[q][k] = s * mkp + c * mkq;
    }
    const mpp = matrix[p][p];
    const mqq = matrix[q][q];
    const mpq = matrix[p][q];
    matrix[p][p] = c * c * mpp - 2 * s * c * mpq + s * s * mqq;
    matrix[q][q] = s * s * mpp + 2 * s * c * mpq + c * c * mqq;
    matrix[p][q] = matrix[q][p] = 0;
    for (let k = 0; k < 4; k += 1) {
      const vkp = vectors[k][p];
      const vkq = vectors[k][q];
      vectors[k][p] = c * vkp - s * vkq;
      vectors[k][q] = s * vkp + c * vkq;
    }
  }
  let largestIndex = 0;
  for (let i = 1; i < 4; i += 1) {
    if (matrix[i][i] > matrix[largestIndex][largestIndex]) largestIndex = i;
  }
  let [w, x, y, z] = vectors.map((row) => row[largestIndex]);
  const length = Math.hypot(w, x, y, z) || 1;
  [w, x, y, z] = [w / length, x / length, y / length, z / length];
  const rotate = ([px, py, pz]: Vec3): Vec3 => [
    (1 - 2 * (y * y + z * z)) * px + 2 * (x * y - z * w) * py + 2 * (x * z + y * w) * pz,
    2 * (x * y + z * w) * px + (1 - 2 * (x * x + z * z)) * py + 2 * (y * z - x * w) * pz,
    2 * (x * z - y * w) * px + 2 * (y * z + x * w) * py + (1 - 2 * (x * x + y * y)) * pz,
  ];
  return {
    positions: local.map(rotate),
    angleDeg: 2 * Math.acos(Math.min(1, Math.abs(w))) * 180 / Math.PI,
  };
}

/** PackCAD's authored rotate-Y-180 operation, plus points-to-inches. */
function toReferenceSpace(points: Vec3[]): Vec3[] {
  return points.map(([x, y, z = 0]) => [-x / 72, y / 72, -z / 72]);
}

function faceNormal(points: Vec3[], loop: number[]): Vec3 {
  // Newell's method is stable for the curved, multi-vertex pillow-box faces.
  const normal: Vec3 = [0, 0, 0];
  for (let i = 0; i < loop.length; i += 1) {
    const current = points[loop[i]];
    const next = points[loop[(i + 1) % loop.length]];
    normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
    normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
    normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return normalize(normal);
}

function angularDifferenceDegrees(a: number, b: number): number {
  let difference = a - b;
  while (difference > 180) difference -= 360;
  while (difference <= -180) difference += 360;
  return Math.abs(difference);
}

function rms(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
}

function referencePositions(model: FoldModel, state: StateName): Vec3[] {
  const sourcePositions = referenceFixture.states[state] as Vec3[];
  const positionById = new Map(
    referenceFixture.vertexIds.map((id, index) => [id, sourcePositions[index]]),
  );
  return model.verticesIDs.slice(0, model.verticesCoords.length).map((id) => {
    const position = positionById.get(id);
    if (!position) throw new Error(`Reference snapshot is missing vertex ${id}`);
    return position;
  });
}

function activeEdges(model: FoldModel, state: StateName): Set<number> {
  if (state === "K0") return new Set();
  const keyframeIndex = state === "K1" ? 0 : 1;
  const keyframe = model.keyframes[keyframeIndex];
  const includedKeyframes = keyframe.enforcePriorConstraints
    ? model.keyframes.slice(0, keyframeIndex + 1)
    : [keyframe];
  return new Set(
    includedKeyframes
      .flatMap((keyframe) => Object.keys(keyframe.creaseAnglesDeg).map(Number)),
  );
}

function localState(model: FoldModel, state: StateName): NewtonFold {
  if (state === "K0") {
    return {
      positions: model.verticesCoords.map(([x, y, z = 0]) => [x, y, z]),
      iterations: 0,
      maxEdgeError: 0,
      maxAngleErrorDeg: 0,
      converged: true,
      isSolved: true,
      energy: 0,
      stepSize: 0.9,
      stuck: false,
      branchSigns: {},
    };
  }
  return foldNewtonSequence(model, { uptoKeyframe: state === "K1" ? 0 : 1 });
}

function measureState(
  model: FoldModel,
  state: StateName,
  local = localState(model, state),
): StateReport {
  const localPositions = center(toReferenceSpace(local.positions));
  const sourcePositions = center(referencePositions(model, state));
  const vertexErrors = localPositions.map((point, index) => {
    const delta = subtract(point, sourcePositions[index]);
    return Math.hypot(delta[0], delta[1], delta[2]) * INCH_TO_MM;
  });

  const faceReports = model.facesVertices.map((face, faceIndex) => {
    const localNormal = faceNormal(localPositions, face);
    const sourceNormal = faceNormal(sourcePositions, face);
    const localCenter = centroid(face.map((vertex) => localPositions[vertex]));
    const sourceCenter = centroid(face.map((vertex) => sourcePositions[vertex]));
    const centerDelta = subtract(localCenter, sourceCenter);
    return {
      face: faceIndex,
      id: model.facesIDs[faceIndex] ?? "",
      vertexRmsMm: rms(face.map((vertex) => vertexErrors[vertex])),
      centroidErrorMm: Math.hypot(...centerDelta) * INCH_TO_MM,
      normalErrorDeg:
        Math.acos(Math.max(-1, Math.min(1, dot(localNormal, sourceNormal)))) * 180 / Math.PI,
    };
  });

  const sourceAngles = measureCreaseAnglesDegrees(model, sourcePositions, local.branchSigns);
  const localAngles = measureCreaseAnglesDegrees(model, localPositions, local.branchSigns);
  const active = activeEdges(model, state);
  const creaseReports = Object.keys(sourceAngles).map(Number).map((edge) => ({
    edge,
    vertices: model.edgesVertices[edge].map((vertex) => model.verticesIDs[vertex]).join(" ↔ "),
    faces: model.edgeFaces[edge].join(","),
    active: active.has(edge),
    sourceDeg: sourceAngles[edge],
    localDeg: localAngles[edge],
    errorDeg: angularDifferenceDegrees(localAngles[edge], sourceAngles[edge]),
  }));
  const activeErrors = creaseReports.filter(({ active }) => active).map(({ errorDeg }) => errorDeg);
  const inactiveErrors = creaseReports.filter(({ active }) => !active).map(({ errorDeg }) => errorDeg);
  const rigid = bestFitRotation(localPositions, sourcePositions);
  const rigidErrors = rigid.positions.map((point, index) => {
    const delta = subtract(point, sourcePositions[index]);
    return Math.hypot(...delta) * INCH_TO_MM;
  });
  const keyframeIndex = state === "K2" ? 1 : 0;
  const keyframe = model.keyframes[keyframeIndex];
  const fixedFaces = keyframe?.fixedFaceIndices.length
    ? keyframe.fixedFaceIndices
    : [model.fixedFaceIndex];
  const fixedVertices = [...new Set([
    ...fixedFaces.flatMap((face) => model.facesVertices[face]),
    ...(keyframe?.fixedVertexIndices ?? []),
  ])];
  const fixedErrors = fixedVertices.map((vertex) => vertexErrors[vertex]);
  const localFixedCentered = center(fixedVertices.map((vertex) => localPositions[vertex]));
  const sourceFixedCentered = center(fixedVertices.map((vertex) => sourcePositions[vertex]));
  const fixedCenteredErrors = localFixedCentered.map((point, index) => {
    const delta = subtract(point, sourceFixedCentered[index]);
    return Math.hypot(...delta) * INCH_TO_MM;
  });

  return {
    metrics: {
      vertexRmsMm: rms(vertexErrors),
      vertexMaxMm: Math.max(...vertexErrors),
      panelRmsMaxMm: Math.max(...faceReports.map(({ vertexRmsMm }) => vertexRmsMm)),
      panelNormalMaxDeg: Math.max(...faceReports.map(({ normalErrorDeg }) => normalErrorDeg)),
      creaseRmsDeg: rms(creaseReports.map(({ errorDeg }) => errorDeg)),
      creaseMaxDeg: Math.max(...creaseReports.map(({ errorDeg }) => errorDeg)),
      activeCreaseMaxDeg: activeErrors.length ? Math.max(...activeErrors) : 0,
      inactiveCreaseMaxDeg: inactiveErrors.length ? Math.max(...inactiveErrors) : 0,
      rigidFitRmsMm: rms(rigidErrors),
      rigidFitMaxMm: Math.max(...rigidErrors),
      rigidRotationDeg: rigid.angleDeg,
      fixedVertexRmsMm: rms(fixedErrors),
      fixedVertexMaxMm: Math.max(...fixedErrors),
      fixedVertexCenteredRmsMm: rms(fixedCenteredErrors),
      fixedVertexCenteredMaxMm: Math.max(...fixedCenteredErrors),
    },
    fold: {
      iterations: local.iterations,
      energy: local.energy,
      maxEdgeError: local.maxEdgeError,
      maxAngleErrorDeg: local.maxAngleErrorDeg,
      isSolved: local.isSolved,
      stuck: local.stuck,
    },
    vertices: vertexErrors
      .map((errorMm, vertex) => ({ vertex, id: model.verticesIDs[vertex], errorMm }))
      .sort((a, b) => b.errorMm - a.errorMm),
    faces: faceReports.sort((a, b) => b.vertexRmsMm - a.vertexRmsMm),
    creases: creaseReports.sort((a, b) => b.errorDeg - a.errorDeg),
  };
}

/** Continue K2 past the local plateau to the source's captured 117-cycle stop.
 * This is intentionally diagnostic: it distinguishes a premature stop from a
 * different constraint system/trajectory without changing solver behavior. */
function forcedK2Trajectory(
  model: FoldModel,
  sampleCycles: number[],
): Array<{ cycle: number; report: StateReport }> {
  const k1 = foldNewtonSequence(model, { uptoKeyframe: 0 });
  const keyframe = model.keyframes[1];
  const restPositions = k1.positions.map((position) => [...position] as Vec3);
  const targets = sourceStageConstraintAngles(
    model,
    keyframe,
    restPositions,
    appendPriorTargets({}, model.keyframes[0]),
    k1.branchSigns,
  );
  const requested = new Set(sampleCycles);
  const samples: Array<{ cycle: number; report: StateReport }> = [];
  let positions = restPositions;
  let stepSize = 0.9;
  let branchSigns = k1.branchSigns;
  const lastCycle = Math.max(...sampleCycles);
  for (let cycle = 1; cycle <= lastCycle; cycle += 1) {
    const fold = foldNewton(model, targets, {
      maxIterations: 1,
      seed: positions,
      restPositions,
      fixedFaceIndices: keyframe.fixedFaceIndices,
      fixedVertexIndices: keyframe.fixedVertexIndices,
      solvedEdgeIndices: Object.keys(keyframe.creaseAnglesDeg).map(Number),
      initialStepSize: stepSize,
      branchSigns,
      scale: boundingExtent(restPositions),
    });
    positions = fold.positions;
    stepSize = fold.stepSize;
    branchSigns = fold.branchSigns;
    if (requested.has(cycle)) {
      samples.push({
        cycle,
        report: measureState(model, "K2", { ...fold, iterations: cycle }),
      });
    }
    if (fold.stuck) {
      // Retrying a rejected step with identical positions, branch state, and
      // already-minimal line-search step is deterministic. Represent later
      // source-cycle checkpoints without spending ~100 dense solve attempts.
      for (const laterCycle of sampleCycles.filter((sample) => sample > cycle)) {
        samples.push({
          cycle: laterCycle,
          report: measureState(model, "K2", { ...fold, iterations: laterCycle }),
        });
      }
      break;
    }
  }
  return samples.sort((a, b) => a.cycle - b.cycle);
}

function sourceStateInSolverSpace(
  model: FoldModel,
  state: StateName,
  alignTo: Vec3[],
  fixedVertices: number[],
): Vec3[] {
  // Invert the authored rotate-Y-180 + points-to-inches transform used by the
  // parity comparison, then restore the solver's arbitrary translation by
  // aligning the stage's pinned subset.
  const positions = referencePositions(model, state).map(([x, y, z]) => [
    -x * 72,
    y * 72,
    -z * 72,
  ] as Vec3);
  const sourceFixedCenter = centroid(fixedVertices.map((vertex) => positions[vertex]));
  const localFixedCenter = centroid(fixedVertices.map((vertex) => alignTo[vertex]));
  const translation = subtract(localFixedCenter, sourceFixedCenter);
  return positions.map((position) => [
    position[0] + translation[0],
    position[1] + translation[1],
    position[2] + translation[2],
  ]);
}

function edgeNeighborhood(model: FoldModel, edges: number[]): number[] {
  return [...new Set(edges.flatMap((edge) => [
    ...model.edgesVertices[edge],
    ...model.edgeFaces[edge].flatMap((face) => model.facesVertices[face]),
  ]))];
}

function neighborhoodMetrics(report: StateReport, vertices: number[]): {
  vertices: number;
  rmsMm: number;
  maxMm: number;
} {
  const errorByVertex = new Map(report.vertices.map(({ vertex, errorMm }) => [vertex, errorMm]));
  const errors = vertices.map((vertex) => errorByVertex.get(vertex) ?? 0);
  return { vertices: vertices.length, rmsMm: rms(errors), maxMm: Math.max(...errors) };
}

describe("pillow-box PackCAD reference parity", () => {
  const model = createPillowBoxProject().foldModel;
  if (!model) throw new Error("Pillow-box fixture did not produce a fold model");
  const reports = new Map<StateName, StateReport>();
  const reportFor = (state: StateName): StateReport => {
    const cached = reports.get(state);
    if (cached) return cached;
    const report = measureState(model, state);
    reports.set(state, report);
    return report;
  };

  it("uses the exact captured source topology and stable vertex identities", () => {
    expect(referenceFixture.topology).toEqual({ vertices: 176, edges: 242, faces: 67 });
    expect(model.verticesCoords).toHaveLength(referenceFixture.topology.vertices);
    expect(model.edgesVertices).toHaveLength(referenceFixture.topology.edges);
    expect(model.facesVertices).toHaveLength(referenceFixture.topology.faces);
    expect(new Set(model.verticesIDs.slice(0, 176))).toEqual(new Set(referenceFixture.vertexIds));
  });

  it("classifies non-enforced prior targets as inactive/carried", () => {
    expect([...activeEdges(model, "K1")].sort((a, b) => a - b)).toEqual([54, 86, 159, 194]);
    expect([...activeEdges(model, "K2")].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it.each(["K0", "K1", "K2"] as const)(
    "%s geometry stays within the source-parity acceptance envelope",
    (state) => {
      const report = reportFor(state);
      const metrics = report.metrics;
      console.table({ [state]: { ...metrics, ...report.fold } });
      if (state !== "K0") {
        console.table(report.vertices.slice(0, 8));
        console.table(report.faces.slice(0, 8));
        console.table(report.creases.slice(0, 12));
      }
      for (const [metric, limit] of Object.entries(ACCEPTANCE[state])) {
        expect(
          metrics[metric as keyof StateMetrics],
          `${state} ${metric} exceeded its source-parity limit of ${limit}`,
        ).toBeLessThanOrEqual(limit);
      }
    },
    120_000,
  );

  it("isolates K2 start-state propagation from K2-specific solver error", () => {
    const localK1 = foldNewtonSequence(model, { uptoKeyframe: 0 });
    const keyframe = model.keyframes[1];
    const fixedFaces = keyframe.fixedFaceIndices.length
      ? keyframe.fixedFaceIndices
      : [model.fixedFaceIndex];
    const fixedVertices = [...new Set([
      ...fixedFaces.flatMap((face) => model.facesVertices[face]),
      ...keyframe.fixedVertexIndices,
    ])];
    const sourceK1 = sourceStateInSolverSpace(model, "K1", localK1.positions, fixedVertices);
    const startErrors = localK1.positions.map((point, vertex) => {
      const delta = subtract(point, sourceK1[vertex]);
      return Math.hypot(...delta) * INCH_TO_MM / 72;
    });
    const priorTargets = appendPriorTargets({}, model.keyframes[0]);
    const sourceStartTargets = sourceStageConstraintAngles(
      model,
      keyframe,
      sourceK1,
      priorTargets,
      localK1.branchSigns,
    );
    const sourceStartedK2 = foldNewtonStage(model, sourceStartTargets, {
      seed: sourceK1,
      fixedFaceIndices: keyframe.fixedFaceIndices,
      fixedVertexIndices: keyframe.fixedVertexIndices,
      solvedEdgeIndices: Object.keys(keyframe.creaseAnglesDeg).map(Number),
      branchSigns: localK1.branchSigns,
      scale: boundingExtent(sourceK1),
    });
    const normal = reportFor("K2");
    const sourceStarted = measureState(model, "K2", sourceStartedK2);
    const activeEdges = Object.keys(keyframe.creaseAnglesDeg).map(Number);
    const priorEdges = Object.keys(model.keyframes[0].creaseAnglesDeg).map(Number);
    const worstCarriedEdges = normal.creases
      .filter(({ active }) => !active)
      .slice(0, 12)
      .map(({ edge }) => edge);
    console.table({
      "K2 normal": {
        vertexRmsMm: normal.metrics.vertexRmsMm,
        vertexMaxMm: normal.metrics.vertexMaxMm,
        creaseRmsDeg: normal.metrics.creaseRmsDeg,
        iterations: normal.fold.iterations,
        energy: normal.fold.energy,
      },
      "K2 from source K1": {
        vertexRmsMm: sourceStarted.metrics.vertexRmsMm,
        vertexMaxMm: sourceStarted.metrics.vertexMaxMm,
        creaseRmsDeg: sourceStarted.metrics.creaseRmsDeg,
        iterations: sourceStarted.fold.iterations,
        energy: sourceStarted.fold.energy,
      },
      "local/source K1 start": {
        vertexRmsMm: rms(startErrors),
        vertexMaxMm: Math.max(...startErrors),
      },
    });
    console.table({
      "K2 active edges 0,1": neighborhoodMetrics(normal, edgeNeighborhood(model, activeEdges)),
      "K1 prior edges": neighborhoodMetrics(normal, edgeNeighborhood(model, priorEdges)),
      "worst carried edges": neighborhoodMetrics(normal, edgeNeighborhood(model, worstCarriedEdges)),
    });
    console.table(sourceStarted.vertices.slice(0, 8));
    console.table(sourceStarted.faces.slice(0, 8));
    console.table(sourceStarted.creases.slice(0, 12));
    expect(sourceStarted.metrics.vertexRmsMm).toBeTypeOf("number");
    expect(Number.isFinite(sourceStarted.metrics.vertexRmsMm)).toBe(true);
  }, 120_000);

  it("diagnoses whether K2's residual is caused by stopping before source cycle 117", () => {
    const samples = forcedK2Trajectory(model, [1, 19, 117]);
    console.table(Object.fromEntries(samples.map(({ cycle, report }) => [
      `cycle ${cycle}`,
      {
        vertexRmsMm: report.metrics.vertexRmsMm,
        vertexMaxMm: report.metrics.vertexMaxMm,
        rigidFitRmsMm: report.metrics.rigidFitRmsMm,
        creaseRmsDeg: report.metrics.creaseRmsDeg,
        energy: report.fold.energy,
        isSolved: report.fold.isSolved,
        stuck: report.fold.stuck,
      },
    ])));
    expect(samples.map(({ report }) => report.metrics.vertexRmsMm).every(Number.isFinite)).toBe(true);
  }, 120_000);
});
