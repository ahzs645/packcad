import sourceFixture from "./fixtures/mailerBox.packcad.json";
import {
  packCadProjectToProject,
  type PackCadProjectFile,
  type PackagingProject,
} from "@packcad/format";

export function createMailerBoxProject(): PackagingProject {
  const project = packCadProjectToProject(sourceFixture as PackCadProjectFile);
  const model = project.foldModel;
  if (!model) return project;
  return {
    ...project,
    foldModel: {
      ...model,
      keyframes: model.keyframes.map((keyframe, index) => index === 3
        ? { ...keyframe, creaseBranchSigns: { 0: 1, 11: 1 } }
        : keyframe),
    },
  };
}
