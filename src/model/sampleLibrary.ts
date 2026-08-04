import {
  createCurvedBoxProject,
  createMailerBoxProject,
  createMilkCartonProject,
  createPillowBoxProject,
} from "@packcad/fold-solver";
import type { PackagingProject } from "@packcad/format";

export type PackCadSampleDefinition = {
  id: string;
  name: string;
  source: string;
  description: string;
  details: string;
};

export const packCadSampleLibrary: readonly PackCadSampleDefinition[] = [
  {
    id: "live-mailer-box",
    name: "Live Mailer Box",
    source: "PackCAD Mockup v1.3.31",
    description: "The artwork, E-flute stock, thickness, and five folding keyframes from the live PackCAD example.",
    details: "19 panels · 5 keyframes · exterior + interior artwork",
  },
  {
    id: "milk-carton",
    name: "Milk Carton",
    source: "PackCAD Mockup v1.3.4",
    description: "The imported milk-carton dieline with five authored folding stages and seam-closure checks.",
    details: "25 panels · 5 keyframes · gable closure",
  },
  {
    id: "curved-box",
    name: "Curved Box",
    source: "PackCAD Mockup v1.3.0",
    description: "A curved-panel package used to verify that assembly checks preserve sampled curved boundaries.",
    details: "80 panels · 4 keyframes · 76 curved edges",
  },
  {
    id: "pillow-box",
    name: "Pillow Box",
    source: "PackCAD Mockup v1.3.0",
    description: "The source non-rigid pillow simulation, including its staged open-shell branch and bowed end.",
    details: "67 panels · 2 non-rigid keyframes · 88 curved edges",
  },
] as const;

export function createPackCadSampleProject(sampleId: string): PackagingProject {
  switch (sampleId) {
    case "live-mailer-box":
      return createMailerBoxProject();
    case "milk-carton":
      return createMilkCartonProject();
    case "curved-box":
      return createCurvedBoxProject();
    case "pillow-box":
      return createPillowBoxProject();
    default:
      throw new Error(`Unknown PackCAD sample: ${sampleId}`);
  }
}
