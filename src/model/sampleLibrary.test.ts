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
      "vhs-face-label-sheet",
      "vhs-spine-label-sheet",
      "cassette-label-sheet",
      "minidisc-label-sheet",
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
    ["vhs-slipcover", "VHS Slipcover", 16, 7],
    ["betamax-slipcover", "Betamax Slipcover", 16, 7],
    ["vhs-face-label-sheet", "VHS Face Label Sheet", 40, 10],
    ["vhs-spine-label-sheet", "VHS Spine Label Sheet", 60, 15],
    ["cassette-label-sheet", "Cassette Label Sheet", 28, 12],
    ["minidisc-label-sheet", "MiniDisc Label Sheet", 96, 24],
  ] as const)(
    "loads %s with its source geometry",
    (sampleId, designName, vertices, faces) => {
      const project = createPackCadSampleProject(sampleId);
      expect(project.design?.name).toBe(designName);
      expect(project.foldModel?.verticesCoords).toHaveLength(vertices);
      expect(project.foldModel?.facesVertices).toHaveLength(faces);
    },
  );

  it("rejects sample ids that are not in the library", () => {
    expect(() => createPackCadSampleProject("missing")).toThrow(
      "Unknown PackCAD sample: missing",
    );
  });
});
