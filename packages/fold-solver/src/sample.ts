import sourceFixture from "./fixtures/mailerBox.packcad.json";
import {
  packCadProjectToProject,
  type PackCadProjectFile,
  type PackagingProject,
} from "@packcad/format";

export function createMailerBoxProject(): PackagingProject {
  return packCadProjectToProject(sourceFixture as PackCadProjectFile);
}
