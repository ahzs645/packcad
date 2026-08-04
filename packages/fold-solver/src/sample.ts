import sourceFixture from "./fixtures/mailerBox.packcad.json";
import milkCartonFixture from "./fixtures/milkCarton.packcad.json";
import curvedBoxFixture from "./fixtures/curvedBox.packcad.json";
import pillowBoxFixture from "./fixtures/pillowBox.packcad.json";
import {
  packCadProjectToProject,
  type PackCadProjectFile,
  type PackagingProject,
} from "@packcad/format";

// Bundled PackCAD sample documents. These are ordinary imports: every sample
// goes through exactly the same parse-and-solve path as a user-opened file, so
// nothing here can make a bundled fixture behave differently from an import.

export function createMailerBoxProject(): PackagingProject {
  return packCadProjectToProject(sourceFixture as PackCadProjectFile);
}

export function createMilkCartonProject(): PackagingProject {
  return packCadProjectToProject(milkCartonFixture as PackCadProjectFile);
}

export function createCurvedBoxProject(): PackagingProject {
  return packCadProjectToProject(curvedBoxFixture as PackCadProjectFile);
}

export function createPillowBoxProject(): PackagingProject {
  return packCadProjectToProject(pillowBoxFixture as PackCadProjectFile);
}
