// Constrained-Delaunay face triangulation for the solver.
//
// The reference triangulates each face with cdt2d, a *constrained Delaunay*
// mesher. `@atelier/geometry`'s `triangulateFace` returns a valid triangulation,
// but alternate diagonals change the facet Jacobians on nearly cocircular
// panels, so the solver uses cdt2d directly for source-compatible tie-breaking.
//
// PVertex position2D is face-local storage in the source object model, but the
// imported crease pattern gives every copy of a welded vertex the same value.
// Those values are the SVG coordinates recentered on the pattern bounding box
// and converted from px to inches. Reproduce that arithmetic exactly because
// cdt2d's choice on cocircular panels is floating-point sensitive.

/// <reference path="./cdt2d.d.ts" />

import cdt2d from "cdt2d";
import type { FoldModel } from "@packcad/format";

type Triangle = [number, number, number];
type Point = readonly number[];

/**
 * Triangulate a face loop with the same constrained-Delaunay implementation
 * as PackCAD. Keeping cdt2d's exact tie-breaking matters for the Newton
 * trajectory: alternate diagonals are geometrically valid, but they produce a
 * different facet Jacobian on the nearly cocircular pillow-box end panels.
 */
export function triangulateFaceDelaunay(
  loop: number[],
  coords: ReadonlyArray<Point>,
): Triangle[] {
  const count = loop.length;
  if (count < 3) return [];
  if (count === 3) return [[loop[0], loop[1], loop[2]]];
  const positions = loop.map((vertex) => [coords[vertex][0], coords[vertex][1]]);
  const boundary = loop.map((_, index) => [index, (index + 1) % count] as [number, number]);
  const triangles = cdt2d(positions, boundary, { exterior: false });
  if (triangles.length === 0) throw new Error("cdt2d triangulation failed");
  return triangles.map(([a, b, c]) => [loop[a], loop[b], loop[c]] as Triangle);
}

/**
 * Convert FoldModel's imported SVG coordinates into PackCAD Pattern2D space.
 * This is distinct from the later 3D folding-setup transform, which centres the
 * fixed face: FaceTriangulation invokes cdt2d from PVertex.position2D.
 */
export function triangulateFoldModelFaces(
  model: FoldModel,
  positions3D?: ReadonlyArray<Point>,
): Triangle[][] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of model.verticesCoords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const unitScale = model.coordinateUnit === "px" ? 72 : 1;
  const scaleFactor = 1 / unitScale;
  const originX = Number.isFinite(minX + maxX)
    ? (minX * scaleFactor + maxX * scaleFactor) / 2
    : 0;
  const originY = Number.isFinite(minY + maxY)
    ? (minY * scaleFactor + maxY * scaleFactor) / 2
    : 0;
  const sourceCoords = model.verticesCoords.map(([x, y]) => [
    x * scaleFactor - originX,
    y * scaleFactor - originY,
  ]);
  if (!positions3D) {
    return model.facesVertices.map((loop) => triangulateFaceDelaunay(loop, sourceCoords));
  }

  // The first operation starts from one globally flat sheet. At that point the
  // source still uses its authored PVertex.position2D values, whose exact SVG
  // import arithmetic controls cdt2d's cocircular tie-breaks. Only switch to
  // current-geometry projection once an earlier operation has made the graph
  // genuinely non-coplanar.
  const p0 = positions3D[0];
  let p1Index = 1;
  let longest = 0;
  for (let index = 1; index < positions3D.length; index += 1) {
    const p = positions3D[index];
    const distance = Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]);
    if (distance > longest) {
      longest = distance;
      p1Index = index;
    }
  }
  const p1 = positions3D[p1Index];
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  let planeX = 0;
  let planeY = 0;
  let planeZ = 0;
  let planeLength = 0;
  for (const p of positions3D) {
    const ex = p[0] - p0[0];
    const ey = p[1] - p0[1];
    const ez = p[2] - p0[2];
    const cx = dy * ez - dz * ey;
    const cy = dz * ex - dx * ez;
    const cz = dx * ey - dy * ex;
    const crossLength = Math.hypot(cx, cy, cz);
    if (crossLength > planeLength) {
      planeLength = crossLength;
      planeX = cx;
      planeY = cy;
      planeZ = cz;
    }
  }
  if (planeLength > 0) {
    planeX /= planeLength;
    planeY /= planeLength;
    planeZ /= planeLength;
    let maxPlaneDistance = 0;
    for (const p of positions3D) {
      maxPlaneDistance = Math.max(maxPlaneDistance, Math.abs(
        (p[0] - p0[0]) * planeX
        + (p[1] - p0[1]) * planeY
        + (p[2] - p0[2]) * planeZ,
      ));
    }
    if (maxPlaneDistance <= Math.max(1, longest) * 1e-10) {
      return model.facesVertices.map((loop) => triangulateFaceDelaunay(loop, sourceCoords));
    }
  }

  // FaceTriangulation refreshes cdt2d after the graph moves. It projects the
  // current 3D vertices onto the face's `_normal3DApprox` plane first; therefore
  // a later folding stage can legitimately use different diagonals than K0.
  // Any orthonormal basis of that plane is equivalent up to a 2D rotation.
  return model.facesVertices.map((loop) => {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let index = 0; index < loop.length; index += 1) {
      const p = positions3D[loop[index]];
      const q = positions3D[loop[(index + 1) % loop.length]];
      nx += p[1] * q[2] - p[2] * q[1];
      ny += p[2] * q[0] - p[0] * q[2];
      nz += p[0] * q[1] - p[1] * q[0];
    }
    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength < 1e-14) return triangulateFaceDelaunay(loop, sourceCoords);
    nx /= normalLength;
    ny /= normalLength;
    nz /= normalLength;

    // Pick the least parallel coordinate axis, project it into the face plane,
    // then derive the second axis. This is the same orthogonal projection as
    // rotating `_normal3DApprox` to +Z, without depending on an arbitrary spin.
    let rx = 0;
    let ry = 0;
    let rz = 1;
    if (Math.abs(nz) > 0.9) {
      rx = 1;
      ry = 0;
      rz = 0;
    }
    const along = rx * nx + ry * ny + rz * nz;
    let ux = rx - along * nx;
    let uy = ry - along * ny;
    let uz = rz - along * nz;
    const uLength = Math.hypot(ux, uy, uz) || 1;
    ux /= uLength;
    uy /= uLength;
    uz /= uLength;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const projected = positions3D.map((point) => [
      point[0] * ux + point[1] * uy + point[2] * uz,
      point[0] * vx + point[1] * vy + point[2] * vz,
    ]);
    return triangulateFaceDelaunay(loop, projected);
  });
}
