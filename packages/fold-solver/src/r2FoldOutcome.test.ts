// R2 outcome gate — the decisive test (atelier/docs/MIGRATION.md risk R2).
//
// `triangulationParity.test.ts` shows cdt2d and delaunator disagree on two faces of the
// MailerBox fixture: they pick opposite diagonals of a near-cocircular quad. Both are valid
// Delaunay triangulations, so the interesting question is not "are the triangulations equal"
// but "does the CONVERGED FOLD move". That is what this test answers.
//
// It runs the Newton solver twice over the same fixture — once with the engine's
// delaunator-backed triangulation, once with packager's original cdt2d one — and compares
// final vertex positions.
//
// NOTE: `vi.spyOn` on an ESM namespace does NOT intercept the solver's import (verified — it
// silently no-ops and both runs use delaunator, making the test pass for the wrong reason).
// The mock must go through `vi.mock` + `vi.hoisted`, and `assertMockIsLive` below fails loudly
// if that ever stops being true.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMailerBoxProject } from "./sample";

const hoisted = vi.hoisted(() => ({ useCdt2d: false, calls: 0 }));

vi.mock("@atelier/geometry", async () => {
  const actual = await vi.importActual<typeof import("@atelier/geometry")>("@atelier/geometry");
  const cdt2dModule = await import("cdt2d");
  const cdt2d = cdt2dModule.default;

  type Tri = [number, number, number];
  const viaCdt2d = (
    loop: number[],
    coords: ReadonlyArray<ReadonlyArray<number>>,
  ): Tri[] => {
    const n = loop.length;
    if (n < 3) return [];
    if (n === 3) return [[loop[0], loop[1], loop[2]]];
    const positions = loop.map((vertex) => [coords[vertex][0], coords[vertex][1]]);
    const boundary = loop.map((_, index) => [index, (index + 1) % n] as [number, number]);
    const triangles = cdt2d(positions, boundary, { exterior: false });
    if (triangles.length === 0) throw new Error("cdt2d triangulation failed");
    return triangles.map(([a, b, c]) => [loop[a], loop[b], loop[c]] as Tri);
  };

  return {
    ...actual,
    triangulateFace: (loop: number[], coords: ReadonlyArray<ReadonlyArray<number>>) => {
      hoisted.calls += 1;
      return hoisted.useCdt2d ? viaCdt2d(loop, coords) : actual.triangulateFace(loop, coords);
    },
  };
});

describe("R2: converged fold is unchanged by the triangulation migration", () => {
  beforeEach(() => {
    hoisted.calls = 0;
  });

  it("intercepts the solver's triangulateFace (guards against a false pass)", async () => {
    const project = createMailerBoxProject();
    if (!project.foldModel) throw new Error("MailerBox fixture did not produce a fold model");
    const { foldNewtonSequence } = await import("./foldNewtonSolver");
    foldNewtonSequence(project.foldModel);
    expect(hoisted.calls).toBeGreaterThan(0);
  });

  it("MailerBox settles to the same geometry under cdt2d and delaunator", async () => {
    const project = createMailerBoxProject();
    if (!project.foldModel) throw new Error("MailerBox fixture did not produce a fold model");
    const { foldNewtonSequence } = await import("./foldNewtonSolver");

    hoisted.useCdt2d = false;
    const viaDelaunator = foldNewtonSequence(project.foldModel);
    const delaunatorCalls = hoisted.calls;

    hoisted.useCdt2d = true;
    const viaCdt2d = foldNewtonSequence(project.foldModel);
    hoisted.useCdt2d = false;

    expect(delaunatorCalls).toBeGreaterThan(0);
    expect(viaCdt2d.positions.length).toBe(viaDelaunator.positions.length);

    // Largest per-vertex displacement between the two settled folds, in fixture units.
    let maxDelta = 0;
    for (let i = 0; i < viaDelaunator.positions.length; i += 1) {
      const a = viaDelaunator.positions[i];
      const b = viaCdt2d.positions[i];
      for (let k = 0; k < 3; k += 1) {
        maxDelta = Math.max(maxDelta, Math.abs(a[k] - b[k]));
      }
    }

    // The fixture spans hundreds of units and both solves report edge error ~5e-8, so a real
    // divergence in the constraint set would land far above this bound.
    expect(maxDelta).toBeLessThan(1e-3);

    expect(viaDelaunator.maxEdgeError).toBeLessThan(1e-6);
    expect(viaCdt2d.maxEdgeError).toBeLessThan(1e-6);
  });
});
