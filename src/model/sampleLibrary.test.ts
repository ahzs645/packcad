import { describe, expect, it } from "vitest";
import {
  createPackCadSampleProject,
  packCadSampleLibrary,
} from "./sampleLibrary";

describe("PackCAD sample library", () => {
  it("loads the live Mailer Box as a normal editable project", () => {
    expect(packCadSampleLibrary.map((sample) => sample.id)).toEqual([
      "live-mailer-box",
      "milk-carton",
      "curved-box",
      "pillow-box",
      "side-load-vhs",
      "vhs-slipcover",
      "betamax-slipcover",
      "card-deck-box",
    ]);
    const project = createPackCadSampleProject("live-mailer-box");
    expect(project.design?.name).toBe("MailerBox");
    expect(project.foldModel?.verticesCoords).toHaveLength(106);
    expect(project.foldModel?.facesVertices).toHaveLength(19);
    expect(project.materialSpec).toBe(
      "MATERIAL_CORRUGATED_CARDBOARD_E_FLUTE",
    );
    expect(project.thicknessMm).toBeCloseTo(0.0625 * 25.4, 10);
  });

  it.each([
    ["milk-carton", "milk_carton", 53, 25],
    ["curved-box", "curvedbox", 202, 80],
    ["pillow-box", "pillowbox", 176, 67],
    ["side-load-vhs", "Side-load VHS Slipcover", 28, 11],
    ["vhs-slipcover", "VHS Slipcover", 64, 9],
    ["betamax-slipcover", "Betamax Slipcover", 16, 7],
    ["card-deck-box", "Playing Card Tuck Box", 64, 13],
  ] as const)(
    "loads %s with its source geometry",
    (sampleId, designName, vertices, faces) => {
      const project = createPackCadSampleProject(sampleId);
      expect(project.design?.name).toBe(designName);
      expect(project.foldModel?.verticesCoords).toHaveLength(vertices);
      expect(project.foldModel?.facesVertices).toHaveLength(faces);
    },
  );

  it.each(packCadSampleLibrary.map((sample) => [sample.id] as const))(
    "%s has no disconnected face fans welded at one vertex",
    (sampleId) => {
      const model = createPackCadSampleProject(sampleId).foldModel;
      expect(model).toBeDefined();
      for (let vertexIndex = 0; vertexIndex < model!.verticesCoords.length; vertexIndex += 1) {
        const incidentFaces = model!.facesVertices.flatMap((loop, faceIndex) =>
          loop.includes(vertexIndex) ? [faceIndex] : []);
        if (incidentFaces.length < 2) continue;

        const connectedFaces = new Set<number>([incidentFaces[0]]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const faceIndex of incidentFaces) {
            if (connectedFaces.has(faceIndex)) continue;
            const connectedByEdge = model!.facesEdges[faceIndex].some((edgeIndex) =>
              model!.edgesVertices[edgeIndex].includes(vertexIndex)
              && model!.edgeFaces[edgeIndex].some((neighbor) => connectedFaces.has(neighbor)));
            if (connectedByEdge) {
              connectedFaces.add(faceIndex);
              changed = true;
            }
          }
        }
        expect(connectedFaces.size, `vertex ${vertexIndex} joins disconnected face fans`).toBe(
          incidentFaces.length,
        );
      }
    },
  );

  it("rejects sample ids that are not in the library", () => {
    expect(() => createPackCadSampleProject("missing")).toThrow(
      "Unknown PackCAD sample: missing",
    );
  });
});
