// Framework-agnostic builder that turns a FoldModel + fold state into all the
// geometry the views render: the per-face thickness shell (front/back/edge
// groups), a triangle->face map for raycast selection, unified edge lines
// (solid + dashed) tagged per-edge, a locked/selected face tint, and a pick
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

const SCENE_EXTENT = 3; // post-normalization target span (foldSceneFrame scales to this)
const CREASE_LINE_SURFACE_OFFSET = 0.006; // line epsilon above the front slab surface
const LOCKED_TINT_OFFSET = 0.004; // tint sits under the lines, above the face
const SELECTED_TINT_OFFSET = 0.005;
const EDGE_UV_REPEAT_PER_SCENE_UNIT = 4.5;
const MAX_HINGE_MITER_RATIO = 2.5;

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

export type FoldSceneMeta = {
  edgeIndexCount: number;
  cutEdgeIndexCount: number;
  edgeVertexCount: number;
  interiorFoldHingeCount: number;
  foldHingeSidebandIndexCount: number;
  foldHingeCapIndexCount: number;
  thicknessOffsetDirection: ThicknessOffsetDirection;
  creaseLineCount: number;
  lockedFaceCount: number;
  flipAll: boolean;
};

export type FoldSceneData = {
  /** Faces: indexed, groups front=0, back=1, edge=2. position/uv/color attrs. */
  geometry: BufferGeometry;
  /** triangle id (in full index order) -> source fold face index, -1 for cut edges. */
  faceIndexByTriangle: Int32Array;
  /** translucent overlay of the locked faces' front triangles (null if none). */
  lockedTintGeometry: BufferGeometry | null;
  selectedTintGeometry: BufferGeometry | null;
  /** boundary + locked edges, solid; LineSegments + vertex colors. */
  solidEdgeGeometry: BufferGeometry;
  /** crease edges, dashed; LineSegments + vertex colors + lineDistance. */
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

/** Shared geometric frame so the flat 2D and folded 3D scenes use one scale/center. */
export function foldSceneFrame(model: FoldModel) {
  const flatOriented = applyTransforms(flatFoldPositions(model), model.transforms);
  const { min, max } = weldedBounds(flatOriented);
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
  const frame = foldSceneFrame(model);
  const oriented = applyTransforms(flatFoldPositions(model), model.transforms);
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
  const timelineSolve: FoldTimelineSolve = input.foldPositions
    ? {
        positions: input.foldPositions,
        creaseAnglesDeg: {},
        ratio: 0,
        method: "source-iterative",
        maxEdgeError: input.foldMaxEdgeError ?? 0,
        maxAngleErrorDeg: input.foldMaxAngleErrorDeg ?? 0,
      }
    : solveFoldTimeline(model, foldStepIndex, foldAngle);
  const foldPositions = projection === "flat-2d" ? flatFoldPositions(model) : timelineSolve.positions;
  const oriented = applyTransforms(foldPositions, model.transforms);

  const frame = foldSceneFrame(model);
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
    ? thicknessMillimetresToFoldUnits(thicknessMm, model.coordinateUnit) * frame.scale
    : 0;
  const { front: fOff, back: bOff } = offsetExtents(visualThickness, direction);

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const frontIndices: number[] = [];
  const frontHingeIndices: number[] = [];
  const backIndices: number[] = [];
  const backHingeIndices: number[] = [];
  const edgeIndices: number[] = [];
  let next = 0;
  const white = new Color("#ffffff");
  const faceColors = model.facesVertices.map((_, index) => new Color(panelColorForIndex(index)));
  const pushVert = (p: V3, uv: readonly [number, number], color = white): number => {
    positions.push(p[0], p[1], p[2]);
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
      front.set(vi, pushVert(v3add(base, v3scale(nrm, fOff)), uvOf(vi), faceColor));
      back.set(vi, pushVert(v3add(base, v3scale(nrm, bOff)), uvOf(vi), faceColor));
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

  // Close exposed cut edges with the sideband texture (skipped when flat/no thickness).
  const edgeVertexStart = next;
  let interiorFoldHingeCount = 0;
  let foldHingeCapIndexCount = 0;
  const addEdgeQuad = (pVa: V3, pVb: V3, cVb: V3, cVa: V3, v0 = 0, v1 = 1) => {
    const u1 = Math.max(1, v3len(v3sub(pVb, pVa)) * EDGE_UV_REPEAT_PER_SCENE_UNIT);
    const a = pushVert(pVa, [0, v0]);
    const b = pushVert(pVb, [u1, v0]);
    const c = pushVert(cVb, [u1, v1]);
    const d = pushVert(cVa, [0, v1]);
    edgeIndices.push(a, b, c, a, c, d);
  };
  const addHingeQuad = (
    target: number[],
    pVa: V3,
    pVb: V3,
    cVb: V3,
    cVa: V3,
    uvA: [number, number],
    uvB: [number, number],
    outward: V3,
  ) => {
    const separated = Math.max(v3len(v3sub(pVa, cVa)), v3len(v3sub(pVb, cVb))) > 1e-6;
    if (!separated) return;
    const a = pushVert(pVa, uvA);
    const b = pushVert(pVb, uvB);
    const c = pushVert(cVb, uvB);
    const d = pushVert(cVa, uvA);
    const normal = v3cross(v3sub(pVb, pVa), v3sub(cVb, pVa));
    if (v3dot(normal, outward) >= 0) target.push(a, b, c, a, c, d);
    else target.push(a, c, b, a, d, c);
  };
  const addMiteredHingeStrip = (
    target: number[],
    va: number,
    vb: number,
    faceAEdge: { va: V3; vb: V3 },
    faceBEdge: { va: V3; vb: V3 },
    offset: number,
    normalA: V3,
    normalB: V3,
    outward: V3,
  ) => {
    if (Math.abs(offset) <= 1e-9) return;
    const miterVa = hingeMiterPoint(scenePositions[va] as V3, normalA, normalB, offset);
    const miterVb = hingeMiterPoint(scenePositions[vb] as V3, normalA, normalB, offset);
    addHingeQuad(
      target,
      faceAEdge.va, faceAEdge.vb, miterVb, miterVa,
      uvOf(va), uvOf(vb), outward,
    );
    addHingeQuad(
      target,
      miterVa, miterVb, faceBEdge.vb, faceBEdge.va,
      uvOf(va), uvOf(vb), outward,
    );
  };
  const addMiteredHingeCap = (vertex: number, A: typeof faceData[number], B: typeof faceData[number]) => {
    const capPoints = miteredHingeCapPoints(
      scenePositions[vertex] as V3,
      A.nrm,
      B.nrm,
      fOff,
      bOff,
    );
    if (capPoints.length < 3) return;
    const capVertices = capPoints.map((point, index) =>
      pushVert(point, [index / Math.max(1, capPoints.length - 1), index === 0 ? 0 : 1]));
    for (let index = 1; index < capVertices.length - 1; index += 1) {
      edgeIndices.push(capVertices[0], capVertices[index], capVertices[index + 1]);
    }
  };
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
        const A = faceData[fcs[0]];
        const fa = A.front.get(va)!, fb = A.front.get(vb)!, ba = A.back.get(va)!, bb = A.back.get(vb)!;
        addEdgeQuad(positionAt(fa), positionAt(fb), positionAt(bb), positionAt(ba));
      } else if (fcs.length === 2) {
        if (model.edgesAssignment[ei] === "B") return;
        interiorFoldHingeCount += 1;
        const A = faceData[fcs[0]];
        const B = faceData[fcs[1]];
        const outward = v3norm(v3add(A.nrm, B.nrm));
        const hingeOutward = v3len(outward) > 1e-6 ? outward : A.nrm;
        // PackCAD's GraphVisBendRadius closes the front and back thickness
        // shells independently with the corresponding face material. A flat
        // bridge is sufficient at our current mesh resolution and, unlike a
        // corrugated sideband, does not expose a false cut edge at the crease.
        addMiteredHingeStrip(
          frontHingeIndices,
          va,
          vb,
          { va: positionAt(A.front.get(va)!), vb: positionAt(A.front.get(vb)!) },
          { va: positionAt(B.front.get(va)!), vb: positionAt(B.front.get(vb)!) },
          fOff,
          A.nrm,
          B.nrm,
          hingeOutward,
        );
        addMiteredHingeStrip(
          backHingeIndices,
          va,
          vb,
          { va: positionAt(A.back.get(va)!), vb: positionAt(A.back.get(vb)!) },
          { va: positionAt(B.back.get(va)!), vb: positionAt(B.back.get(vb)!) },
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
          addMiteredHingeCap(vertex, A, B);
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
  const dashedPos: number[] = [];
  const dashedCol: number[] = [];
  const dashedDist: number[] = [];
  const pickPos: number[] = [];
  const segmentEdgeIndex: number[] = [];
  const positionsByEdge = new Map<number, number[]>();
  const lift = CREASE_LINE_SURFACE_OFFSET;
  let creaseLineCount = 0;

  // ONE clean line per edge: average the adjacent faces' front-edge positions and
  // normals so a crease sits on the ridge instead of drawing a doubled line.
  model.edgesVertices.forEach(([va, vb], ei) => {
    const fcs = model.edgeFaces[ei];
    if (fcs.length === 0) return;
    const style = resolveEdgeStyle(model, ei, foldStepIndex, edgeColorMode, false, false);
    const c = style.color ? new Color(style.color) : null;

    let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
    let nx = 0, ny = 0, nz = 0, count = 0;
    for (const faceIndex of fcs) {
      const face = faceData[faceIndex];
      const aIndex = face.front.get(va);
      const bIndex = face.front.get(vb);
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

    pickPos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
    segmentEdgeIndex.push(ei);
    positionsByEdge.set(ei, [A[0], A[1], A[2], B[0], B[1], B[2]]);

    if (!c) return;
    if (style.dashed) {
      dashedPos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      dashedCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      dashedDist.push(0, len);
      creaseLineCount += 1;
    } else {
      solidPos.push(A[0], A[1], A[2], B[0], B[1], B[2]);
      solidCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  });

  // --- locked / selected face tint overlays ---------------------------------
  const lockedFaces = lockedFaceSet(model, foldStepIndex);
  const buildTint = (faceFilter: (faceIndex: number) => boolean, tintLift: number): BufferGeometry | null => {
    const tintPos: number[] = [];
    faceData.forEach((face, faceIndex) => {
      if (!faceFilter(faceIndex)) return;
      const liftV = v3scale(face.nrm, tintLift);
      for (const [a, b, c2] of face.tris) {
        for (const vi of [a, b, c2]) {
          const p = v3add(positionAt(face.front.get(vi)!), liftV);
          tintPos.push(p[0], p[1], p[2]);
        }
      }
    });
    if (tintPos.length === 0) return null;
    const geom = new BufferGeometry();
    geom.setAttribute("position", new Float32BufferAttribute(tintPos, 3));
    geom.computeVertexNormals();
    return geom;
  };
  const lockedTintGeometry = buildTint((fi) => lockedFaces.has(fi), LOCKED_TINT_OFFSET);
  const selectedTintGeometry =
    selectedFaceIndex === null || selectedFaceIndex === undefined
      ? null
      : buildTint((fi) => fi === selectedFaceIndex, SELECTED_TINT_OFFSET);

  // --- assemble face geometry -----------------------------------------------
  const indices = [
    ...frontIndices,
    ...frontHingeIndices,
    ...backIndices,
    ...backHingeIndices,
    ...edgeIndices,
  ];
  // Triangle id -> source face index. Bend/cut closure geometry is not a
  // selectable panel, so those triangles deliberately map to -1.
  const faceIndexByTriangle: number[] = [];
  for (const [faceIndex, face] of faceData.entries()) {
    for (let index = 0; index < face.tris.length; index += 1) faceIndexByTriangle.push(faceIndex);
  }
  faceIndexByTriangle.push(...Array(frontHingeIndices.length / 3).fill(-1));
  for (const [faceIndex, face] of faceData.entries()) {
    for (let index = 0; index < face.tris.length; index += 1) faceIndexByTriangle.push(faceIndex);
  }
  faceIndexByTriangle.push(...Array(backHingeIndices.length / 3).fill(-1));
  faceIndexByTriangle.push(...Array(edgeIndices.length / 3).fill(-1));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.clearGroups();
  const frontGroupCount = frontIndices.length + frontHingeIndices.length;
  const backGroupCount = backIndices.length + backHingeIndices.length;
  geometry.addGroup(0, frontGroupCount, 0);
  geometry.addGroup(frontGroupCount, backGroupCount, 1);
  geometry.addGroup(frontGroupCount + backGroupCount, edgeIndices.length, 2);
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

  const dashedEdgeGeometry = new BufferGeometry();
  dashedEdgeGeometry.setAttribute("position", new Float32BufferAttribute(dashedPos, 3));
  dashedEdgeGeometry.setAttribute("color", new Float32BufferAttribute(dashedCol, 3));
  dashedEdgeGeometry.setAttribute("lineDistance", new Float32BufferAttribute(dashedDist, 1));

  const edgePickGeometry = new BufferGeometry();
  edgePickGeometry.setAttribute("position", new Float32BufferAttribute(pickPos, 3));

  return {
    geometry,
    faceIndexByTriangle: Int32Array.from(faceIndexByTriangle),
    lockedTintGeometry,
    selectedTintGeometry,
    solidEdgeGeometry,
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
      edgeIndexCount: edgeIndices.length,
      cutEdgeIndexCount: edgeIndices.length,
      edgeVertexCount: next - edgeVertexStart,
      interiorFoldHingeCount,
      foldHingeSidebandIndexCount: frontHingeIndices.length + backHingeIndices.length,
      foldHingeCapIndexCount,
      thicknessOffsetDirection: direction,
      creaseLineCount,
      lockedFaceCount: lockedFaces.size,
      flipAll,
    },
  };
}
