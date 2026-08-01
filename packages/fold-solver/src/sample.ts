import sourceFixture from "./fixtures/mailerBox.packcad.json";
import {
  packCadProjectToProject,
  type PackCadProjectFile,
  type PackagingProject,
} from "@packcad/format";

export function createMailerBoxProject(): PackagingProject {
  const project = packCadProjectToProject(sourceFixture as PackCadProjectFile);
  const model = project.foldModel;
  const returnKeyframe = model?.keyframes[3];
  if (!model || !returnKeyframe) return project;

  // The live v1.3.31 playback resolves the two flat side-return hinges onto
  // the outward branch. The source file exposes only a positive 90° UI angle,
  // so retain that authored value and attach the branch independently.
  const outwardFacePairs: Array<[number, number]> = [[6, 7], [15, 16]];
  const creaseBranchSigns: Record<number, -1 | 1> = {};
  for (const edgeKey of Object.keys(returnKeyframe.creaseAnglesDeg)) {
    const edge = Number(edgeKey);
    const faces = model.edgeFaces[edge] ?? [];
    if (outwardFacePairs.some(([a, b]) => faces.includes(a) && faces.includes(b))) {
      creaseBranchSigns[edge] = -1;
    }
  }
  return {
    ...project,
    foldModel: {
      ...model,
      keyframes: model.keyframes.map((keyframe, index) => index === 3
        ? { ...keyframe, creaseBranchSigns }
        : keyframe),
    },
  };
}
