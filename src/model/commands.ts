import {
  CommandRegistry,
  type CommandDef,
} from "@atelier/core";
import type {
  CameraProjection,
  CameraPreset,
  PackCadDesign,
  PackagingProject,
  PanelId,
  RenderMode,
  ViewMode,
} from "@packcad/format";
import {
  appendFoldingStep,
  clearPanelSelection,
  importDieline,
  resetArtworkPlacement,
  resetFoldingSimulation,
  selectFoldingStep,
  selectMaterial,
  selectMaterialSpec,
  selectPanel,
  setActiveFoldAngle,
  setArtworkColor,
  setArtworkPlacement,
  setCameraProjection,
  setCameraPreset,
  setFixedPanel,
  setRenderMode,
  setShowHelpers,
  setThickness,
  setViewMode,
  startNewProject,
  toggleHelpers,
} from "./editorMutations";
import {
  addOrigamiKeyframe,
  applyDesign,
  moveOperation,
  renameOperation,
  setOperationCreaseAngle,
  setOperationEnabled,
  setOperationEnforcePrior,
  setOperationTargetAngle,
  toggleModifier,
  toggleOperation,
  toggleOperationLockedFace,
} from "./operationPipeline";

type Run<P> = (project: PackagingProject, params: P) => PackagingProject;

function command<P>(
  type: string,
  label: string,
  inputs: string[],
  run: Run<P>,
): CommandDef<PackagingProject, P> {
  return {
    type,
    category: type.split(".")[0] ?? "project",
    summary: label,
    inputs,
    mutating: true,
    label,
    run,
  };
}

export function createCommandRegistry(): CommandRegistry<PackagingProject> {
  const registry = new CommandRegistry<PackagingProject>();
  const add = <P,>(definition: CommandDef<PackagingProject, P>): void => {
    registry.register(definition);
  };

  add(command("project.new", "New project", [], () => startNewProject()));
  add(command<{ fileName: string; text: string }>(
    "project.importDieline",
    "Import dieline",
    ["fileName", "text"],
    (project, params) => importDieline(project, params.fileName, params.text),
  ));
  add(command<{ material: string }>("material.select", "Select material", ["material"], (project, params) =>
    selectMaterial(project, params.material)));
  add(command<{ specId: string }>("material.selectSpec", "Select material specification", ["specId"], (project, params) =>
    selectMaterialSpec(project, params.specId)));
  add(command<{ thicknessMm: number }>("material.setThickness", "Set board thickness", ["thicknessMm"], (project, params) =>
    setThickness(project, params.thicknessMm)));
  add(command<{ artworkColor: string }>("artwork.setColor", "Set artwork colour", ["artworkColor"], (project, params) =>
    setArtworkColor(project, params.artworkColor)));
  add(command<Partial<PackagingProject["artwork"]>>(
    "artwork.setPlacement",
    "Move artwork",
    [
      "x",
      "y",
      "scale",
      "rotation",
      "imageDataUrl",
      "imageName",
      "backImageDataUrl",
      "backImageName",
      "panelIndex",
    ],
    setArtworkPlacement,
  ));
  add(command("artwork.resetPlacement", "Reset artwork placement", [], resetArtworkPlacement));
  add(command<{ viewMode: ViewMode }>("view.setMode", "Change view mode", ["viewMode"], (project, params) =>
    setViewMode(project, params.viewMode)));
  add(command<{ renderMode: RenderMode }>("view.setRenderMode", "Change render mode", ["renderMode"], (project, params) =>
    setRenderMode(project, params.renderMode)));
  add(command<{ showHelpers: boolean }>("view.setHelpers", "Set helper visibility", ["showHelpers"], (project, params) =>
    setShowHelpers(project, params.showHelpers)));
  add(command("view.toggleHelpers", "Toggle helpers", [], toggleHelpers));
  add(command<{ cameraPreset: CameraPreset }>("view.setCamera", "Change camera", ["cameraPreset"], (project, params) =>
    setCameraPreset(project, params.cameraPreset)));
  add(command<{ projection: CameraProjection }>(
    "view.setProjection",
    "Change camera projection",
    ["projection"],
    (project, params) => setCameraProjection(project, params.projection),
  ));
  add(command<{ panelId: PanelId }>("selection.selectPanel", "Select panel", ["panelId"], (project, params) =>
    selectPanel(project, params.panelId)));
  add(command<{ panelId: PanelId | null }>("fold.setFixedPanel", "Set fixed panel", ["panelId"], (project, params) =>
    setFixedPanel(project, params.panelId)));
  add(command("selection.clearPanel", "Clear panel selection", [], clearPanelSelection));
  add(command<{ stepId: string }>("fold.selectStep", "Select folding step", ["stepId"], (project, params) =>
    selectFoldingStep(project, params.stepId)));
  add(command<{ angle: number }>("fold.setAngle", "Set fold angle", ["angle"], (project, params) =>
    setActiveFoldAngle(project, params.angle)));
  add(command("fold.appendStep", "Add folding step", [], appendFoldingStep));
  add(command("fold.reset", "Reset folding", [], resetFoldingSimulation));

  add(command<{ design: PackCadDesign }>("pipeline.applyDesign", "Apply design", ["design"], (project, params) =>
    applyDesign(project, params.design)));
  add(command<{ operationId: string }>("pipeline.toggleOperation", "Toggle operation", ["operationId"], (project, params) =>
    toggleOperation(project, params.operationId)));
  add(command<{ operationId: string; enabled: boolean }>(
    "pipeline.setOperationEnabled",
    "Set operation enabled",
    ["operationId", "enabled"],
    (project, params) => setOperationEnabled(project, params.operationId, params.enabled),
  ));
  add(command<{ operationId: string; name: string }>("pipeline.renameOperation", "Rename operation", ["operationId", "name"], (project, params) =>
    renameOperation(project, params.operationId, params.name)));
  add(command<{ operationId: string; direction: -1 | 1 }>(
    "pipeline.moveOperation",
    "Move operation",
    ["operationId", "direction"],
    (project, params) => moveOperation(project, params.operationId, params.direction),
  ));
  add(command<{ modifierKey: string }>("pipeline.toggleModifier", "Toggle modifier", ["modifierKey"], (project, params) =>
    toggleModifier(project, params.modifierKey)));
  add(command("pipeline.addOrigamiKeyframe", "Add folding keyframe", [], addOrigamiKeyframe));
  add(command<{ operationId: string; angleDegrees: number; groupIndex?: number }>(
    "pipeline.setTargetAngle",
    "Set operation target angle",
    ["operationId", "angleDegrees", "groupIndex"],
    (project, params) => setOperationTargetAngle(
      project,
      params.operationId,
      params.angleDegrees,
      params.groupIndex,
    ),
  ));
  add(command<{ operationId: string; value: boolean }>(
    "pipeline.enforcePrior",
    "Set prior constraints",
    ["operationId", "value"],
    (project, params) => setOperationEnforcePrior(project, params.operationId, params.value),
  ));
  add(command<{ operationId: string; faceId: string }>(
    "pipeline.toggleLockedFace",
    "Toggle locked face",
    ["operationId", "faceId"],
    (project, params) => toggleOperationLockedFace(project, params.operationId, params.faceId),
  ));
  add(command<{ operationId: string; edgeId: string; angleDegrees: number }>(
    "pipeline.setCreaseAngle",
    "Set crease angle",
    ["operationId", "edgeId", "angleDegrees"],
    (project, params) => setOperationCreaseAngle(
      project,
      params.operationId,
      params.edgeId,
      params.angleDegrees,
    ),
  ));

  return registry;
}
