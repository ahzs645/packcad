import {
  addFoldingStep,
  createImportedDieline,
  createProject,
  materials,
  resetFolding,
  type CameraProjection,
  type CameraPreset,
  type MaterialId,
  type PackagingProject,
  type PanelId,
  type RenderMode,
  type ViewMode,
} from "@packcad/format";
import { materialCatalog } from "@packcad/format";

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function isMaterialId(value: string): value is MaterialId {
  return value in materials;
}

export function startNewProject(): PackagingProject {
  return createProject();
}

export function importDieline(
  project: PackagingProject,
  fileName: string,
  text: string,
): PackagingProject {
  return {
    ...project,
    dieline: createImportedDieline(fileName, text),
  };
}

export function selectMaterial(
  project: PackagingProject,
  material: string,
): PackagingProject {
  return {
    ...project,
    material: isMaterialId(material) ? material : project.material,
  };
}

export function selectMaterialSpec(
  project: PackagingProject,
  specId: string,
): PackagingProject {
  const spec = materialCatalog[specId];
  if (!spec) return project;
  return {
    ...project,
    materialSpec: spec.id,
    material: isMaterialId(spec.swatch) ? spec.swatch : project.material,
    thicknessMm: clampNumber(spec.thicknessIn * 25.4, 0.4, 4),
  };
}

export function setThickness(
  project: PackagingProject,
  thicknessMm: number,
): PackagingProject {
  return {
    ...project,
    thicknessMm: clampNumber(thicknessMm, 0.4, 4),
  };
}

export function setArtworkColor(
  project: PackagingProject,
  artworkColor: string,
): PackagingProject {
  return /^#[0-9a-f]{6}$/i.test(artworkColor)
    ? { ...project, artworkColor }
    : project;
}

export function setArtworkPlacement(
  project: PackagingProject,
  placement: Partial<PackagingProject["artwork"]>,
): PackagingProject {
  return {
    ...project,
    artwork: {
      ...project.artwork,
      x: clampNumber(placement.x ?? project.artwork.x, -1, 1),
      y: clampNumber(placement.y ?? project.artwork.y, -1, 1),
      scale: clampNumber(placement.scale ?? project.artwork.scale, 0.25, 2),
      rotation: clampNumber(placement.rotation ?? project.artwork.rotation, -180, 180),
      imageDataUrl: placement.imageDataUrl === undefined
        ? project.artwork.imageDataUrl
        : placement.imageDataUrl,
      imageName: placement.imageName === undefined
        ? project.artwork.imageName
        : placement.imageName,
      panelIndex: placement.panelIndex === undefined
        ? project.artwork.panelIndex
        : placement.panelIndex,
    },
  };
}

export function resetArtworkPlacement(project: PackagingProject): PackagingProject {
  return setArtworkPlacement(project, {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
  });
}

export function setViewMode(
  project: PackagingProject,
  viewMode: ViewMode,
): PackagingProject {
  return {
    ...project,
    viewMode,
  };
}

export function setRenderMode(
  project: PackagingProject,
  renderMode: RenderMode,
): PackagingProject {
  return {
    ...project,
    renderMode,
  };
}

export function setShowHelpers(
  project: PackagingProject,
  showHelpers: boolean,
): PackagingProject {
  return {
    ...project,
    showHelpers,
  };
}

export function toggleHelpers(project: PackagingProject): PackagingProject {
  return setShowHelpers(project, !project.showHelpers);
}

export function setCameraPreset(
  project: PackagingProject,
  cameraPreset: CameraPreset,
): PackagingProject {
  return {
    ...project,
    cameraPreset,
  };
}

export function setCameraProjection(
  project: PackagingProject,
  projection: CameraProjection,
): PackagingProject {
  return {
    ...project,
    projection,
  };
}

export function selectPanel(
  project: PackagingProject,
  selectedPanelId: PanelId,
): PackagingProject {
  return {
    ...project,
    selectedPanelId,
  };
}

export function setFixedPanel(
  project: PackagingProject,
  panelId: PanelId | null,
): PackagingProject {
  return { ...project, fixedPanelId: panelId };
}

export function clearPanelSelection(project: PackagingProject): PackagingProject {
  return {
    ...project,
    selectedPanelId: null,
  };
}

export function selectFoldingStep(
  project: PackagingProject,
  stepId: string,
): PackagingProject {
  return project.foldingSteps.some((step) => step.id === stepId)
    ? { ...project, activeStepId: stepId }
    : project;
}

export function setActiveFoldAngle(
  project: PackagingProject,
  angle: number,
): PackagingProject {
  const nextAngle = clampNumber(angle, 0, 180);
  return {
    ...project,
    foldingSteps: project.foldingSteps.map((step) =>
      step.id === project.activeStepId ? { ...step, angle: nextAngle } : step,
    ),
  };
}

export function appendFoldingStep(project: PackagingProject): PackagingProject {
  if (project.design) return project;
  return addFoldingStep(project);
}

export function resetFoldingSimulation(project: PackagingProject): PackagingProject {
  if (project.design) {
    return {
      ...project,
      activeStepId: project.foldingSteps[0]?.id ?? project.activeStepId,
    };
  }
  return resetFolding(project);
}
