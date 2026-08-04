// Curved-crease discretisation, matching the reference app's SVG import.
//
// A PackCAD dieline stores curved boundaries and creases as cubic Bezier edges
// (`edges_vertices` carries two control-point indices after its two endpoints).
// The reference does NOT fold those as straight chords: `Pattern2D.discretize-
// Curves(stepSize, maxDeviation)` walks each curve and drops interior vertices
// along it, so a curved crease has free vertices that can move as it folds.
//
// The reference's per-edge routine (CPIO_Edge2D.discretize) is a greedy
// arc-length walk with a straightness test, not a fixed subdivision count:
//
//     n     = ceil(edgeArcLength / stepSize)      // stepSize = 1/8 in
//     step  = edgeArcLength / n
//     lut   = bezier.getLUT(n * 3)
//     walk the LUT accumulating chord distance from the last emitted vertex:
//       - under one `step` of arc         -> keep walking
//       - still within maxDeviation of the ray (anchor + tangent * walked)
//                                          -> keep walking (the curve is
//                                             locally straight, no vertex here)
//       - otherwise                        -> emit a vertex at exactly one
//                                             `step` of arc length, re-anchor
//                                             there and re-read the tangent
//     stop once the walk comes within step/2 of the far endpoint.
//
// This reproduces the reference's own graph exactly. Verified against a live
// capture of its `__endingGraph` for the bundled pillow box: all 176 vertices
// land within 0.05px, including the two properties no fixed-count rule can
// produce -- cells whose curve is straight enough to receive no vertex at all,
// and the asymmetry between the two ends of a nearly-symmetric arc (its first
// cell is cut at t = 1/3, 2/3 while the mirroring last cell is cut at 2/5,
// 11/15, because the walk runs from one end).

import type { FoldModel } from "./foldGeometry";

/** SVG user units per inch (CPIO_DEFAULT_SVG_PPI). Dieline coordinates are in
 *  this frame, so the reference's inch-denominated tolerances convert directly. */
const SVG_PPI = 72;
/** DEFAULT_SVG_IMPORT_CURVE_DISCRETIZATION_STEP_SIZE_IN = 1/8. */
const CURVE_STEP_SIZE_PX = (1 / 8) * SVG_PPI;
/** DEFAULT_SVG_IMPORT_CURVE_DISCRETIZATION_MAX_DEVIATION_IN = 1/80. */
const CURVE_MAX_DEVIATION_PX = (1 / 80) * SVG_PPI;
const NUMERICAL_TOL = 1e-12;

// bezier-js uses 24-point Legendre-Gauss quadrature for `Bezier.length()`.
// Keeping these constants and operation order exact also preserves the emitted
// PVertex coordinate bits used later by cdt2d's cocircular tie-breaking.
const LEGENDRE_T = [
  -0.06405689286260563, 0.06405689286260563, -0.1911188674736163,
  0.1911188674736163, -0.3150426796961634, 0.3150426796961634,
  -0.4337935076260451, 0.4337935076260451, -0.5454214713888396,
  0.5454214713888396, -0.6480936519369755, 0.6480936519369755,
  -0.7401241915785544, 0.7401241915785544, -0.820001985973903,
  0.820001985973903, -0.8864155270044011, 0.8864155270044011,
  -0.9382745520027328, 0.9382745520027328, -0.9747285559713095,
  0.9747285559713095, -0.9951872199970213, 0.9951872199970213,
];
const LEGENDRE_C = [
  0.12793819534675216, 0.12793819534675216, 0.1258374563468283,
  0.1258374563468283, 0.12167047292780339, 0.12167047292780339,
  0.1155056680537256, 0.1155056680537256, 0.10744427011596563,
  0.10744427011596563, 0.09761865210411388, 0.09761865210411388,
  0.08619016153195327, 0.08619016153195327, 0.0733464814110803,
  0.0733464814110803, 0.05929858491543678, 0.05929858491543678,
  0.04427743881741981, 0.04427743881741981, 0.028531388628933663,
  0.028531388628933663, 0.0123412297999872, 0.0123412297999872,
];

type Point = [number, number];
type Cubic = [Point, Point, Point, Point];

function at(curve: Cubic, t: number): Point {
  const u = 1 - t;
  const [p0, p1, p2, p3] = curve;
  const u2 = u * u;
  const t2 = t * t;
  const b0 = u2 * u;
  const b1 = u2 * t * 3;
  const b2 = u * t2 * 3;
  const b3 = t * t2;
  return [
    b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
    b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
  ];
}

function tangentVectorAt(curve: Cubic, t: number): Point {
  const u = 1 - t;
  const [p0, p1, p2, p3] = curve;
  const u2 = u * u;
  const t2 = t * t;
  const b0 = u2;
  const b1 = u * t * 2;
  const b2 = t2;
  const d0: Point = [3 * (p1[0] - p0[0]), 3 * (p1[1] - p0[1])];
  const d1: Point = [3 * (p2[0] - p1[0]), 3 * (p2[1] - p1[1])];
  const d2: Point = [3 * (p3[0] - p2[0]), 3 * (p3[1] - p2[1])];
  const x = b0 * d0[0] + b1 * d1[0] + b2 * d2[0];
  const y = b0 * d0[1] + b1 * d1[1] + b2 * d2[1];
  return [x, y];
}

/** Unit tangent at `t` (the reference's endpoint secant / `bezier.derivative`). */
function tangentAt(curve: Cubic, t: number): Point {
  const [x, y] = tangentVectorAt(curve, t);
  const length = Math.hypot(x, y);
  return length < NUMERICAL_TOL ? [0, 0] : [x / length, y / length];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function arcLength(curve: Cubic): number {
  const z = 0.5;
  let sum = 0;
  for (let index = 0; index < LEGENDRE_T.length; index += 1) {
    const derivative = tangentVectorAt(curve, z * LEGENDRE_T[index] + z);
    sum += LEGENDRE_C[index] * Math.hypot(derivative[0], derivative[1]);
  }
  return z * sum;
}

/**
 * Parameters at which the reference drops interior vertices along `curve`.
 * Returns an empty list when the curve is straight enough to stay one edge.
 */
export function discretizeCurve(
  curve: Cubic,
  stepSizePx: number = CURVE_STEP_SIZE_PX,
  maxDeviationPx: number = CURVE_MAX_DEVIATION_PX,
): number[] {
  const total = arcLength(curve);
  if (total < NUMERICAL_TOL) return [];
  const step = total / Math.ceil(total / stepSizePx);
  const limit = maxDeviationPx * maxDeviationPx;
  // getLUT(n * 3) -- one sample per third of a step, plus the endpoint.
  const samples = Math.ceil(total / stepSizePx) * 3;
  const lut: Point[] = [];
  for (let i = 0; i <= samples; i += 1) lut.push(at(curve, i / samples));

  const end = curve[3];
  const cuts: number[] = [];
  let tangent = tangentAt(curve, 0);
  let anchor = lut[0];
  let previous = lut[0];
  let previousT = 0;
  let walked = 0;
  let walkedBefore = 0;

  for (let i = 1; i <= samples; i += 1) {
    const point = lut[i];
    if (distance(point, end) < step / 2) break;
    const span = distance(point, previous);
    walkedBefore = walked;
    walked += span;
    const t = i / samples;
    // not yet a full step of arc away from the last vertex
    if (walked < step) {
      previous = point;
      previousT = t;
      continue;
    }
    // still tracking the straight ray we set off along -- no vertex needed
    const rayX = anchor[0] + tangent[0] * walked;
    const rayY = anchor[1] + tangent[1] * walked;
    if ((rayX - point[0]) ** 2 + (rayY - point[1]) ** 2 < limit) {
      previous = point;
      previousT = t;
      continue;
    }
    // emit -- back up to exactly one step of arc unless we already overshot
    let cut: number;
    let position: Point;
    if (walkedBefore > step) {
      cut = previousT;
      position = previous;
    } else {
      const fraction = 1 - (walked - step) / span;
      cut = previousT + fraction * (t - previousT);
      position = at(curve, cut);
    }
    cuts.push(cut);
    tangent = tangentAt(curve, cut);
    anchor = position;
    previous = position;
    previousT = cut;
    walked = 0;
    walkedBefore = 0;
  }
  return cuts;
}

/** de Casteljau: the sub-curve of `curve` over [t0, t1]. */
function subCurve(curve: Cubic, t0: number, t1: number): Cubic {
  const split = (c: Cubic, t: number): { left: Cubic; right: Cubic } => {
    const lerp = (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const [p0, p1, p2, p3] = c;
    const a = lerp(p0, p1);
    const b = lerp(p1, p2);
    const cc = lerp(p2, p3);
    const d = lerp(a, b);
    const e = lerp(b, cc);
    const f = lerp(d, e);
    return { left: [p0, a, d, f], right: [f, e, cc, p3] };
  };
  const right = split(curve, t0).right;
  const remapped = t1 >= 1 ? 1 : (t1 - t0) / (1 - t0);
  return split(right, remapped).left;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function planarUvForPoint(model: FoldModel, point: Point): Point | null {
  if (model.verticesUv.length !== model.verticesCoords.length) return null;
  const result: Point = [0, 0];
  for (const axis of [0, 1] as const) {
    let minPosition = Infinity;
    let maxPosition = -Infinity;
    let minUv = Infinity;
    let maxUv = -Infinity;
    let covariance = 0;
    let meanPosition = 0;
    let meanUv = 0;
    let count = 0;
    for (let index = 0; index < model.verticesCoords.length; index += 1) {
      const position = model.verticesCoords[index]?.[axis];
      const uv = model.verticesUv[index]?.[axis];
      if (!Number.isFinite(position) || !Number.isFinite(uv)) continue;
      minPosition = Math.min(minPosition, position);
      maxPosition = Math.max(maxPosition, position);
      minUv = Math.min(minUv, uv);
      maxUv = Math.max(maxUv, uv);
      meanPosition += position;
      meanUv += uv;
      count += 1;
    }
    if (count < 2 || maxPosition <= minPosition || maxUv < minUv) return null;
    meanPosition /= count;
    meanUv /= count;
    for (let index = 0; index < model.verticesCoords.length; index += 1) {
      const position = model.verticesCoords[index]?.[axis];
      const uv = model.verticesUv[index]?.[axis];
      if (!Number.isFinite(position) || !Number.isFinite(uv)) continue;
      covariance += (position - meanPosition) * (uv - meanUv);
    }
    const fraction = (point[axis] - minPosition) / (maxPosition - minPosition);
    result[axis] = covariance >= 0
      ? minUv + fraction * (maxUv - minUv)
      : maxUv - fraction * (maxUv - minUv);
  }
  return result;
}

/**
 * Discretise every curved edge into straight pieces, rewriting vertices, edges,
 * face loops and the keyframes' crease targets to match. Straight edges and
 * models without control points are returned untouched.
 */
export function subdivideCurvedEdges(model: FoldModel): FoldModel {
  const controlPoints = model.edgeControlPoints;
  if (!controlPoints || controlPoints.length === 0) return model;

  const vertices: number[][] = model.verticesCoords.map((v) => v.slice());
  const verticesIDs = model.verticesIDs.slice();
  const verticesUv = model.verticesUv.map((v) => v.slice());
  /** old edge index -> the ordered vertex chain replacing it (from v0 to v1). */
  const chains = new Map<number, number[]>();
  /** old edge index -> the control points of each piece, in the same order. */
  const pieceControls = new Map<number, number[][][]>();

  model.edgesVertices.forEach(([v0, v1], edge) => {
    const handles = controlPoints[edge];
    if (!handles || handles.length < 2) return;
    const curve: Cubic = [
      [model.verticesCoords[v0][0], model.verticesCoords[v0][1]],
      [handles[0][0], handles[0][1]],
      [handles[1][0], handles[1][1]],
      [model.verticesCoords[v1][0], model.verticesCoords[v1][1]],
    ];
    const cuts = discretizeCurve(curve);
    if (cuts.length === 0) return;

    const chain = [v0];
    for (const t of cuts) {
      const point = at(curve, t);
      chain.push(vertices.length);
      vertices.push([point[0], point[1]]);
      verticesIDs.push("");
      if (verticesUv.length > 0) {
        const projectedUv = planarUvForPoint(model, point);
        const startUv = model.verticesUv[v0] ?? [0, 0];
        const endUv = model.verticesUv[v1] ?? startUv;
        verticesUv.push(projectedUv ?? [
          startUv[0] + (endUv[0] - startUv[0]) * t,
          startUv[1] + (endUv[1] - startUv[1]) * t,
        ]);
      }
    }
    chain.push(v1);
    chains.set(edge, chain);

    const bounds = [0, ...cuts, 1];
    pieceControls.set(
      edge,
      bounds.slice(0, -1).map((start, index) => {
        const piece = subCurve(curve, start, bounds[index + 1]);
        return [piece[1].slice(), piece[2].slice()];
      }),
    );
  });

  if (chains.size === 0) return model;

  // ---- rebuild the edge list, remembering where each old edge went ----------
  const edgesVertices: Array<[number, number]> = [];
  const edgesAssignment: string[] = [];
  const edgeControlPoints: number[][][] = [];
  const piecesOfEdge = new Map<number, number[]>();

  model.edgesVertices.forEach(([v0, v1], edge) => {
    const chain = chains.get(edge);
    const assignment = model.edgesAssignment[edge] ?? "U";
    if (!chain) {
      piecesOfEdge.set(edge, [edgesVertices.length]);
      edgesVertices.push([v0, v1]);
      edgesAssignment.push(assignment);
      edgeControlPoints.push((controlPoints[edge] ?? []).map((p) => p.slice()));
      return;
    }
    const controls = pieceControls.get(edge) ?? [];
    const produced: number[] = [];
    for (let i = 0; i + 1 < chain.length; i += 1) {
      produced.push(edgesVertices.length);
      edgesVertices.push([chain[i], chain[i + 1]]);
      edgesAssignment.push(assignment);
      edgeControlPoints.push((controls[i] ?? []).map((p) => p.slice()));
    }
    piecesOfEdge.set(edge, produced);
  });

  const edgeIndexByPair = new Map<string, number>();
  edgesVertices.forEach(([a, b], index) => edgeIndexByPair.set(edgeKey(a, b), index));

  // ---- expand the face loops over the new vertices --------------------------
  const facesVertices = model.facesVertices.map((loop) => {
    const expanded: number[] = [];
    for (let i = 0; i < loop.length; i += 1) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      expanded.push(a);
      const edge = model.edgesVertices.findIndex(([x, y]) =>
        (x === a && y === b) || (x === b && y === a));
      const chain = edge >= 0 ? chains.get(edge) : undefined;
      if (!chain) continue;
      const interior = chain.slice(1, -1);
      expanded.push(...(chain[0] === a ? interior : interior.slice().reverse()));
    }
    return expanded;
  });

  const facesEdges = facesVertices.map((loop) => {
    const edges: number[] = [];
    for (let i = 0; i < loop.length; i += 1) {
      const index = edgeIndexByPair.get(edgeKey(loop[i], loop[(i + 1) % loop.length]));
      if (index !== undefined) edges.push(index);
    }
    return edges;
  });

  const edgeFaces: number[][] = edgesVertices.map(() => []);
  facesEdges.forEach((edges, face) => {
    for (const edge of edges) if (!edgeFaces[edge].includes(face)) edgeFaces[edge].push(face);
  });

  // ---- carry each keyframe's crease targets onto every piece ----------------
  const keyframes = model.keyframes.map((keyframe) => {
    const creaseAnglesDeg: Record<number, number> = {};
    const creaseEdgeGroup: Record<number, number> = {};
    for (const [key, angle] of Object.entries(keyframe.creaseAnglesDeg)) {
      for (const piece of piecesOfEdge.get(Number(key)) ?? []) creaseAnglesDeg[piece] = angle;
    }
    for (const [key, group] of Object.entries(keyframe.creaseEdgeGroup)) {
      for (const piece of piecesOfEdge.get(Number(key)) ?? []) creaseEdgeGroup[piece] = group;
    }
    return { ...keyframe, creaseAnglesDeg, creaseEdgeGroup };
  });

  return {
    ...model,
    verticesCoords: vertices,
    verticesIDs,
    verticesUv,
    edgesVertices,
    edgesAssignment,
    edgeControlPoints,
    facesVertices,
    facesEdges,
    edgeFaces,
    keyframes,
  };
}
