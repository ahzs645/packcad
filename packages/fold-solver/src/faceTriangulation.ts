// Constrained-Delaunay face triangulation for the solver.
//
// The reference triangulates each face with cdt2d, a *constrained Delaunay*
// mesher. `@atelier/geometry`'s `triangulateFace` returns a valid triangulation
// but does not maximise the minimum angle, and every facet dihedral Jacobian
// carries 1/tan(sector angle) and 1/leverArm terms, both of which blow up on a
// sliver. Lawson edge flipping turns any triangulation of a simple polygon into
// its constrained Delaunay triangulation, so this refines what `triangulateFace`
// produces rather than replacing the mesher.
//
// Keep the expectations here modest: measured against the reference's own
// captured `face.triangulation`, this still picks a different diagonal on 27 of
// the pillow box's 67 faces (35 of 191 diagonals), and substituting cdt2d's
// exact diagonals moves the converged K1 fold by about half a pixel. The
// triangulation is not what makes a fold match the reference -- the curve
// discretisation (see `curveSubdivision`) and measuring crease angles from face
// rather than triangle normals (see `faceLoopNormal`) are.

import { triangulateFace } from "@atelier/geometry";

type Triangle = [number, number, number];
type Point = readonly number[];

const MAX_FLIP_PASSES = 64;

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function signedArea(p: Point, q: Point, r: Point): number {
  return cross(q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1]);
}

/** > 0 when `d` lies inside the circumcircle of the CCW triangle (a, b, c). */
function inCircle(a: Point, b: Point, c: Point, d: Point): number {
  const ax = a[0] - d[0];
  const ay = a[1] - d[1];
  const bx = b[0] - d[0];
  const by = b[1] - d[1];
  const cx = c[0] - d[0];
  const cy = c[1] - d[1];
  return (
    (ax * ax + ay * ay) * cross(bx, by, cx, cy)
    - (bx * bx + by * by) * cross(ax, ay, cx, cy)
    + (cx * cx + cy * cy) * cross(ax, ay, bx, by)
  );
}

function orient(triangle: Triangle, coords: ReadonlyArray<Point>): Triangle {
  const [a, b, c] = triangle;
  return signedArea(coords[a], coords[b], coords[c]) < 0 ? [a, c, b] : triangle;
}

function apexOf(triangle: Triangle, a: number, b: number): number | null {
  const found = triangle.find((v) => v !== a && v !== b);
  return found === undefined ? null : found;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Triangulate a face loop and refine it to the constrained Delaunay
 * triangulation. Boundary edges of the loop are never flipped, so the face
 * outline (including flattened curve pieces) is preserved exactly.
 */
export function triangulateFaceDelaunay(
  loop: number[],
  coords: ReadonlyArray<Point>,
): Triangle[] {
  const triangles = triangulateFace(loop, coords).map((t) => orient(t as Triangle, coords));
  if (triangles.length < 2) return triangles;

  const boundary = new Set<string>();
  for (let i = 0; i < loop.length; i += 1) {
    boundary.add(edgeKey(loop[i], loop[(i + 1) % loop.length]));
  }

  for (let pass = 0; pass < MAX_FLIP_PASSES; pass += 1) {
    // interior edge -> the (at most two) triangles that share it
    const shared = new Map<string, number[]>();
    triangles.forEach((triangle, index) => {
      for (let e = 0; e < 3; e += 1) {
        const key = edgeKey(triangle[e], triangle[(e + 1) % 3]);
        if (boundary.has(key)) continue;
        const list = shared.get(key);
        if (list) list.push(index);
        else shared.set(key, [index]);
      }
    });

    let flipped = false;
    for (const [key, owners] of shared) {
      if (owners.length !== 2) continue;
      const [a, b] = key.split(":").map(Number);
      const [i, j] = owners;
      const c = apexOf(triangles[i], a, b);
      const d = apexOf(triangles[j], a, b);
      if (c === null || d === null) continue;

      const pa = coords[a];
      const pb = coords[b];
      const pc = coords[c];
      const pd = coords[d];
      // Only flip inside a strictly convex quad, otherwise the result overlaps.
      const convex = signedArea(pc, pa, pd) > 0 === signedArea(pc, pd, pb) > 0
        && Math.abs(signedArea(pc, pa, pd)) > 1e-12
        && Math.abs(signedArea(pc, pd, pb)) > 1e-12;
      if (!convex) continue;

      const ccw: Triangle = signedArea(pa, pb, pc) > 0 ? [a, b, c] : [b, a, c];
      if (inCircle(coords[ccw[0]], coords[ccw[1]], coords[ccw[2]], pd) <= 0) continue;

      triangles[i] = orient([c, d, a], coords);
      triangles[j] = orient([c, b, d], coords);
      flipped = true;
      break; // adjacency is stale after a flip; rebuild it
    }
    if (!flipped) break;
  }

  return triangles;
}
