import { describe, expect, it } from "vitest";
import {
  createCurvedBoxProject,
  createMilkCartonProject,
  createPillowBoxProject,
} from "./sample";
import { summarizeFolds } from "./foldConstrainedSolver";
import { foldNewtonSequence } from "./foldNewtonSolver";
import { measureCreaseAnglesDegrees } from "./foldPlaybackConstraints";
import type { Vec3 } from "./foldSolver";

/**
 * Every imported package must reach its authored crease angles and stay
 * isometric, from the document alone. These expectations are the solver's own
 * output for the bundled source documents -- no sample may need a per-file
 * correction to get here.
 */
const samples = [
  {
    name: "milk carton",
    create: createMilkCartonProject,
    topology: [57, 81, 25, 5],
    extents: [324.1341, 324, 776.4429],
  },
  {
    // The reference's own instrumented build reports 202/281/80 and a folded
    // size of 496.2 x 498.2 x 875.4 px with every stage Solved; we agree on
    // face count and on all three axes to within 0.4%.
    name: "curved box",
    create: createCurvedBoxProject,
    topology: [198, 277, 80, 4],
    extents: [496.962, 500.0597, 875.2888],
  },
] as const;

/** `FINAL_SOLVE_TOL_ANGULAR_RADIANS` (0.01 rad), the reference's Solved gate. */
const SOLVED_TOLERANCE_DEG = (0.01 * 180) / Math.PI;

function axisExtent(positions: Vec3[], axis: number): number {
  const values = positions.map((position) => position[axis]);
  return Math.max(...values) - Math.min(...values);
}

describe("source package assembly parity", () => {
  it.each(samples)(
    "folds the $name to its authored crease angles and reports Solved",
    ({ create, topology, extents }) => {
      const model = create().foldModel;
      if (!model) throw new Error("Fixture did not produce a fold model");
      expect([
        model.verticesCoords.length,
        model.edgesVertices.length,
        model.facesVertices.length,
        model.keyframes.length,
      ]).toEqual(topology);

      const solved = foldNewtonSequence(model);
      expect(solved.isSolved).toBe(true);
      expect(solved.stuck).toBe(false);
      expect(solved.maxEdgeError).toBeLessThan(0.001);
      expect(solved.maxAngleErrorDeg).toBeLessThan(0.1);
      expect([0, 1, 2].map((axis) => axisExtent(solved.positions, axis))).toEqual([
        expect.closeTo(extents[0], 2),
        expect.closeTo(extents[1], 2),
        expect.closeTo(extents[2], 2),
      ]);

      // Every keyframe reaches the angles its own document asked for, on the
      // branch the solver latched -- not on a captured override. A later
      // keyframe is free to drive an earlier crease further (the milk carton's
      // gable closure folds its K1 body creases past flat), so each stage is
      // checked at the point it finishes, exactly as the reference's
      // `satisfiesCreaseConstraintsForEdges` does.
      for (let k = 0; k < model.keyframes.length; k += 1) {
        const keyframe = model.keyframes[k];
        const stage = foldNewtonSequence(model, { uptoKeyframe: k });
        const measured = measureCreaseAnglesDegrees(model, stage.positions, stage.branchSigns);
        for (const [edgeKey, target] of Object.entries(keyframe.creaseAnglesDeg)) {
          expect(Math.abs(measured[Number(edgeKey)] - target)).toBeLessThan(SOLVED_TOLERANCE_DEG);
        }
      }

      const summary = summarizeFolds(model);
      expect(summary.overall).toMatchObject({ status: "Solved", unresolvedSeams: 0 });
      expect(summary.keyframes.every((keyframe) => keyframe.status === "Solved")).toBe(true);
    },
    60_000,
  );

  it("stalls the pillow box's end tucks short of their target, as the reference does", () => {
    const model = createPillowBoxProject().foldModel;
    if (!model) throw new Error("Pillow-box fixture did not produce a fold model");
    expect([
      model.verticesCoords.length,
      model.edgesVertices.length,
      model.facesVertices.length,
    ]).toEqual([176, 242, 67]);
    expect(model.keyframes.map((keyframe) => keyframe.creaseAnglesDeg)).toEqual([
      { 56: 95, 89: 95, 160: 95, 193: 95 },
      { 0: 89, 1: 105 },
    ]);

    const solved = foldNewtonSequence(model);
    const measured = measureCreaseAnglesDegrees(model, solved.positions, solved.branchSigns);
    // The reference cannot reach 95 degrees on the four curved end tucks: driven
    // from its own instrumented build they settle at 91.17 .. 91.52 and it
    // reports the stage Non-Rigid. Reproduce that rather than forcing the target.
    for (const edge of [56, 89, 160, 193]) {
      expect(measured[edge]).toBeGreaterThan(88);
      expect(measured[edge]).toBeLessThan(94);
    }
    // The two straight side creases DO reach their targets in the reference.
    expect(Math.abs(measured[0] - 89)).toBeLessThan(SOLVED_TOLERANCE_DEG);
    expect(Math.abs(measured[1] - 105)).toBeLessThan(SOLVED_TOLERANCE_DEG);
    expect(solved.isSolved).toBe(false);
    // Compact, not the ~697 x 579 open shell the removed calibration produced.
    expect(axisExtent(solved.positions, 0)).toBeLessThan(400);
    expect(axisExtent(solved.positions, 1)).toBeCloseTo(471.7, 0);
  }, 60_000);

  it("reports Non-Rigid when a keyframe cannot reach its authored angles", () => {
    const model = createMilkCartonProject().foldModel;
    if (!model) throw new Error("Milk carton fixture did not produce a fold model");
    const impossible = {
      ...model,
      keyframes: model.keyframes.map((keyframe, index) => (index === 0
        ? { ...keyframe, creaseAnglesDeg: { ...keyframe.creaseAnglesDeg, 2: 179 } }
        : keyframe)),
    };

    const summary = summarizeFolds(impossible);
    expect(summary.keyframes[0].status).toBe("Non-Rigid");
    expect(summary.keyframes[0].unresolvedSeams).toBeGreaterThan(0);
  }, 60_000);
});
