import { describe, expect, it } from "vitest";
import { foldNewton } from "./foldNewtonSolver";
import { createMilkCartonProject } from "./sample";
import type { Vec3 } from "./foldSolver";

describe("Newton stage nominal geometry", () => {
  it("derives rest lengths from the incoming stage graph and can freeze that snapshot", () => {
    const model = createMilkCartonProject().foldModel;
    if (!model) throw new Error("Milk-carton fixture did not produce a fold model");
    const flat = model.verticesCoords.map(([x, y]) => [x, y, 0] as Vec3);
    const incoming = flat.map(([x, y, z]) => [x * 1.025, y * 1.025, z] as Vec3);

    // A newly constructed source stage calls updateNominalValues(startingGraph),
    // so its unchanged incoming graph begins with zero edge strain.
    const fromIncoming = foldNewton(model, {}, { maxIterations: 0, seed: incoming });
    expect(fromIncoming.maxEdgeError).toBeLessThan(1e-12);

    // Incremental animation cycles advance `seed`, but retain the stage's first
    // graph explicitly. This proves those two inputs are intentionally distinct.
    const fromFrozenFlat = foldNewton(model, {}, {
      maxIterations: 0,
      seed: incoming,
      restPositions: flat,
    });
    expect(fromFrozenFlat.maxEdgeError).toBeCloseTo(0.025, 12);
  });
});
