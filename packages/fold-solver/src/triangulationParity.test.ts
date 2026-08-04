// R2 parity characterization (atelier/docs/MIGRATION.md risk R2).
//
// Historical comparison between Atelier's delaunator triangulation and PackCAD's `cdt2d`.
// The production Newton solver now uses cdt2d; this characterization preserves the evidence
// for that choice because a different diagonal produces a different facet constraint set.
//
// Both libraries are valid Delaunay triangulators, so they are NOT required to agree — on a
// near-cocircular quad the diagonal choice is arbitrary. This test pins WHERE they diverge on
// the real MailerBox fixture. r2FoldOutcome.test.ts guards the production cdt2d outcome.

import cdt2d from "cdt2d";
import { triangulateFace as triangulateFaceDelaunator } from "@atelier/geometry";
import { describe, expect, it } from "vitest";
import { createMailerBoxProject, createPillowBoxProject } from "./sample";

type Tri = [number, number, number];

/** packager's original constrained-Delaunay face triangulation, verbatim (cdt2d). */
function triangulateFaceCdt2d(
  loop: number[],
  coords: ReadonlyArray<ReadonlyArray<number>>,
): Tri[] {
  const n = loop.length;
  if (n < 3) return [];
  if (n === 3) return [[loop[0], loop[1], loop[2]]];
  const positions = loop.map((vertex) => [coords[vertex][0], coords[vertex][1]]);
  const boundary = loop.map((_, index) => [index, (index + 1) % n] as [number, number]);
  const triangles = cdt2d(positions, boundary, { exterior: false });
  if (triangles.length === 0) throw new Error("cdt2d triangulation failed");
  return triangles.map(([a, b, c]) => [loop[a], loop[b], loop[c]] as Tri);
}

/** Non-boundary edges of a triangulation — the isometry bars the solver constrains. */
function diagonalsOf(loop: number[], triangles: Tri[]): Set<string> {
  const key = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const boundary = new Set<string>();
  for (let i = 0; i < loop.length; i += 1) {
    boundary.add(key(loop[i], loop[(i + 1) % loop.length]));
  }
  const diagonals = new Set<string>();
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const k = key(u, v);
      if (!boundary.has(k)) diagonals.add(k);
    }
  }
  return diagonals;
}

/** Order-independent triangle identity: sorted vertex triple. */
function triangleSet(triangles: Tri[]): Set<string> {
  return new Set(triangles.map((t) => [...t].sort((x, y) => x - y).join(":")));
}

function signedArea(tri: Tri, coords: ReadonlyArray<ReadonlyArray<number>>): number {
  const [a, b, c] = tri;
  return Math.abs(
    (coords[b][0] - coords[a][0]) * (coords[c][1] - coords[a][1])
    - (coords[c][0] - coords[a][0]) * (coords[b][1] - coords[a][1]),
  ) / 2;
}

describe("R2: cdt2d vs delaunator triangulation parity", () => {
  const project = createMailerBoxProject();
  const model = project.foldModel;
  if (!model) throw new Error("MailerBox fixture did not produce a fold model");

  it("covers every face of the real fixture", () => {
    expect(model.facesVertices.length).toBeGreaterThan(0);
  });

  // Characterization, not a hard equality bar: cdt2d and delaunator are both valid Delaunay
  // triangulators, and on a near-cocircular quad the diagonal choice is genuinely arbitrary.
  // What matters is (a) the divergence stays confined to these known faces, and (b) the
  // converged fold does not move — proven in r2FoldOutcome.test.ts.
  const KNOWN_DIVERGENT_FACES = [8, 15];

  it("diagonal sets diverge only on the known near-cocircular faces", () => {
    const mismatches: Array<{ face: number; cdt2d: string[]; delaunator: string[] }> = [];

    model.facesVertices.forEach((loop, faceIndex) => {
      if (loop.length < 3) return;
      const legacy = triangulateFaceCdt2d(loop, model.verticesCoords);
      const next = triangulateFaceDelaunator(loop, model.verticesCoords);
      const legacyDiagonals = diagonalsOf(loop, legacy);
      const nextDiagonals = diagonalsOf(loop, next);

      const same =
        legacyDiagonals.size === nextDiagonals.size
        && [...legacyDiagonals].every((d) => nextDiagonals.has(d));
      if (!same) {
        mismatches.push({
          face: faceIndex,
          cdt2d: [...legacyDiagonals].sort(),
          delaunator: [...nextDiagonals].sort(),
        });
      }
    });

    expect(mismatches.map((m) => m.face)).toEqual(KNOWN_DIVERGENT_FACES);
    // Each divergence must be a same-size swap (one diagonal for another), never a
    // structurally different constraint count.
    for (const mismatch of mismatches) {
      expect(mismatch.delaunator.length).toBe(mismatch.cdt2d.length);
    }
  });

  it("triangle sets diverge only on the known faces", () => {
    const mismatches: number[] = [];
    model.facesVertices.forEach((loop, faceIndex) => {
      if (loop.length < 3) return;
      const legacy = triangleSet(triangulateFaceCdt2d(loop, model.verticesCoords));
      const next = triangleSet(triangulateFaceDelaunator(loop, model.verticesCoords));
      const same = legacy.size === next.size && [...legacy].every((t) => next.has(t));
      if (!same) mismatches.push(faceIndex);
    });
    expect(mismatches).toEqual(KNOWN_DIVERGENT_FACES);
  });

  it("conserves total face area under both triangulators", () => {
    model.facesVertices.forEach((loop) => {
      if (loop.length < 3) return;
      const legacyArea = triangulateFaceCdt2d(loop, model.verticesCoords)
        .reduce((sum, t) => sum + signedArea(t, model.verticesCoords), 0);
      const nextArea = triangulateFaceDelaunator(loop, model.verticesCoords)
        .reduce((sum, t) => sum + signedArea(t, model.verticesCoords), 0);
      expect(nextArea).toBeCloseTo(legacyArea, 6);
    });
  });

  it("characterizes the source pillow-box triangulation", () => {
    const pillowModel = createPillowBoxProject().foldModel;
    if (!pillowModel) throw new Error("PillowBox fixture did not produce a fold model");
    const mismatches: number[] = [];
    pillowModel.facesVertices.forEach((loop, faceIndex) => {
      if (loop.length < 3) return;
      const legacy = triangleSet(triangulateFaceCdt2d(loop, pillowModel.verticesCoords));
      const next = triangleSet(triangulateFaceDelaunator(loop, pillowModel.verticesCoords));
      const same = legacy.size === next.size && [...legacy].every((triangle) => next.has(triangle));
      if (!same) mismatches.push(faceIndex);
    });
    expect(mismatches).toEqual([6, 15, 20, 24, 27, 35, 37, 40, 50, 60, 61, 62]);
  });
});
