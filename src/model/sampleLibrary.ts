import { createMailerBoxProject } from "@packcad/fold-solver";
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
] as const;

export function createPackCadSampleProject(sampleId: string): PackagingProject {
  switch (sampleId) {
    case "live-mailer-box":
      return createMailerBoxProject();
    default:
      throw new Error(`Unknown PackCAD sample: ${sampleId}`);
  }
}
