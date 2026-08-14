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

    // Cut-only corner contacts must remain separate vertices. Welding them
    // makes unrelated flaps fight over one position during rigid playback.
    for (let vertexIndex = 0; vertexIndex < model.verticesCoords.length; vertexIndex += 1) {
      const incidentFaces = model.facesVertices.flatMap((loop, faceIndex) =>
        loop.includes(vertexIndex) ? [faceIndex] : []);
      if (incidentFaces.length < 2) continue;
      const connectedFaces = new Set<number>([incidentFaces[0]]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const faceIndex of incidentFaces) {
          if (connectedFaces.has(faceIndex)) continue;
          const connectedByEdge = model.facesEdges[faceIndex].some((edgeIndex) =>
            model.edgesVertices[edgeIndex].includes(vertexIndex)
            && model.edgeFaces[edgeIndex].some((neighbor) => connectedFaces.has(neighbor)));
          if (connectedByEdge) {
            connectedFaces.add(faceIndex);
            changed = true;
          }
        }
      }
      expect(connectedFaces.size, `vertex ${vertexIndex} joins disconnected flap fans`).toBe(
        incidentFaces.length,
      );
    }

    const frontVertices = model.facesVertices[1].map((vertex) => solved.positions[vertex]);
    const boxMinX = Math.min(...frontVertices.map(([x]) => x));
    const boxMaxX = Math.max(...frontVertices.map(([x]) => x));
    for (const faceIndex of [7, 8, 9, 11]) {
      const flapVertices = model.facesVertices[faceIndex].map((vertex) => solved.positions[vertex]);
      expect(Math.min(...flapVertices.map(([x]) => x))).toBeGreaterThanOrEqual(boxMinX - 1e-8);
      expect(Math.max(...flapVertices.map(([x]) => x))).toBeLessThanOrEqual(boxMaxX + 1e-8);
    }
    const boxMinZ = Math.min(...frontVertices.map(([, , z]) => z));
    const backVertices = model.facesVertices[3].map((vertex) => solved.positions[vertex]);
    const boxMaxZ = Math.max(...backVertices.map(([, , z]) => z));
    for (const faceIndex of [6, 7, 8, 9, 10, 11, 12]) {
      const flapVertices = model.facesVertices[faceIndex].map((vertex) => solved.positions[vertex]);
      expect(Math.min(...flapVertices.map(([, , z]) => z))).toBeGreaterThanOrEqual(boxMinZ - 1e-8);
      expect(Math.max(...flapVertices.map(([, , z]) => z))).toBeLessThanOrEqual(boxMaxZ + 1e-8);
    }
    expect(model.edgeFaces.filter((faces) => faces.length > 1)).toHaveLength(12);

    let player = createFoldingPlayer(project, { playing: true });
    for (let frame = 0; frame < 40 && !player.finished; frame += 1) {
      player = advanceFoldingPlayer(project, player, 240);
      expect(player.positions?.flat().every(Number.isFinite)).toBe(true);
      for (const [a, b] of model.edgesVertices) {
        const flatA = model.verticesCoords[a];
        const flatB = model.verticesCoords[b];
        const foldedA = player.positions![a];
        const foldedB = player.positions![b];
        expect(Math.hypot(
          foldedA[0] - foldedB[0],
          foldedA[1] - foldedB[1],
          foldedA[2] - foldedB[2],
        )).toBeCloseTo(Math.hypot(flatA[0] - flatB[0], flatA[1] - flatB[1]), 8);
      }
    }
    expect(player.finished).toBe(true);
    expect(player.positions).toEqual(solved.positions);
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
