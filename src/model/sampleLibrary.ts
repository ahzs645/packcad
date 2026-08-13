import {
  createCurvedBoxProject,
  createMailerBoxProject,
  createMilkCartonProject,
  createPillowBoxProject,
  createSideLoadVhsProject,
  createBetamaxSlipcoverProject,
  createCardDeckBoxProject,
  createVhsSlipcoverProject,
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
    source: "TaperCraft production Tabloid/A3 template",
    description: "The production top-loading VHS cut geometry with two spine panels, a folding tuck closure, and the single side-seam glue flap.",
    details: "9 panels · 1 glue flap · 5 keyframes",
  },
  {
    id: "betamax-slipcover",
    name: "Betamax Slipcover",
    source: "TaperCraft public Letter/A4 template",
    description: "The traced Betamax sleeve contour with its rounded closure, glue flaps, and editable folding stages.",
    details: "7 panels · 2 glue flaps · 3 keyframes",
  },
  {
    id: "card-deck-box",
    name: "Playing Card Tuck Box",
    source: "TaperCraft Card Box production template",
    description: "The playing-card tuck carton traced from the downloaded generator, including its thumb notch, dust flaps, locking closures, and side-seam glue tab.",
    details: "13 panels · 1 glue flap · 8 keyframes",
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
    case "card-deck-box":
      return createCardDeckBoxProject();
    default:
      throw new Error(`Unknown PackCAD sample: ${sampleId}`);
  }
}
