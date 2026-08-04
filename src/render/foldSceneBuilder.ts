// Framework-agnostic builder that turns a FoldModel + fold state into all the
// geometry the views render: the per-face thickness shell (front/back/edge
// groups), a triangle->face map for raycast selection, cut + solid-crease +
// dashed-crease lines tagged per-edge, a locked/selected face tint, and a pick
// geometry for hover. BOTH the folded 3D view and the flat 2D view build from
// this so they agree by construction.

import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { triangulateFace } from "@atelier/geometry";
import type { FoldModel } from "@packcad/format";
import { applyTransforms, weldedBounds } from "@packcad/fold-solver";
import { solveFoldTimeline, type FoldTimelineSolve } from "@packcad/fold-solver";
import {
  offsetExtents,
  thicknessMillimetresToFoldUnits,
  type ThicknessOffsetDirection,
} from "@packcad/fold-solver";
import { panelColorForIndex, type EdgeColorMode, type PanelColorMode } from "./foldViewSettings";
import { lockedFaceSet, resolveEdgeStyle } from "./edgeStyle";

export type V3 = [number, number, number];
const v3add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const v3len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const v3dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const v3norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export type FacePointWeights = {
  vertexIndices: [number, number, number];
  weights: [number, number, number];
};

function bezierPoint(
  start: readonly number[],
  controls: readonly number[][],
  end: readonly number[],
  t: number,
): [number, number] {
  const points = [start, ...controls, end].map((point) => [point[0], point[1]]);
  for (let level = points.length - 1; level > 0; level -= 1) {
    for (let index = 0; index < level; index += 1) {
      points[index][0] += (points[index + 1][0] - points[index][0]) * t;
      points[index][1] += (points[index + 1][1] - points[index][1]) * t;
    }
  }
  return [points[0][0], points[0][1]];
}

export function facePointWeights(
  model: FoldModel,
  faceIndex: number,
  point: readonly [number, number],
  boundaryEdge?: readonly [number, number],
): FacePointWeights {
  const loop = model.facesVertices[faceIndex];
  const triangles = triangulateFace(loop, model.verticesCoords) as Array<[
    number,
    number,
    number,
  ]>;
  const weightsForTriangle = (
    indices: [number, number, number],
  ): FacePointWeights | null => {
    const [a, b, c] = indices.map((index) => model.verticesCoords[index]);
    const denominator =
      (b[1] - c[1]) * (a[0] - c[0])
      + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) <= 1e-9) return null;
    const wa = (
      (b[1] - c[1]) * (point[0] - c[0])
      + (c[0] - b[0]) * (point[1] - c[1])
    ) / denominator;
    const wb = (
      (c[1] - a[1]) * (point[0] - c[0])
      + (a[0] - c[0]) * (point[1] - c[1])
    ) / denominator;
    return { vertexIndices: indices, weights: [wa, wb, 1 - wa - wb] };
  };

  // A restored Bezier boundary lies just outside the straight chord used by
  // the fold solver. Map it through the triangle which owns that chord. Using
  // an arbitrary triangle elsewhere in the polygon extrapolates the point
  // across a deforming folded face and creates the long corner spikes visible
  // on the pillow box's thickness shell.
  if (boundaryEdge) {
    const [edgeA, edgeB] = boundaryEdge;
    const owner = triangles.find((triangle) =>
      triangle.includes(edgeA) && triangle.includes(edgeB));
    if (owner) {
      const result = weightsForTriangle(owner);
      if (result) return result;
    }
  }

  // General face points prefer the containing flat triangle. This keeps their
  // interpolation local when the panel is not perfectly rigid.
  for (const triangle of triangles) {
    const result = weightsForTriangle(triangle);
    if (
      result
      && result.weights.every((weight) => weight >= -1e-9 && weight <= 1 + 1e-9)
    ) {
      return result;
    }
  }
  for (const triangle of triangles) {
    const result = weightsForTriangle(triangle);
    if (result) return result;
  }
  const fallback = loop[0] ?? 0;
  return {
    vertexIndices: [fallback, fallback, fallback],
    weights: [1, 0, 0],
  };
}

function weightedV3(
  positions: V3[],
  vertexIndices: [number, number, number],
  weights: [number, number, number],
): V3 {
  const a = positions[vertexIndices[0]];
  const b = positions[vertexIndices[1]];
  const c = positions[vertexIndices[2]];
  return [
    a[0] * weights[0] + b[0] * weights[1] + c[0] * weights[2],
    a[1] * weights[0] + b[1] * weights[1] + c[1] * weights[2],
    a[2] * weights[0] + b[2] * weights[1] + c[2] * weights[2],
  ];
}

const SCENE_EXTENT = 3; // post-normalization target span (foldSceneFrame scales to this)
// The live renderer displays the nominal board thickness with a narrower shell
// than a literal FOLD-unit extrusion. Keep the authored value unchanged in the
// inspector and calibrate only its viewport representation.
export const SOURCE_THICKNESS_DISPLAY_SCALE = 0.6;
const CREASE_LINE_SURFACE_OFFSET = 0.006; // line epsilon above the front slab surface
const LOCKED_TINT_OFFSET = 0.004; // tint sits under the lines, above the face
const SELECTED_TINT_OFFSET = 0.005;
const LOCKED_ICON_OFFSET = 0.012;
const EDGE_UV_REPEAT_PER_SCENE_UNIT = 4.5;
const MAX_HINGE_MITER_RATIO = 2.5;
const CURVED_EDGE_SEGMENTS = 12;
const CLOSED_VERTICAL_SEAM_PAIR_DISTANCE = 0.19;

export type FoldProjection = "flat-2d" | "folded-3d";

export type FoldSceneInput = {
  model: FoldModel;
  projection: FoldProjection;
  foldStepIndex: number;
  foldAngle: number;
  thicknessMm: number;
  thicknessOffsetDirection?: ThicknessOffsetDirection;
  panelColorMode: PanelColorMode;
  edgeColorMode: EdgeColorMode;
  selectedFaceIndex?: number | null;
  /** Defaults: folded-3d -> true, flat-2d -> false (clean mid-surface dieline). */
  showThickness?: boolean;
  /** Persistent solver positions supplied by source-style replay. */
  foldPositions?: V3[];
  foldMaxEdgeError?: number;
  foldMaxAngleErrorDeg?: number;
};

export type FoldScenePositionInput = Pick<
  FoldSceneInput,
  | "foldStepIndex"
  | "foldAngle"
  | "foldPositions"
  | "foldMaxEdgeError"
  | "foldMaxAngleErrorDeg"
>;

type FoldVertexPositionRecipe =
  | {
      kind: "face";
      vertexIndex: number;
      faceIndex: number;
      normalOffset: number;
    }
  | {
      kind: "facePoint";
      vertexIndices: [number, number, number];
      weights: [number, number, number];
      faceIndex: number;
      normalOffset: number;
    }
  | {
      kind: "miter";
      vertexIndex: number;
      faceAIndex: number;
      faceBIndex: number;
      normalOffset: number;
    };

type FoldEdgePositionLayout = {
  edgeIndex: number;
  faceIndices: number[];
  frontAIndices: number[];
  frontBIndices: number[];
  pickPositionOffset: number;
  selectedPositionOffset: number;
  solidPositionOffset?: number;
  creasePositionOffset?: number;
  dashedPositionOffset?: number;
  dashedDistanceOffset?: number;
};

type FoldScenePositionLayout = {
  model: FoldModel;
  projection: FoldProjection;
  frame: ReturnType<typeof foldSceneFrame>;
  meshRecipes: FoldVertexPositionRecipe[];
  lockedTintRecipes: FoldVertexPositionRecipe[];
  lockedIconRecipes: FoldVertexPositionRecipe[];
  selectedTintRecipes: FoldVertexPositionRecipe[];
  edgeLayouts: FoldEdgePositionLayout[];
};

export type FoldSceneMeta = {
  edgeIndexCount: number;
  cutEdgeIndexCount: number;
  edgeVertexCount: number;
  interiorFoldHingeCount: number;
  foldHingeSidebandIndexCount: number;
  foldHingeCapIndexCount: number;
  /** Double-wall terminal corners closed by one continuous cut-face cap. */
  closedSeamEdgeCount: number;
  closedSeamCapIndexCount: number;
  thicknessOffsetDirection: ThicknessOffsetDirection;
  creaseLineCount: number;
  lockedFaceCount: number;
  flipAll: boolean;
  /** Physical board thickness after conversion into normalized scene units. */
  visualThickness: number;
};

export type FoldSceneData = {
  /** Faces: indexed, groups front=0, back=1, edge=2. position/uv/color attrs. */
  geometry: BufferGeometry;
  /** triangle id (in full index order) -> source fold face index, -1 for cut edges. */
  faceIndexByTriangle: Int32Array;
  /** translucent overlay of the locked faces' front triangles (null if none). */
  lockedTintGeometry: BufferGeometry | null;
  /** one screen-sized lock marker anchor per fixed panel. */
  lockedIconGeometry: BufferGeometry | null;
  selectedTintGeometry: BufferGeometry | null;
  /** cut boundaries, solid; LineSegments + vertex colors. */
  solidEdgeGeometry: BufferGeometry;
  /** solid crease edges; LineSegments + vertex colors. */
  creaseEdgeGeometry: BufferGeometry;
  /** dashed crease edges; LineSegments + vertex colors + lineDistance. */
  dashedEdgeGeometry: BufferGeometry;
  /** every edge as plain segments for raycast hover (position only). */
  edgePickGeometry: BufferGeometry;
  segmentEdgeIndex: Int32Array;
  /** edge index -> that edge's lifted segment positions, for the hover highlight. */
  positionsByEdge: Map<number, Float32Array>;
  timelineSolve: FoldTimelineSolve;
  bounds: { min: V3; max: V3 };
  frameScale: number;
  meta: FoldSceneMeta;
  /** Cached topology-to-source mapping used by updateFoldScenePositions. */
  positionLayout: FoldScenePositionLayout;
};

function hingeMiterPoint(
  base: V3,
  normalA: V3,
  normalB: V3,
  offset: number,
): V3 {
  if (Math.abs(offset) <= 1e-9) return base;
  const normalDot = Math.max(-0.999, Math.min(1, v3dot(normalA, normalB)));
  const normalSum = v3add(normalA, normalB);
  const denominator = Math.max(1e-3, 1 + normalDot);
  let displacement = v3scale(normalSum, offset / denominator);
  const maximumLength = Math.abs(offset) * MAX_HINGE_MITER_RATIO;
  const length = v3len(displacement);
  if (length > maximumLength) displacement = v3scale(displacement, maximumLength / length);
  return v3add(base, displacement);
}

/**
 * Cross-section of a squared crease-end cap. The two offset face planes meet
 * at a bisector miter; at a 90° fold this is the fourth corner of a square.
 */
export function miteredHingeCapPoints(
  base: V3,
  normalA: V3,
  normalB: V3,
  frontOffset: number,
  backOffset: number,
): V3[] {
  const offsetPoint = (normal: V3, offset: number) => v3add(base, v3scale(normal, offset));
  const candidates = [
    offsetPoint(normalA, frontOffset),
    hingeMiterPoint(base, normalA, normalB, frontOffset),
    offsetPoint(normalB, frontOffset),
    offsetPoint(normalB, backOffset),
    hingeMiterPoint(base, normalA, normalB, backOffset),
    offsetPoint(normalA, backOffset),
  ];
  const points: V3[] = [];
  for (const point of candidates) {
    if (points.length === 0 || v3len(v3sub(point, points[points.length - 1])) > 1e-7) points.push(point);
  }
  if (points.length > 1 && v3len(v3sub(points[0], points[points.length - 1])) <= 1e-7) points.pop();
  return points;
}

function flatFoldPositions(model: FoldModel): V3[] {
  return model.verticesCoords.map(([x, y]) => [x, y, 0]);
}

/**
 * A model's `transforms` come from OPERATION_TRANSFORM_3D_* -- they orient the
 * package in 3D and must not reach the dieline. Every bundled document carries a
 * 180-degree rotation about Y, so applying it to the flat view mirrors the
 * dieline left-to-right against the SVG it was imported from (the reference
 * shows the pattern as authored).
 */
function orientedFor(projection: FoldProjection, positions: V3[], model: FoldModel): V3[] {
  return projection === "flat-2d" ? positions : applyTransforms(positions, model.transforms);
}

/**
 * Shared geometric frame so the flat 2D and folded 3D scenes use one scale.
 * The centre is per-projection: the transforms rotate about the origin, so the
 * oriented and un-oriented dielines have different centres even though their
 * extents (and therefore the scale) are identical.
 */
export function foldSceneFrame(model: FoldModel, projection: FoldProjection = "folded-3d") {
  const flat = orientedFor(projection, flatFoldPositions(model), model);
  const { min, max } = weldedBounds(flat);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-6);
  return {
    scale: SCENE_EXTENT / extent,
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ] as V3,
    extent,
  };
}

/** Scene-space width/height of the flat dieline (top-down xz plane), for ortho fit. */
export function flatSceneBounds(model: FoldModel): { width: number; height: number } {
  const frame = foldSceneFrame(model, "flat-2d");
  const oriented = orientedFor("flat-2d", flatFoldPositions(model), model);
  const xs = oriented.map((p) => (p[0] - frame.center[0]) * frame.scale);
  const zs = oriented.map((p) => (p[1] - frame.center[1]) * frame.scale);
  const width = Math.max(...xs) - Math.min(...xs) || 1;
  const height = Math.max(...zs) - Math.min(...zs) || 1;
  return { width, height };
}

export function buildFoldScene(input: FoldSceneInput): FoldSceneData {
  const {
    model,
    projection,
    foldStepIndex,
    foldAngle,
    thicknessMm,
    panelColorMode,
    edgeColorMode,
    selectedFaceIndex,
  } = input;
  const showThickness = input.showThickness ?? projection === "folded-3d";

  // --- positions: folded (3D) or flat (2D) ----------------------------------
  // The fold edge KIND (and thus the locked highlight) always tracks the active
  // fold step; only the vertex positions differ by projection.
  // Project replacement and worker completion happen on different React
  // frames. Ignore a stale position buffer from the previous project instead
  // of indexing it with the new model's vertex IDs.
  const suppliedFoldPositions = input.foldPositions?.length === model.verticesCoords.length
    ? input.foldPositions
    : undefined;
  const timelineSolve: FoldTimelineSolve = suppliedFoldPositions
    ? {
        positions: suppliedFoldPositions,
        creaseAnglesDeg: {},
        ratio: 0,
        method: "source-iterative",
        maxEdgeError: input.foldMaxEdgeError ?? 0,
        maxAngleErrorDeg: input.foldMaxAngleErrorDeg ?? 0,
      }
    : solveFoldTimeline(model, foldStepIndex, foldAngle);
  const foldPositions = projection === "flat-2d" ? flatFoldPositions(model) : timelineSolve.positions;
  const oriented = orientedFor(projection, foldPositions, model);

  const frame = foldSceneFrame(model, projection);
  const [cx, cy, cz] = frame.center;
  // Remap fold (x, y, z) -> scene (x, z_fold-as-height, y). The flat 2D view is
  // seen top-down (-y), which flips one screen axis; negate the depth axis there so
  // fold.y reads upright while keeping fold.x reading left-to-right.
  const depthSign = projection === "flat-2d" ? -1 : 1;
  const remap = (p: readonly [number, number, number]): V3 => [
    (p[0] - cx) * frame.scale,
    (p[2] - cz) * frame.scale,
    (p[1] - cy) * frame.scale * depthSign,
  ];
  const scenePositions = oriented.map(remap);

  const direction = input.thicknessOffsetDirection
    ?? ((model.thickness?.direction ?? "THICKNESS_OFFSET_DIRECTION_BOTH") as ThicknessOffsetDirection);
  // PackCAD extrudes by the physical thickness in the graph's own units, then
  // the viewport scales the whole graph. Do the same; the previous `/ 40`
  // shortcut made thickness depend on screen normalization and exaggerated
  // this px-based MailerBox by ~1.87×.
  const visualThickness = showThickness
    ? thicknessMillimetresToFoldUnits(thicknessMm, model.coordinateUnit)
      * frame.scale
      * SOURCE_THICKNESS_DISPLAY_SCALE
    : 0;
  const { front: fOff, back: bOff } = offsetExtents(visualThickness, direction);

  const positions: number[] = [];
  const meshRecipes: FoldVertexPositionRecipe[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const frontIndices: number[] = [];
  const frontHingeIndices: number[] = [];
  const backIndices: number[] = [];
  const backHingeIndices: number[] = [];
  const edgeIndices: number[] = [];
  const closedSeamCapIndices: number[] = [];
  let next = 0;
  const white = new Color("#ffffff");
  const faceColors = model.facesVertices.map((_, index) => new Color(panelColorForIndex(index)));
  const pushVert = (
    p: V3,
    uv: readonly [number, number],
    recipe: FoldVertexPositionRecipe,
    color = white,
  ): number => {
    positions.push(p[0], p[1], p[2]);
    meshRecipes.push(recipe);
    uvs.push(uv[0], uv[1]);
    colors.push(color.r, color.g, color.b);
    return next++;
  };
  const positionAt = (index: number): V3 => [
    positions[3 * index],
    positions[3 * index + 1],
    positions[3 * index + 2],
  ];
  const uvOf = (vi: number): [number, number] => {
    const t = model.verticesUv[vi];
    return t ? [t[0], t[1]] : [0, 0];
  };
  const facePoint = (
    faceIndex: number,
    flatPoint: readonly [number, number],
    normalOffset: number,
    boundaryEdge?: readonly [number, number],
  ): { position: V3; uv: [number, number]; recipe: FoldVertexPositionRecipe } => {
    const { vertexIndices, weights } = facePointWeights(
      model,
      faceIndex,
      flatPoint,
      boundaryEdge,
    );
    const position = weightedV3(scenePositions, vertexIndices, weights);
    const uvA = uvOf(vertexIndices[0]);
    const uvB = uvOf(vertexIndices[1]);
    const uvC = uvOf(vertexIndices[2]);
    return {
      position,
      uv: [
        uvA[0] * weights[0] + uvB[0] * weights[1] + uvC[0] * weights[2],
        uvA[1] * weights[0] + uvB[1] * weights[1] + uvC[1] * weights[2],
      ],
      recipe: {
        kind: "facePoint",
        vertexIndices,
        weights,
        faceIndex,
        normalOffset,
      },
    };
  };
  const faceNormal = (loop: number[]): V3 => {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const c = scenePositions[loop[i]];
      const d = scenePositions[loop[(i + 1) % loop.length]];
      nx += (c[1] - d[1]) * (c[2] + d[2]);
      ny += (c[2] - d[2]) * (c[0] + d[0]);
      nz += (c[0] - d[0]) * (c[1] + d[1]);
    }
    return v3norm([nx, ny, nz]);
  };

  // PackCAD's getOffsetPVertexPosition offsets each face-owned pVertex along
  // that face's own normal by exactly the requested front/back extent. Crease
  // bends are separate geometry there; averaging adjacent normals here used to
  // amplify exposed corners by as much as 2.9×.
  const rawNormals = model.facesVertices.map((loop) => faceNormal(loop));
  // Orientation comes straight from the FOLD model's globally-consistent winding,
  // which is FOLD-INVARIANT: a rigid fold can't change which side of the sheet is the
  // exterior. The flat 2D view renders the artwork correctly with no flip, so the
  // folded 3D view must use the same (no flip) to agree at every fold angle.
  //
  // Do NOT reintroduce a centroid-vs-folded-geometry flip: because it was computed
  // from the FOLDED positions it flipped the whole shell differently per keyframe
  // (correct at Setup, mirrored at Keyframe 1), since the box's centroid/normals only
  // diverge once it folds up. Winding is the only fold-stable source of truth.
  const flipAll = false;
  const faceFlipped: boolean[] = model.facesVertices.map(() => flipAll);
  const faceNormals = rawNormals.map((n) => (flipAll ? v3scale(n, -1) : n));

  // Per-face front/back vertex slabs + triangles.
  const faceData = model.facesVertices.map((loop, faceIndex) => {
    const nrm = faceNormals[faceIndex];
    const faceColor = panelColorMode === "multicolor" ? faceColors[faceIndex] : white;
    const front = new Map<number, number>();
    const back = new Map<number, number>();
    for (const vi of loop) {
      const base = scenePositions[vi] as V3;
      front.set(vi, pushVert(
        v3add(base, v3scale(nrm, fOff)),
        uvOf(vi),
        { kind: "face", vertexIndex: vi, faceIndex, normalOffset: fOff },
        faceColor,
      ));
      back.set(vi, pushVert(
        v3add(base, v3scale(nrm, bOff)),
        uvOf(vi),
        { kind: "face", vertexIndex: vi, faceIndex, normalOffset: bOff },
        faceColor,
      ));
    }
    const rawTris = triangulateFace(loop, model.verticesCoords);
    // Reverse winding when the face was flipped outward so FrontSide faces out.
    const tris: Array<[number, number, number]> = faceFlipped[faceIndex]
      ? rawTris.map(([a, b, c]) => [a, c, b])
      : rawTris;
    for (const [a, b, c] of tris) {
      frontIndices.push(front.get(a)!, front.get(b)!, front.get(c)!);
    }
    return { nrm, front, back, tris };
  });
  for (const face of faceData) {
    for (const [a, b, c] of face.tris) {
      backIndices.push(face.back.get(a)!, face.back.get(b)!, face.back.get(c)!);
    }
  }

  // PackCAD keeps Bézier control-point indices after each edge's two endpoint
  // indices. The fold solver correctly works on the endpoint topology, but the
  // visible shell must restore those curves or rounded lid ears become angular
  // chords. Add a rigid, face-owned curve patch outside the solver mesh and use
  // it for the printed face, cut outline, and corrugated sideband.
  type CurvedEdgeRender = {
    faceIndex: number;
    frontIndices: number[];
    backIndices: number[];
  };
  const curvedEdgeRender = new Map<number, CurvedEdgeRender>();
  const curvedPatchFaceIndices: number[] = [];
  if (projection === "folded-3d") model.edgeControlPoints?.forEach((controls, edgeIndex) => {
    if (controls.length === 0) return;
    const adjacentFaces = model.edgeFaces[edgeIndex] ?? [];
    if (adjacentFaces.length !== 1) return;
    const faceIndex = adjacentFaces[0];
    const face = faceData[faceIndex];
    const [va, vb] = model.edgesVertices[edgeIndex];
    const start = model.verticesCoords[va];
    const end = model.verticesCoords[vb];
    const flatPoints: Array<[number, number]> = [];
    for (let segment = 0; segment <= CURVED_EDGE_SEGMENTS; segment += 1) {
      flatPoints.push(bezierPoint(start, controls, end, segment / CURVED_EDGE_SEGMENTS));
    }
    const frontCurve: number[] = [];
    const backCurve: number[] = [];
    const faceColor = panelColorMode === "multicolor" ? faceColors[faceIndex] : white;
    flatPoints.forEach((flatPoint, index) => {
      if (index === 0) {
        frontCurve.push(face.front.get(va)!);
        backCurve.push(face.back.get(va)!);
        return;
      }
      if (index === flatPoints.length - 1) {
        frontCurve.push(face.front.get(vb)!);
        backCurve.push(face.back.get(vb)!);
        return;
      }
      const boundaryEdge = [va, vb] as const;
      const frontPoint = facePoint(faceIndex, flatPoint, fOff, boundaryEdge);
      const backPoint = facePoint(faceIndex, flatPoint, bOff, boundaryEdge);
      frontCurve.push(pushVert(
        v3add(frontPoint.position, v3scale(face.nrm, fOff)),
        frontPoint.uv,
        frontPoint.recipe,
        faceColor,
      ));
      backCurve.push(pushVert(
        v3add(backPoint.position, v3scale(face.nrm, bOff)),
        backPoint.uv,
        backPoint.recipe,
        faceColor,
      ));
    });
    const localLoop = flatPoints.map((_point, index) => index);
    const patchTriangles = triangulateFace(localLoop, flatPoints);
    for (const [a, b, c] of patchTriangles) {
      frontIndices.push(frontCurve[a], frontCurve[b], frontCurve[c]);
      backIndices.push(backCurve[a], backCurve[b], backCurve[c]);
      curvedPatchFaceIndices.push(faceIndex);
    }
    curvedEdgeRender.set(edgeIndex, {
      faceIndex,
      frontIndices: frontCurve,
      backIndices: backCurve,
    });
  });

  // Close exposed cut edges with the sideband texture (skipped when flat/no thickness).
  const edgeVertexStart = next;
  let interiorFoldHingeCount = 0;
  let foldHingeCapIndexCount = 0;
  type DynamicPoint = {
    position: V3;
    recipe: FoldVertexPositionRecipe;
  };
  const dynamicPointAt = (index: number): DynamicPoint => ({
    position: positionAt(index),
    recipe: meshRecipes[index],
  });
  const addEdgeQuad = (
    pVa: DynamicPoint,
    pVb: DynamicPoint,
    cVb: DynamicPoint,
    cVa: DynamicPoint,
    v0 = 0,
    v1 = 1,
    targetIndices = edgeIndices,
  ) => {
    const u1 = Math.max(
      1,
      v3len(v3sub(pVb.position, pVa.position)) * EDGE_UV_REPEAT_PER_SCENE_UNIT,
    );
    const a = pushVert(pVa.position, [0, v0], pVa.recipe);
    const b = pushVert(pVb.position, [u1, v0], pVb.recipe);
    const c = pushVert(cVb.position, [u1, v1], cVb.recipe);
    const d = pushVert(cVa.position, [0, v1], cVa.recipe);
    targetIndices.push(a, b, c, a, c, d);
  };
  const addHingeQuad = (
    target: number[],
    pVa: DynamicPoint,
    pVb: DynamicPoint,
    cVb: DynamicPoint,
    cVa: DynamicPoint,
    uvA: [number, number],
    uvB: [number, number],
    outward: V3,
  ) => {
    const a = pushVert(pVa.position, uvA, pVa.recipe);
    const b = pushVert(pVb.position, uvB, pVb.recipe);
    const c = pushVert(cVb.position, uvB, cVb.recipe);
    const d = pushVert(cVa.position, uvA, cVa.recipe);
    const normal = v3cross(
      v3sub(pVb.position, pVa.position),
      v3sub(cVb.position, pVa.position),
    );
    if (v3dot(normal, outward) >= 0) target.push(a, b, c, a, c, d);
    else target.push(a, c, b, a, d, c);
  };
  const addMiteredHingeStrip = (
    target: number[],
    va: number,
    vb: number,
    faceAIndex: number,
    faceBIndex: number,
    faceAEdge: { va: number; vb: number },
    faceBEdge: { va: number; vb: number },
    offset: number,
    normalA: V3,
    normalB: V3,
    outward: V3,
  ) => {
    if (Math.abs(offset) <= 1e-9) return;
    const miterVa = hingeMiterPoint(scenePositions[va] as V3, normalA, normalB, offset);
    const miterVb = hingeMiterPoint(scenePositions[vb] as V3, normalA, normalB, offset);
    const miterVaPoint: DynamicPoint = {
      position: miterVa,
      recipe: {
        kind: "miter",
        vertexIndex: va,
        faceAIndex,
        faceBIndex,
        normalOffset: offset,
      },
    };
    const miterVbPoint: DynamicPoint = {
      position: miterVb,
      recipe: {
        kind: "miter",
        vertexIndex: vb,
        faceAIndex,
        faceBIndex,
        normalOffset: offset,
      },
    };
    addHingeQuad(
      target,
      dynamicPointAt(faceAEdge.va),
      dynamicPointAt(faceAEdge.vb),
      miterVbPoint,
      miterVaPoint,
      uvOf(va), uvOf(vb), outward,
    );
    addHingeQuad(
      target,
      miterVaPoint,
      miterVbPoint,
      dynamicPointAt(faceBEdge.vb),
      dynamicPointAt(faceBEdge.va),
      uvOf(va), uvOf(vb), outward,
    );
  };
  const addMiteredHingeCap = (
    vertex: number,
    faceAIndex: number,
    faceBIndex: number,
    A: typeof faceData[number],
    B: typeof faceData[number],
  ) => {
    const base = scenePositions[vertex] as V3;
    const capPoints: DynamicPoint[] = [
      {
        position: v3add(base, v3scale(A.nrm, fOff)),
        recipe: { kind: "face", vertexIndex: vertex, faceIndex: faceAIndex, normalOffset: fOff },
      },
      {
        position: hingeMiterPoint(base, A.nrm, B.nrm, fOff),
        recipe: {
          kind: "miter",
          vertexIndex: vertex,
          faceAIndex,
          faceBIndex,
          normalOffset: fOff,
        },
      },
      {
        position: v3add(base, v3scale(B.nrm, fOff)),
        recipe: { kind: "face", vertexIndex: vertex, faceIndex: faceBIndex, normalOffset: fOff },
      },
      {
        position: v3add(base, v3scale(B.nrm, bOff)),
        recipe: { kind: "face", vertexIndex: vertex, faceIndex: faceBIndex, normalOffset: bOff },
      },
      {
        position: hingeMiterPoint(base, A.nrm, B.nrm, bOff),
        recipe: {
          kind: "miter",
          vertexIndex: vertex,
          faceAIndex,
          faceBIndex,
          normalOffset: bOff,
        },
      },
      {
        position: v3add(base, v3scale(A.nrm, bOff)),
        recipe: { kind: "face", vertexIndex: vertex, faceIndex: faceAIndex, normalOffset: bOff },
      },
    ];
    const capVertices = capPoints.map((point, index) =>
      pushVert(
        point.position,
        [index / Math.max(1, capPoints.length - 1), index === 0 ? 0 : 1],
        point.recipe,
      ));
    for (let index = 1; index < capVertices.length - 1; index += 1) {
      edgeIndices.push(capVertices[0], capVertices[index], capVertices[index + 1]);
    }
  };
  const replacedClosedSeamSidebandEdges = new Set<number>();
  if (showThickness && projection === "folded-3d") {
    const maximumCreaseIncidence = new Map<number, number>();
    for (let keyframeIndex = 0; keyframeIndex < Math.min(foldStepIndex, model.keyframes.length); keyframeIndex += 1) {
      const incidence = new Map<number, number>();
      for (const edgeKey of Object.keys(model.keyframes[keyframeIndex].creaseAnglesDeg)) {
        for (const faceIndex of model.edgeFaces[Number(edgeKey)] ?? []) {
          incidence.set(faceIndex, (incidence.get(faceIndex) ?? 0) + 1);
        }
      }
      for (const [faceIndex, count] of incidence) {
        maximumCreaseIncidence.set(
          faceIndex,
          Math.max(maximumCreaseIncidence.get(faceIndex) ?? 0, count),
        );
      }
    }
    const candidates = model.edgesVertices.flatMap(([va, vb], edgeIndex) => {
      const faces = model.edgeFaces[edgeIndex] ?? [];
      if (faces.length !== 1 || model.edgeControlPoints?.[edgeIndex]?.length) return [];
      const face = faceData[faces[0]];
      const a = dynamicPointAt(face.front.get(va)!);
      const b = dynamicPointAt(face.front.get(vb)!);
      const delta = v3sub(b.position, a.position);
      const length = v3len(delta);
      if (length <= 1e-6 || Math.abs(delta[1]) / length < 0.8) return [];
      return [{ edgeIndex, faceIndex: faces[0], a, b, length }];
    });
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      const first = candidates[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
        const second = candidates[secondIndex];
        if (first.faceIndex === second.faceIndex) continue;
        if (Math.abs(first.length - second.length) > Math.max(first.length, second.length) * 0.2) continue;
        const sameDirection = v3len(v3sub(first.a.position, second.a.position))
          + v3len(v3sub(first.b.position, second.b.position));
        const reverseDirection = v3len(v3sub(first.a.position, second.b.position))
          + v3len(v3sub(first.b.position, second.a.position));
        if (Math.min(sameDirection, reverseDirection) > CLOSED_VERTICAL_SEAM_PAIR_DISTANCE) continue;
        const firstIncidence = maximumCreaseIncidence.get(first.faceIndex) ?? 0;
        const secondIncidence = maximumCreaseIncidence.get(second.faceIndex) ?? 0;
        if (firstIncidence === secondIncidence || Math.max(firstIncidence, secondIncidence) < 2) continue;
        // The two walls form a double-wall rail. At its terminal corner the
        // source closes the entire rail with one kraft cut face; rendering each
        // board edge independently leaves a red slot between two tan ribbons.
        // Replace both individual sidebands with one bridge cap, retaining the
        // boundary outlines around that single continuous cut surface.
        replacedClosedSeamSidebandEdges.add(first.edgeIndex);
        replacedClosedSeamSidebandEdges.add(second.edgeIndex);
        const secondA = sameDirection <= reverseDirection ? second.a : second.b;
        const secondB = sameDirection <= reverseDirection ? second.b : second.a;
        addEdgeQuad(
          first.a,
          first.b,
          secondB,
          secondA,
          0,
          1,
          closedSeamCapIndices,
        );
      }
    }
  }
  if (showThickness) {
    const boundaryVertices = new Set<number>();
    for (let edgeIndex = 0; edgeIndex < model.edgesVertices.length; edgeIndex += 1) {
      if (model.edgeFaces[edgeIndex].length !== 1) continue;
      const [va, vb] = model.edgesVertices[edgeIndex];
      boundaryVertices.add(va);
      boundaryVertices.add(vb);
    }
    model.edgesVertices.forEach(([va, vb], ei) => {
      const fcs = model.edgeFaces[ei];
      if (fcs.length === 1) {
        if (replacedClosedSeamSidebandEdges.has(ei)) return;
        const A = faceData[fcs[0]];
        const curved = curvedEdgeRender.get(ei);
        if (curved) {
          for (let segment = 0; segment + 1 < curved.frontIndices.length; segment += 1) {
            addEdgeQuad(
              dynamicPointAt(curved.frontIndices[segment]),
              dynamicPointAt(curved.frontIndices[segment + 1]),
              dynamicPointAt(curved.backIndices[segment + 1]),
              dynamicPointAt(curved.backIndices[segment]),
            );
          }
          return;
        }
        const fa = A.front.get(va)!, fb = A.front.get(vb)!, ba = A.back.get(va)!, bb = A.back.get(vb)!;
        addEdgeQuad(
          dynamicPointAt(fa),
          dynamicPointAt(fb),
          dynamicPointAt(bb),
          dynamicPointAt(ba),
        );
      } else if (fcs.length === 2) {
        if (model.edgesAssignment[ei] === "B") return;
        interiorFoldHingeCount += 1;
        const A = faceData[fcs[0]];
        const B = faceData[fcs[1]];
        const outward = v3norm(v3add(A.nrm, B.nrm));
        const hingeOutward = v3len(outward) > 1e-6 ? outward : A.nrm;
        // PackCAD's bend-radius bridge reads as a warm compressed-board seam,
        // not an unprinted white face. We still build the front/back bridge
        // independently, but group both narrow strips with the edge material
        // below so artwork transparency cannot turn a folded hinge white.
        addMiteredHingeStrip(
          frontHingeIndices,
          va,
          vb,
          fcs[0],
          fcs[1],
          { va: A.front.get(va)!, vb: A.front.get(vb)! },
          { va: B.front.get(va)!, vb: B.front.get(vb)! },
          fOff,
          A.nrm,
          B.nrm,
          hingeOutward,
        );
        addMiteredHingeStrip(
          backHingeIndices,
          va,
          vb,
          fcs[0],
          fcs[1],
          { va: A.back.get(va)!, vb: A.back.get(vb)! },
          { va: B.back.get(va)!, vb: B.back.get(vb)! },
          bOff,
          A.nrm,
          B.nrm,
          hingeOutward,
        );
        // At a crease endpoint on the cut boundary, close only the wedge made
        // by the two faces adjacent to THIS crease. The old vertex-wide fan
        // connected every face that happened to share the vertex, which could
        // span across unrelated slots and overlap the printed board.
        for (const vertex of [va, vb]) {
          if (!boundaryVertices.has(vertex)) continue;
          const before = edgeIndices.length;
          addMiteredHingeCap(vertex, fcs[0], fcs[1], A, B);
          foldHingeCapIndexCount += edgeIndices.length - before;
        }
      }
    });
  }

  // Ground the geometry so its lowest point sits at y=0.
  const minY = positions.reduce((min, value, index) => (index % 3 === 1 ? Math.min(min, value) : min), Infinity);
  if (Number.isFinite(minY)) {
    for (let i = 1; i < positions.length; i += 3) positions[i] -= minY;
  }

  // --- unified edge lines ----------------------------------------------------
  const solidPos: number[] = [];
  const solidCol: number[] = [];
  const creasePos: number[] = [];
  const creaseCol: number[] = [];
  const dashedPos: number[] = [];
  const dashedCol: number[] = [];
  const dashedDist: number[] = [];
  const pickPos: number[] = [];
  const segmentEdgeIndex: number[] = [];
  const positionsByEdge = new Map<number, number[]>();
  const edgeLayouts: FoldEdgePositionLayout[] = [];
  const lift = CREASE_LINE_SURFACE_OFFSET;
  let creaseLineCount = 0;

  const addRenderedEdgeSegment = (
    ei: number,
    fcs: number[],
    frontAIndices: number[],
    frontBIndices: number[],
  ) => {
    if (fcs.length === 0) return;
    const style = resolveEdgeStyle(
      model,
      ei,
      foldStepIndex,
      edgeColorMode,
      projection,
      false,
      false,
    );
    const c = style.color ? new Color(style.color) : null;

    let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
    let nx = 0, ny = 0, nz = 0, count = 0;
    for (let faceOffset = 0; faceOffset < fcs.length; faceOffset += 1) {
      const faceIndex = fcs[faceOffset];
      const face = faceData[faceIndex];
      const aIndex = frontAIndices[faceOffset];
      const bIndex = frontBIndices[faceOffset];
      if (aIndex === undefined || bIndex === undefined) continue;
      const pa = positionAt(aIndex);
      const pb = positionAt(bIndex);
      ax += pa[0]; ay += pa[1]; az += pa[2];
      bx += pb[0]; by += pb[1]; bz += pb[2];
      nx += face.nrm[0]; ny += face.nrm[1]; nz += face.nrm[2];
      count += 1;
    }
    if (count === 0) return;
    const lifted = v3scale(v3norm([nx, ny, nz]), lift);
    const A = v3add([ax / count, ay / count, az / count] as V3, lifted);
    const B = v3add([bx / count, by / count, bz / count] as V3, lifted);

    const selectedEdgePositions = positionsByEdge.get(ei) ?? [];
    const edgeLayout: FoldEdgePositionLayout = {
      edgeIndex: ei,
      faceIndices: [...fcs],
      frontAIndices,
      frontBIndices,
      pickPositionOffset: pickPos.length,
      selectedPositionOffset: selectedEdgePositions.length,
    };
    pickPos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
    segmentEdgeIndex.push(ei);
    selectedEdgePositions.push(A[0], A[1], A[2], B[0], B[1], B[2]);
    positionsByEdge.set(ei, selectedEdgePositions);
    edgeLayouts.push(edgeLayout);

    if (!c) return;
    const isBoundary = model.edgesAssignment[ei] === "B" || fcs.length < 2;
    if (isBoundary) {
      edgeLayout.solidPositionOffset = solidPos.length;
      solidPos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      solidCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    } else if (style.dashed) {
      edgeLayout.dashedPositionOffset = dashedPos.length;
      edgeLayout.dashedDistanceOffset = dashedDist.length;
      dashedPos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      dashedCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      dashedDist.push(0, len);
      creaseLineCount += 1;
    } else {
      edgeLayout.creasePositionOffset = creasePos.length;
      creasePos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      creaseCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      creaseLineCount += 1;
    }
  };

  // ONE clean line per edge: average the adjacent faces' front-edge positions and
  // normals so a crease sits on the ridge instead of drawing a doubled line.
  // Curved cuts contribute one pick/render segment per sampled Bézier span.
  model.edgesVertices.forEach(([va, vb], ei) => {
    const fcs = model.edgeFaces[ei];
    if (fcs.length === 0) return;
    const curved = curvedEdgeRender.get(ei);
    if (curved) {
      for (let segment = 0; segment + 1 < curved.frontIndices.length; segment += 1) {
        addRenderedEdgeSegment(
          ei,
          [curved.faceIndex],
          [curved.frontIndices[segment]],
          [curved.frontIndices[segment + 1]],
        );
      }
      return;
    }
    addRenderedEdgeSegment(
      ei,
      fcs,
      fcs
        .map((faceIndex) => faceData[faceIndex].front.get(va))
        .filter((index): index is number => index !== undefined),
      fcs
        .map((faceIndex) => faceData[faceIndex].front.get(vb))
        .filter((index): index is number => index !== undefined),
    );
  });

  // --- locked / selected face tint overlays ---------------------------------
  const lockedFaces = lockedFaceSet(model, foldStepIndex);
  const buildTint = (
    faceFilter: (faceIndex: number) => boolean,
    tintLift: number,
  ): {
    geometry: BufferGeometry | null;
    recipes: FoldVertexPositionRecipe[];
  } => {
    const tintPos: number[] = [];
    const recipes: FoldVertexPositionRecipe[] = [];
    faceData.forEach((face, faceIndex) => {
      if (!faceFilter(faceIndex)) return;
      const liftV = v3scale(face.nrm, tintLift);
      for (const [a, b, c2] of face.tris) {
        for (const vi of [a, b, c2]) {
          const p = v3add(positionAt(face.front.get(vi)!), liftV);
          tintPos.push(p[0], p[1], p[2]);
          recipes.push({
            kind: "face",
            vertexIndex: vi,
            faceIndex,
            normalOffset: fOff + tintLift,
          });
        }
      }
    });
    if (tintPos.length === 0) return { geometry: null, recipes };
    const geom = new BufferGeometry();
    geom.setAttribute("position", new Float32BufferAttribute(tintPos, 3));
    geom.computeVertexNormals();
    return { geometry: geom, recipes };
  };
  // Selection replaces locked feedback instead of alpha-stacking two
  // triangulated overlays on the same panel.
  const lockedTint = buildTint(
    (fi) => lockedFaces.has(fi) && fi !== selectedFaceIndex,
    LOCKED_TINT_OFFSET,
  );
  const lockedIconPositions: number[] = [];
  const lockedIconRecipes: FoldVertexPositionRecipe[] = [];
  // A lock is an anchor, not a crease-participation badge. Keep markers on the
  // same fixed panels used by the operation solver so the UI never claims that
  // a moving terminal flap is locked.
  const lockedIconFaces = lockedFaces;
  for (const faceIndex of lockedIconFaces) {
    const face = faceData[faceIndex];
    if (!face || face.tris.length === 0) continue;
    let totalArea = 0;
    const flatCenter: [number, number] = [0, 0];
    for (const triangle of face.tris) {
      const [a, b, c] = triangle.map((index) => model.verticesCoords[index]);
      const area = Math.abs(
        (b[0] - a[0]) * (c[1] - a[1])
        - (b[1] - a[1]) * (c[0] - a[0]),
      );
      flatCenter[0] += ((a[0] + b[0] + c[0]) / 3) * area;
      flatCenter[1] += ((a[1] + b[1] + c[1]) / 3) * area;
      totalArea += area;
    }
    if (totalArea <= 1e-9) continue;
    flatCenter[0] /= totalArea;
    flatCenter[1] /= totalArea;
    const { vertexIndices, weights } = facePointWeights(model, faceIndex, flatCenter);
    // Emit an anchor just beyond each board surface. Depth testing selects the
    // one facing the camera and prevents icons on hidden panels showing through.
    for (const normalOffset of [
      fOff + LOCKED_ICON_OFFSET,
      bOff - LOCKED_ICON_OFFSET,
    ]) {
      const anchor = v3add(
        weightedV3(scenePositions, vertexIndices, weights),
        v3scale(face.nrm, normalOffset),
      );
      lockedIconPositions.push(anchor[0], anchor[1] - minY, anchor[2]);
      lockedIconRecipes.push({
        kind: "facePoint",
        vertexIndices,
        weights,
        faceIndex,
        normalOffset,
      });
    }
  }
  const lockedIconGeometry = lockedIconPositions.length > 0
    ? new BufferGeometry().setAttribute(
        "position",
        new Float32BufferAttribute(lockedIconPositions, 3),
      )
    : null;
  const selectedTint =
    selectedFaceIndex === null || selectedFaceIndex === undefined
      ? { geometry: null, recipes: [] }
      : buildTint((fi) => fi === selectedFaceIndex, SELECTED_TINT_OFFSET);

  // --- assemble face geometry -----------------------------------------------
  const indices = [
    ...frontIndices,
    ...backIndices,
    ...frontHingeIndices,
    ...backHingeIndices,
    ...edgeIndices,
    ...closedSeamCapIndices,
  ];
  // Triangle id -> source face index. Bend/cut closure geometry is not a
  // selectable panel, so those triangles deliberately map to -1.
  const faceIndexByTriangle: number[] = [];
  for (const [faceIndex, face] of faceData.entries()) {
    for (let index = 0; index < face.tris.length; index += 1) faceIndexByTriangle.push(faceIndex);
  }
  faceIndexByTriangle.push(...curvedPatchFaceIndices);
  for (const [faceIndex, face] of faceData.entries()) {
    for (let index = 0; index < face.tris.length; index += 1) faceIndexByTriangle.push(faceIndex);
  }
  faceIndexByTriangle.push(...curvedPatchFaceIndices);
  faceIndexByTriangle.push(...Array(frontHingeIndices.length / 3).fill(-1));
  faceIndexByTriangle.push(...Array(backHingeIndices.length / 3).fill(-1));
  faceIndexByTriangle.push(...Array(edgeIndices.length / 3).fill(-1));
  faceIndexByTriangle.push(...Array(closedSeamCapIndices.length / 3).fill(-1));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.clearGroups();
  const frontGroupCount = frontIndices.length;
  const backGroupCount = backIndices.length;
  const edgeGroupCount = frontHingeIndices.length + backHingeIndices.length + edgeIndices.length;
  geometry.addGroup(0, frontGroupCount, 0);
  geometry.addGroup(frontGroupCount, backGroupCount, 1);
  geometry.addGroup(frontGroupCount + backGroupCount, edgeGroupCount, 2);
  if (closedSeamCapIndices.length > 0) {
    geometry.addGroup(
      frontGroupCount + backGroupCount + edgeGroupCount,
      closedSeamCapIndices.length,
      3,
    );
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const bounds = {
    min: [box.min.x, box.min.y, box.min.z] as V3,
    max: [box.max.x, box.max.y, box.max.z] as V3,
  };

  const solidEdgeGeometry = new BufferGeometry();
  solidEdgeGeometry.setAttribute("position", new Float32BufferAttribute(solidPos, 3));
  solidEdgeGeometry.setAttribute("color", new Float32BufferAttribute(solidCol, 3));

  const creaseEdgeGeometry = new BufferGeometry();
  creaseEdgeGeometry.setAttribute("position", new Float32BufferAttribute(creasePos, 3));
  creaseEdgeGeometry.setAttribute("color", new Float32BufferAttribute(creaseCol, 3));

  const dashedEdgeGeometry = new BufferGeometry();
  dashedEdgeGeometry.setAttribute("position", new Float32BufferAttribute(dashedPos, 3));
  dashedEdgeGeometry.setAttribute("color", new Float32BufferAttribute(dashedCol, 3));
  dashedEdgeGeometry.setAttribute("lineDistance", new Float32BufferAttribute(dashedDist, 1));

  const edgePickGeometry = new BufferGeometry();
  edgePickGeometry.setAttribute("position", new Float32BufferAttribute(pickPos, 3));

  return {
    geometry,
    faceIndexByTriangle: Int32Array.from(faceIndexByTriangle),
    lockedTintGeometry: lockedTint.geometry,
    lockedIconGeometry,
    selectedTintGeometry: selectedTint.geometry,
    solidEdgeGeometry,
    creaseEdgeGeometry,
    dashedEdgeGeometry,
    edgePickGeometry,
    segmentEdgeIndex: Int32Array.from(segmentEdgeIndex),
    positionsByEdge: new Map(
      Array.from(positionsByEdge.entries()).map(([k, v]) => [k, new Float32Array(v)]),
    ),
    timelineSolve,
    bounds,
    frameScale: frame.scale,
    meta: {
      edgeIndexCount: edgeIndices.length + closedSeamCapIndices.length,
      cutEdgeIndexCount: edgeIndices.length + closedSeamCapIndices.length,
      edgeVertexCount: next - edgeVertexStart,
      interiorFoldHingeCount,
      foldHingeSidebandIndexCount: frontHingeIndices.length + backHingeIndices.length,
      foldHingeCapIndexCount,
      closedSeamEdgeCount: replacedClosedSeamSidebandEdges.size / 2,
      closedSeamCapIndexCount: closedSeamCapIndices.length,
      thicknessOffsetDirection: direction,
      creaseLineCount,
      lockedFaceCount: lockedFaces.size,
      flipAll,
      visualThickness,
    },
    positionLayout: {
      model,
      projection,
      frame,
      meshRecipes,
      lockedTintRecipes: lockedTint.recipes,
      lockedIconRecipes,
      selectedTintRecipes: selectedTint.recipes,
      edgeLayouts,
    },
  };
}

function writeRecipePosition(
  target: Float32Array,
  offset: number,
  recipe: FoldVertexPositionRecipe,
  scenePositions: V3[],
  faceNormals: V3[],
): void {
  const base = recipe.kind === "facePoint"
    ? weightedV3(scenePositions, recipe.vertexIndices, recipe.weights)
    : scenePositions[recipe.vertexIndex];
  let normal: V3;
  if (recipe.kind === "face" || recipe.kind === "facePoint") {
    normal = faceNormals[recipe.faceIndex];
  } else {
    const normalA = faceNormals[recipe.faceAIndex];
    const normalB = faceNormals[recipe.faceBIndex];
    const point = hingeMiterPoint(
      base,
      normalA,
      normalB,
      recipe.normalOffset,
    );
    target[offset] = point[0];
    target[offset + 1] = point[1];
    target[offset + 2] = point[2];
    return;
  }
  target[offset] = base[0] + normal[0] * recipe.normalOffset;
  target[offset + 1] = base[1] + normal[1] * recipe.normalOffset;
  target[offset + 2] = base[2] + normal[2] * recipe.normalOffset;
}

function updateRecipeGeometry(
  geometry: BufferGeometry | null,
  recipes: FoldVertexPositionRecipe[],
  scenePositions: V3[],
  faceNormals: V3[],
  groundOffset: number,
  computeNormals = true,
): void {
  if (!geometry) return;
  const attribute = geometry.getAttribute("position");
  const positions = attribute.array as Float32Array;
  for (let index = 0; index < recipes.length; index += 1) {
    const offset = index * 3;
    writeRecipePosition(
      positions,
      offset,
      recipes[index],
      scenePositions,
      faceNormals,
    );
    positions[offset + 1] -= groundOffset;
  }
  attribute.needsUpdate = true;
  if (computeNormals) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function writeLineSegment(
  positions: Float32Array,
  offset: number,
  a: V3,
  b: V3,
): void {
  positions[offset] = a[0];
  positions[offset + 1] = a[1];
  positions[offset + 2] = a[2];
  positions[offset + 3] = b[0];
  positions[offset + 4] = b[1];
  positions[offset + 5] = b[2];
}

/**
 * Applies a fold frame to the buffers allocated by buildFoldScene. Topology,
 * attributes, material groups, and geometry identities remain unchanged.
 */
export function updateFoldScenePositions(
  data: FoldSceneData,
  input: FoldScenePositionInput,
): void {
  const { model, projection, frame } = data.positionLayout;
  const suppliedFoldPositions = input.foldPositions?.length === model.verticesCoords.length
    ? input.foldPositions
    : undefined;
  const timelineSolve: FoldTimelineSolve = suppliedFoldPositions
    ? {
        positions: suppliedFoldPositions,
        creaseAnglesDeg: {},
        ratio: 0,
        method: "source-iterative",
        maxEdgeError: input.foldMaxEdgeError ?? 0,
        maxAngleErrorDeg: input.foldMaxAngleErrorDeg ?? 0,
      }
    : solveFoldTimeline(model, input.foldStepIndex, input.foldAngle);
  const foldPositions = projection === "flat-2d"
    ? flatFoldPositions(model)
    : timelineSolve.positions;
  const oriented = orientedFor(projection, foldPositions, model);
  const [cx, cy, cz] = frame.center;
  const depthSign = projection === "flat-2d" ? -1 : 1;
  const scenePositions: V3[] = oriented.map((point) => [
    (point[0] - cx) * frame.scale,
    (point[2] - cz) * frame.scale,
    (point[1] - cy) * frame.scale * depthSign,
  ]);
  const faceNormals: V3[] = model.facesVertices.map((loop) => {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let index = 0; index < loop.length; index += 1) {
      const current = scenePositions[loop[index]];
      const next = scenePositions[loop[(index + 1) % loop.length]];
      nx += (current[1] - next[1]) * (current[2] + next[2]);
      ny += (current[2] - next[2]) * (current[0] + next[0]);
      nz += (current[0] - next[0]) * (current[1] + next[1]);
    }
    return v3norm([nx, ny, nz]);
  });

  const meshAttribute = data.geometry.getAttribute("position");
  const meshPositions = meshAttribute.array as Float32Array;
  for (let index = 0; index < data.positionLayout.meshRecipes.length; index += 1) {
    writeRecipePosition(
      meshPositions,
      index * 3,
      data.positionLayout.meshRecipes[index],
      scenePositions,
      faceNormals,
    );
  }
  let minY = Infinity;
  for (let offset = 1; offset < meshPositions.length; offset += 3) {
    minY = Math.min(minY, meshPositions[offset]);
  }
  const groundOffset = Number.isFinite(minY) ? minY : 0;
  for (let offset = 1; offset < meshPositions.length; offset += 3) {
    meshPositions[offset] -= groundOffset;
  }
  meshAttribute.needsUpdate = true;
  data.geometry.computeVertexNormals();
  data.geometry.computeBoundingBox();
  data.geometry.computeBoundingSphere();
  const box = data.geometry.boundingBox;
  if (box) {
    data.bounds.min[0] = box.min.x;
    data.bounds.min[1] = box.min.y;
    data.bounds.min[2] = box.min.z;
    data.bounds.max[0] = box.max.x;
    data.bounds.max[1] = box.max.y;
    data.bounds.max[2] = box.max.z;
  }

  updateRecipeGeometry(
    data.lockedTintGeometry,
    data.positionLayout.lockedTintRecipes,
    scenePositions,
    faceNormals,
    groundOffset,
  );
  updateRecipeGeometry(
    data.lockedIconGeometry,
    data.positionLayout.lockedIconRecipes,
    scenePositions,
    faceNormals,
    groundOffset,
    false,
  );
  updateRecipeGeometry(
    data.selectedTintGeometry,
    data.positionLayout.selectedTintRecipes,
    scenePositions,
    faceNormals,
    groundOffset,
  );

  const solidAttribute = data.solidEdgeGeometry.getAttribute("position");
  const solidPositions = solidAttribute.array as Float32Array;
  const creaseAttribute = data.creaseEdgeGeometry.getAttribute("position");
  const creasePositions = creaseAttribute.array as Float32Array;
  const dashedAttribute = data.dashedEdgeGeometry.getAttribute("position");
  const dashedPositions = dashedAttribute.array as Float32Array;
  const dashedDistanceAttribute =
    data.dashedEdgeGeometry.getAttribute("lineDistance");
  const dashedDistances = dashedDistanceAttribute.array as Float32Array;
  const pickAttribute = data.edgePickGeometry.getAttribute("position");
  const pickPositions = pickAttribute.array as Float32Array;
  for (const edge of data.positionLayout.edgeLayouts) {
    const a: V3 = [0, 0, 0];
    const b: V3 = [0, 0, 0];
    const normal: V3 = [0, 0, 0];
    const count = edge.frontAIndices.length;
    for (let index = 0; index < count; index += 1) {
      const aOffset = edge.frontAIndices[index] * 3;
      const bOffset = edge.frontBIndices[index] * 3;
      a[0] += meshPositions[aOffset];
      a[1] += meshPositions[aOffset + 1];
      a[2] += meshPositions[aOffset + 2];
      b[0] += meshPositions[bOffset];
      b[1] += meshPositions[bOffset + 1];
      b[2] += meshPositions[bOffset + 2];
      const faceNormal = faceNormals[edge.faceIndices[index]];
      normal[0] += faceNormal[0];
      normal[1] += faceNormal[1];
      normal[2] += faceNormal[2];
    }
    const lifted = v3scale(v3norm(normal), CREASE_LINE_SURFACE_OFFSET);
    a[0] = a[0] / count + lifted[0];
    a[1] = a[1] / count + lifted[1];
    a[2] = a[2] / count + lifted[2];
    b[0] = b[0] / count + lifted[0];
    b[1] = b[1] / count + lifted[1];
    b[2] = b[2] / count + lifted[2];
    writeLineSegment(pickPositions, edge.pickPositionOffset, a, b);
    const edgePositions = data.positionsByEdge.get(edge.edgeIndex);
    if (edgePositions) {
      writeLineSegment(edgePositions, edge.selectedPositionOffset, a, b);
    }
    if (edge.solidPositionOffset !== undefined) {
      writeLineSegment(solidPositions, edge.solidPositionOffset, a, b);
    }
    if (edge.creasePositionOffset !== undefined) {
      writeLineSegment(creasePositions, edge.creasePositionOffset, a, b);
    }
    if (edge.dashedPositionOffset !== undefined) {
      writeLineSegment(dashedPositions, edge.dashedPositionOffset, a, b);
    }
    if (edge.dashedDistanceOffset !== undefined) {
      dashedDistances[edge.dashedDistanceOffset] = 0;
      dashedDistances[edge.dashedDistanceOffset + 1] = v3len(v3sub(b, a));
    }
  }
  solidAttribute.needsUpdate = true;
  creaseAttribute.needsUpdate = true;
  dashedAttribute.needsUpdate = true;
  dashedDistanceAttribute.needsUpdate = true;
  pickAttribute.needsUpdate = true;
  data.solidEdgeGeometry.computeBoundingBox();
  data.solidEdgeGeometry.computeBoundingSphere();
  data.creaseEdgeGeometry.computeBoundingBox();
  data.creaseEdgeGeometry.computeBoundingSphere();
  data.dashedEdgeGeometry.computeBoundingBox();
  data.dashedEdgeGeometry.computeBoundingSphere();
  data.edgePickGeometry.computeBoundingBox();
  data.edgePickGeometry.computeBoundingSphere();
  data.timelineSolve = timelineSolve;
}
