import {
  createCurvedBoxProject,
  createMailerBoxProject,
  createMilkCartonProject,
  createPillowBoxProject,
  createSideLoadVhsProject,
  createBetamaxSlipcoverProject,
  createCassetteLabelSheetProject,
  createMiniDiscLabelSheetProject,
  createVhsFaceLabelSheetProject,
  createVhsSlipcoverProject,
  createVhsSpineLabelSheetProject,
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
  {
    id: "side-load-vhs",
    name: "Side-load VHS Slipcover",
    source: "TaperCraft public template vector trace",
    description: "A side-loading VHS sleeve with the traced public cut contour, printable glue zones, and a solved four-stage folding animation.",
    details: "11 panels · 2 glue flaps · 4 solved keyframes",
  },
  {
    id: "vhs-slipcover",
    name: "VHS Slipcover",
    source: "TaperCraft public Tabloid/A3 template",
    description: "The traced top-loading VHS sleeve contour with closure flaps, glue areas, and a three-stage fold.",
    details: "7 panels · 2 glue flaps · 3 keyframes",
  },
  {
    id: "betamax-slipcover",
    name: "Betamax Slipcover",
    source: "TaperCraft public Letter/A4 template",
    description: "The traced Betamax sleeve contour with its rounded closure, glue flaps, and editable folding stages.",
    details: "7 panels · 2 glue flaps · 3 keyframes",
  },
  {
    id: "vhs-face-label-sheet",
    name: "VHS Face Label Sheet",
    source: "TaperCraft public Photopea template",
    description: "Ten measured, rounded VHS face-label cutouts on a Letter sheet.",
    details: "10 labels · Letter sheet · vector cuts",
  },
  {
    id: "vhs-spine-label-sheet",
    name: "VHS Spine Label Sheet",
    source: "TaperCraft public Photopea template",
    description: "Fifteen measured VHS spine-label strips on a Letter sheet.",
    details: "15 labels · Letter sheet · vector cuts",
  },
  {
    id: "cassette-label-sheet",
    name: "Cassette Label Sheet",
    source: "TaperCraft public Photopea template",
    description: "Twelve cassette face-label blanks reconstructed from the public two-column print sheet.",
    details: "12 labels · Letter sheet · vector cuts",
  },
  {
    id: "minidisc-label-sheet",
    name: "MiniDisc Label Sheet",
    source: "TaperCraft public Photopea template",
    description: "Twelve MiniDisc face labels plus twelve matching spine/shutter strips on an A4 sheet.",
    details: "24 pieces · A4 sheet · vector cuts",
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
    case "side-load-vhs":
      return createSideLoadVhsProject();
    case "vhs-slipcover":
      return createVhsSlipcoverProject();
    case "betamax-slipcover":
      return createBetamaxSlipcoverProject();
    case "vhs-face-label-sheet":
      return createVhsFaceLabelSheetProject();
    case "vhs-spine-label-sheet":
      return createVhsSpineLabelSheetProject();
    case "cassette-label-sheet":
      return createCassetteLabelSheetProject();
    case "minidisc-label-sheet":
      return createMiniDiscLabelSheetProject();
    default:
      throw new Error(`Unknown PackCAD sample: ${sampleId}`);
  }
}
