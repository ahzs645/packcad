// Curved-crease subdivision, matching the reference app's SVG import.
//
// A PackCAD dieline stores curved boundaries and creases as cubic Bezier edges
// (`edges_vertices` carries two control-point indices after its two endpoints).
// The reference does NOT fold those as straight chords: its importer flattens
// each curve into several straight edges before building the graph, so a curved
// crease has interior vertices that are free to move.
//
// Measured against the reference's own graph for the bundled pillow box (its
// `verticesAdded` list is the post-subdivision vertex list):
//
//     FOLD document : 88 vertices, 154 edges, 88 of them curved
//     reference     : 176 vertices, 242 edges
//     difference    : +88 vertices, +88 edges
//
// and per curve, grouped by how many straight pieces it became:
//
//     1 piece  : 16 curves, chord deviation 0.309 .. 0.323
//     2 pieces : 56 curves, chord deviation 0.322 .. 0.723
//     3 pieces : 16 curves, chord deviation 1.515 .. 1.518
//
// so the piece count follows the curve's deviation from its chord, not its
// length (same-length curves take different counts), and the cut points sit at
// equal ARC LENGTH along the curve rather than at equal parameter -- the
// observed parameters are 1/3, 2/5, 1/2, 2/3, 3/4 for curves whose
// parameterisation is non-uniform.
//
// Splitting a curve into n pieces divides its sagitta by about n^2, so the
// reference's counts are reproduced by n = ceil(sqrt(sagitta / tolerance)).
//
// This lands the pillow box exactly (176 vertices / 242 edges, matching the
// reference) and the curved box within four vertices (198 vs its 202), whose
// folded size still agrees to 0.4% on every axis. No single tolerance satisfies
// both counts exactly -- the pillow box wants ~0.3225 and the curved box wants
// ~0.28..0.30 -- so the reference's tie-breaking at the boundary is slightly
// different from a plain ceil(); the chord-deviation mechanism itself is what
// matters here and is confirmed by both fixtures.

import type { FoldModel } from "./foldGeometry";

/** Chord-deviation tolerance in the model's coordinate unit (px for PackCAD
 *  dielines). Straddles the reference's measured 1-piece/2-piece boundary. */
const CHORD_DEVIATION_TOLERANCE = 0.3225;
/** Samples used for the arc-length table of each curve. */
const ARC_SAMPLES = 256;

type Point = [number, number];
type Cubic = [Point, Point, Point, Point];

function at(curve: Cubic, t: number): Point {
  const u = 1 - t;
  const [p0, p1, p2, p3] = curve;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  return [
    b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
    b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
  ];
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Largest perpendicular distance from the curve to its chord. */
function chordDeviation(curve: Cubic): number {
  const [p0, , , p3] = curve;
  const ax = p3[0] - p0[0];
  const ay = p3[1] - p0[1];
  const chord = Math.hypot(ax, ay);
  if (chord < 1e-12) return 0;
  let worst = 0;
  for (let i = 1; i < ARC_SAMPLES; i += 1) {
    const q = at(curve, i / ARC_SAMPLES);
    worst = Math.max(worst, Math.abs((q[0] - p0[0]) * ay - (q[1] - p0[1]) * ax) / chord);
  }
  return worst;
}

/** Parameters cutting the curve into `pieces` equal arc-length spans. */
function equalArcParameters(curve: Cubic, pieces: number): number[] {
  const cumulative: number[] = [0];
  let previous = at(curve, 0);
  for (let i = 1; i <= ARC_SAMPLES; i += 1) {
    const point = at(curve, i / ARC_SAMPLES);
    cumulative.push(cumulative[i - 1] + distance(previous, point));
    previous = point;
  }
  const total = cumulative[ARC_SAMPLES];
  const parameters: number[] = [];
  for (let piece = 1; piece < pieces; piece += 1) {
    const target = (total * piece) / pieces;
    let index = 1;
    while (index < ARC_SAMPLES && cumulative[index] < target) index += 1;
    const before = cumulative[index - 1];
    const span = cumulative[index] - before;
    const fraction = span > 1e-12 ? (target - before) / span : 0;
    parameters.push((index - 1 + fraction) / ARC_SAMPLES);
  }
  return parameters;
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

/**
 * Flatten every curved edge into straight pieces, rewriting vertices, edges,
 * face loops and the keyframes' crease targets to match. Straight edges and
 * models without control points are returned untouched.
 */
export function subdivideCurvedEdges(
  model: FoldModel,
  tolerance: number = CHORD_DEVIATION_TOLERANCE,
): FoldModel {
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
    const deviation = chordDeviation(curve);
    const pieces = Math.max(1, Math.ceil(Math.sqrt(deviation / tolerance)));
    if (pieces < 2) return;

    const cuts = equalArcParameters(curve, pieces);
    const chain = [v0];
    for (const t of cuts) {
      const point = at(curve, t);
      chain.push(vertices.length);
      vertices.push([point[0], point[1]]);
      verticesIDs.push("");
      if (verticesUv.length > 0) verticesUv.push([0, 0]);
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
