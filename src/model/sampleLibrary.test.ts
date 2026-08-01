import { describe, expect, it } from "vitest";
import {
  createPackCadSampleProject,
  packCadSampleLibrary,
} from "./sampleLibrary";

describe("PackCAD sample library", () => {
  it("loads the live Mailer Box as a normal editable project", () => {
    expect(packCadSampleLibrary.map((sample) => sample.id)).toEqual([
      "live-mailer-box",
    ]);
    const project = createPackCadSampleProject("live-mailer-box");
    expect(project.design?.name).toBe("MailerBox");
    expect(project.foldModel?.verticesCoords).toHaveLength(74);
    expect(project.foldModel?.facesVertices).toHaveLength(19);
    expect(project.materialSpec).toBe(
      "MATERIAL_CORRUGATED_CARDBOARD_E_FLUTE",
    );
    expect(project.thicknessMm).toBeCloseTo(0.0625 * 25.4, 10);
  });

  it("rejects sample ids that are not in the library", () => {
    expect(() => createPackCadSampleProject("missing")).toThrow(
      "Unknown PackCAD sample: missing",
    );
  });
});
