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
    ]);
    const project = createPackCadSampleProject("live-mailer-box");
    expect(project.design?.name).toBe("MailerBox");
    expect(project.foldModel?.verticesCoords).toHaveLength(104);
    expect(project.foldModel?.facesVertices).toHaveLength(19);
    expect(project.materialSpec).toBe(
      "MATERIAL_CORRUGATED_CARDBOARD_E_FLUTE",
    );
    expect(project.thicknessMm).toBeCloseTo(0.0625 * 25.4, 10);
  });

  it.each([
    ["milk-carton", "milk_carton", 57, 25],
    ["curved-box", "curvedbox", 198, 80],
    ["pillow-box", "pillowbox", 176, 67],
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
