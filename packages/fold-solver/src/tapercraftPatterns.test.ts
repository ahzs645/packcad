import { describe, expect, it } from "vitest";
import { solveFoldTimeline } from "./foldTimelineSolver";
import { advanceFoldingPlayer, createFoldingPlayer } from "./foldingPlayer";
import { createCardDeckBoxProject, createVhsSlipcoverProject } from "./tapercraftPatterns";

describe("TaperCraft pattern animation", () => {
  it("imports the card-deck tuck box with all production fold stages", () => {
    const project = createCardDeckBoxProject();
    const model = project.foldModel!;

    expect(project.design?.name).toBe("Playing Card Tuck Box");
    expect(model.facesVertices).toHaveLength(13);
    expect(model.keyframes).toHaveLength(8);
    expect(model.interiorFaceIndices).toEqual([4, 6, 7, 8, 9, 10, 11, 12]);

    const solved = solveFoldTimeline(model, model.keyframes.length, 90);
    expect(solved.method).toBe("rigid-tree");
    expect(solved.positions.flat().every(Number.isFinite)).toBe(true);
    expect(Object.values(solved.creaseAnglesDeg)).toHaveLength(12);
  });

  it("folds the VHS slipcover as an exact rigid hinge tree", () => {
    const project = createVhsSlipcoverProject();
    const model = project.foldModel!;
    const finalStep = model.keyframes.length;
    const finalAngle = Math.max(
      ...Object.values(model.keyframes.at(-1)!.creaseAnglesDeg).map(Math.abs),
    );
    const solved = solveFoldTimeline(model, finalStep, finalAngle);

    expect(model.rigidTimeline).toBe(true);
    expect(model.interiorFaceIndices).toEqual([4, 6, 7, 8]);
    expect(model.keyframes).toHaveLength(5);
    expect(solved.method).toBe("rigid-tree");
    expect(Object.values(solved.creaseAnglesDeg)).toHaveLength(8);
    expect(Object.values(solved.creaseAnglesDeg).every((angle) => angle === 90)).toBe(true);
    expect(solved.positions.flat().every(Number.isFinite)).toBe(true);

    const tuckPositions = model.facesVertices[6].map((vertex) => solved.positions[vertex]);
    const tuckZ = tuckPositions.map((position) => position[2]);
    const tuckY = tuckPositions.map((position) => position[1]);
    expect(Math.max(...tuckZ) - Math.min(...tuckZ)).toBeCloseTo(0, 8);
    expect(Math.max(...tuckZ)).toBeCloseTo(-1.0123, 4);
    expect(Math.max(...tuckZ)).toBeLessThan(0);
    expect(Math.max(...tuckY)).toBeLessThanOrEqual(7.4105 + 1e-8);

    const edgeErrors = model.edgesVertices.map(([a, b], edge) => {
      const flatA = model.verticesCoords[a];
      const flatB = model.verticesCoords[b];
      const foldedA = solved.positions[a];
      const foldedB = solved.positions[b];
      const flatLength = Math.hypot(flatA[0] - flatB[0], flatA[1] - flatB[1]);
      const foldedLength = Math.hypot(
        foldedA[0] - foldedB[0],
        foldedA[1] - foldedB[1],
        foldedA[2] - foldedB[2],
      );
      return { edge, a, b, flatLength, foldedLength, error: Math.abs(foldedLength - flatLength) };
    }).sort((left, right) => right.error - left.error);
    expect(edgeErrors[0]).toMatchObject({ error: expect.closeTo(0, 8) });

    let player = createFoldingPlayer(project, { playing: true });
    for (let frame = 0; frame < 20 && !player.finished; frame += 1) {
      player = advanceFoldingPlayer(project, player, 480);
    }
    expect(player.finished).toBe(true);
    expect(player.positions).toEqual(solved.positions);
  });
});
