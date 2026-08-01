import {
  materialCatalogByGroup,
  materials,
  panelDefinitions,
  type OrigamiSimulationOperation,
  type PackagingProject,
  type PanelId,
} from "@packcad/format";
import { artworkPlacementForFace } from "../model/artworkPlacement";
import type { UiPreferences } from "../model/uiPreferences";
import { foldEdgeId } from "../render/foldLineInteraction";
import type { FoldDiagnostics } from "../render/foldSettlement";
import type { FoldStatusState } from "../render/foldStatus";
import { Icon } from "./Icon";

interface InspectorProps {
  open: boolean;
  project: PackagingProject;
  displayedActiveStepId: string;
  selectedFaceIndex: number | null;
  selectedFoldEdgeIndex: number | null;
  foldDiagnostics: FoldDiagnostics;
  foldStatus: FoldStatusState;
  preferences: UiPreferences;
  onSetFixedPanel: (panelId: PanelId | null) => void;
  onRenameOperation: (operationId: string, name: string) => void;
  onSetTargetAngle: (
    operationId: string,
    angleDegrees: number,
    groupIndex?: number,
  ) => void;
  onSetEnforcePrior: (operationId: string, value: boolean) => void;
  onToggleLockedFace: (operationId: string, faceId: string) => void;
  onSetCreaseAngle: (
    operationId: string,
    edgeId: string,
    angleDegrees: number,
  ) => void;
  onSetCamera: (cameraPreset: PackagingProject["cameraPreset"]) => void;
  onSetHelpers: (showHelpers: boolean) => void;
  onSelectMaterial: (material: string) => void;
  onSelectMaterialSpec: (specId: string) => void;
  onSetThickness: (thicknessMm: number) => void;
  onSetFoldAngle: (angle: number) => void;
  onSetArtworkColor: (color: string) => void;
  onSetArtworkPlacement: (
    placement: Partial<PackagingProject["artwork"]>,
  ) => void;
  onResetArtworkPlacement: () => void;
  onToggleOperation: (operationId: string) => void;
  onMoveOperation: (operationId: string, direction: -1 | 1) => void;
  onToggleModifier: (modifierKey: string) => void;
}

function finiteNumber(value: number, run: (value: number) => void): void {
  if (Number.isFinite(value)) run(value);
}

function formatThickness(
  thicknessMm: number,
  units: UiPreferences["units"],
): string {
  return units === "mm"
    ? `${thicknessMm.toFixed(1)} mm`
    : `${(thicknessMm / 25.4).toFixed(4)} in`;
}

export function Inspector({
  open,
  project,
  displayedActiveStepId,
  selectedFaceIndex,
  selectedFoldEdgeIndex,
  foldDiagnostics,
  foldStatus,
  preferences,
  onSetFixedPanel,
  onRenameOperation,
  onSetTargetAngle,
  onSetEnforcePrior,
  onToggleLockedFace,
  onSetCreaseAngle,
  onSetCamera,
  onSetHelpers,
  onSelectMaterial,
  onSelectMaterialSpec,
  onSetThickness,
  onSetFoldAngle,
  onSetArtworkColor,
  onSetArtworkPlacement,
  onResetArtworkPlacement,
  onToggleOperation,
  onMoveOperation,
  onToggleModifier,
}: InspectorProps) {
  const activeStep = project.foldingSteps.find(
    (step) => step.id === displayedActiveStepId,
  ) ?? project.foldingSteps[0];
  const activeOperation = project.design?.operations.find(
    (operation): operation is OrigamiSimulationOperation =>
      operation.id === displayedActiveStepId
      && operation.type === "OPERATION_ORIGAMI_SIMULATION",
  ) ?? null;
  const activeKeyframe = project.foldModel?.keyframes.find(
    (keyframe) => keyframe.id === activeOperation?.id,
  ) ?? null;
  const selectedEdgeId = selectedFoldEdgeIndex === null || !project.foldModel
    ? null
    : foldEdgeId(project.foldModel, selectedFoldEdgeIndex);
  const selectedCreaseAngle = selectedFoldEdgeIndex === null
    ? 0
    : activeKeyframe?.creaseAnglesDeg[selectedFoldEdgeIndex] ?? 0;
  const selectedFaceId = selectedFaceIndex === null
    ? null
    : project.foldModel?.facesIDs[selectedFaceIndex] ?? null;
  const selectedFaceLocked = Boolean(
    selectedFaceId && activeOperation?.fixedFaceIDs.includes(selectedFaceId),
  );
  const lockedFaces = activeOperation?.fixedFaceIDs.map((faceId) => ({
    faceId,
    faceIndex: project.foldModel?.facesIDs.indexOf(faceId) ?? -1,
  })) ?? [];
  const keyframeStatus = foldStatus.status === "ready"
    ? new Map(foldStatus.summary.keyframes.map((item) => [item.id, item]))
    : new Map<string, { status: "Solved" | "Non-Rigid" }>();
  const selectedMaterial = materials[project.material];
  const completion = Math.round(((activeStep?.angle ?? 0) / 110) * 100);

  return (
    <aside className={open ? "inspector open" : "inspector"}>
      <div className="inspector-card">
        <div className="card-heading">
          <Icon name="box" size={17} />
          <strong>Project</strong>
        </div>
        <dl>
          <div><dt>Dieline</dt><dd>{project.dieline.name}</dd></div>
          <div>
            <dt>Status</dt>
            <dd>
              {project.dieline.kind === "sample"
                ? "Sample carton dieline"
                : `${project.dieline.kind.toUpperCase()} import`}
            </dd>
          </div>
          <div><dt>Fold</dt><dd>{completion}% closed</dd></div>
          <div>
            <dt>Solve</dt>
            <dd>
              {foldStatus.status === "solving"
                ? "Solving…"
                : foldStatus.status === "ready"
                  ? foldStatus.summary.overall.status
                  : "Unavailable"}
            </dd>
          </div>
          <div><dt>Render</dt><dd>{project.renderMode}</dd></div>
          <div><dt>Camera</dt><dd>{project.cameraPreset}</dd></div>
          <div>
            <dt>Selected</dt>
            <dd>
              {selectedFoldEdgeIndex !== null
                ? `Crease ${selectedFoldEdgeIndex + 1}`
                : selectedFaceIndex !== null
                  ? `Panel ${selectedFaceIndex + 1}`
                  : "None"}
            </dd>
          </div>
        </dl>
      </div>

      {displayedActiveStepId === project.foldingSteps[0]?.id ? (
        <div className="inspector-card folding-setup">
          <div className="card-heading">
            <Icon name="settings" size={15} />
            <strong>Folding Setup</strong>
          </div>
          <label>
            Bottom Panel
            <select
              value={project.fixedPanelId ?? ""}
              onChange={(event) =>
                onSetFixedPanel((event.target.value || null) as PanelId | null)}
            >
              <option value="">None selected</option>
              {Object.entries(panelDefinitions).map(([id, item]) => (
                <option key={id} value={id}>{item.label}</option>
              ))}
            </select>
          </label>
          <p className="hint">
            The bottom panel stays fixed while the folding simulation runs.
          </p>
        </div>
      ) : null}

      {activeOperation ? (
        <div className="inspector-card keyframe-editor">
          <div className="card-heading">
            <Icon name="stack" size={15} />
            <strong>Folding Keyframe</strong>
          </div>
          <label>
            Name
            <input
              type="text"
              value={activeOperation.name}
              onChange={(event) =>
                onRenameOperation(activeOperation.id, event.target.value)}
            />
          </label>
          <div className="keyframe-status">
            <span>Status</span>
            <span
              className={
                keyframeStatus.get(activeOperation.id)?.status === "Non-Rigid"
                  ? "solve-badge non-rigid"
                  : "solve-badge solved"
              }
            >
              {keyframeStatus.get(activeOperation.id)?.status === "Non-Rigid"
                ? "⚠ Non-Rigid"
                : "Solved"}
            </span>
          </div>
          <div className="keyframe-constraints">
            <span className="constraints-label">Crease Constraints</span>
            {activeOperation.foldingEdgeGroups.length === 0
            || activeOperation.foldingEdgeGroups.every(
              (group) => Math.round(group.targetAngleDegrees) === 0,
            ) ? (
              <p className="keyframe-warning">
                No fold angles set, select a crease to set its fold angle.
              </p>
            ) : null}
            {selectedEdgeId ? (
              <div className="constraint-row selected-crease">
                <span>Selected crease</span>
                <input
                  type="number"
                  min="-180"
                  max="180"
                  value={Math.round(selectedCreaseAngle)}
                  onChange={(event) => finiteNumber(
                    event.currentTarget.valueAsNumber,
                    (angle) => onSetCreaseAngle(
                      activeOperation.id,
                      selectedEdgeId,
                      angle,
                    ),
                  )}
                />
                <span className="deg">deg</span>
              </div>
            ) : null}
            {activeOperation.foldingEdgeGroups.map((group, groupIndex) => (
              <div
                className={
                  selectedFoldEdgeIndex !== null
                  && activeKeyframe?.creaseEdgeGroup[selectedFoldEdgeIndex]
                    === groupIndex
                    ? "constraint-row active-group"
                    : "constraint-row"
                }
                key={`${group.edgeIDs.join(":")}:${groupIndex}`}
              >
                <span>
                  {group.edgeIDs.length} Edge
                  {group.edgeIDs.length === 1 ? "" : "s"}
                </span>
                <input
                  type="number"
                  min="-180"
                  max="180"
                  value={Math.round(group.targetAngleDegrees)}
                  onChange={(event) => finiteNumber(
                    event.currentTarget.valueAsNumber,
                    (angle) => onSetTargetAngle(
                      activeOperation.id,
                      angle,
                      groupIndex,
                    ),
                  )}
                />
                <span className="deg">deg</span>
              </div>
            ))}
          </div>
          <div className="keyframe-toggle-row">
            <span>Enforce Prior Constraints</span>
            <button
              type="button"
              role="switch"
              aria-checked={activeOperation.enforcePriorConstraints}
              className={
                activeOperation.enforcePriorConstraints
                  ? "ui-switch on"
                  : "ui-switch"
              }
              onClick={() => onSetEnforcePrior(
                activeOperation.id,
                !activeOperation.enforcePriorConstraints,
              )}
            >
              <span className="ui-switch-thumb" />
            </button>
          </div>
          <p className="keyframe-hint">
            Select creases in the 2D or 3D view to set their fold angles.
          </p>
          <div className="keyframe-constraints locked-panels">
            <span className="constraints-label">Locked Panels</span>
            {lockedFaces.length === 0 ? (
              <p className="keyframe-hint subtle">
                No locked panels. Select a panel and lock it to hold it rigid.
              </p>
            ) : (
              <ul className="locked-panel-list">
                {lockedFaces.map(({ faceIndex, faceId }) => (
                  <li key={faceId}>
                    <span>
                      {faceIndex >= 0 ? `Panel #${faceIndex + 1}` : faceId}
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        onToggleLockedFace(activeOperation.id, faceId)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedFaceId ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() =>
                  onToggleLockedFace(activeOperation.id, selectedFaceId)}
              >
                {selectedFaceLocked
                  ? "Unlock selected panel"
                  : "Lock selected panel"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="inspector-card">
        <div className="viewport-controls">
          <label>
            Camera
            <select
              value={project.cameraPreset}
              onChange={(event) =>
                onSetCamera(
                  event.target.value as PackagingProject["cameraPreset"],
                )}
            >
              <option value="isometric">Isometric</option>
              <option value="front">Front</option>
              <option value="top">Top</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={project.showHelpers}
              onChange={(event) => onSetHelpers(event.target.checked)}
            />
            Helpers
          </label>
        </div>
        <div className="material-grid" aria-label="Material swatches">
          {Object.entries(materials).map(([id, item]) => (
            <button
              type="button"
              key={id}
              className={
                id === project.material
                  ? "material-swatch selected"
                  : "material-swatch"
              }
              onClick={() => onSelectMaterial(id)}
              title={item.description}
            >
              <span
                className="swatch-chip"
                style={{
                  backgroundColor: item.color,
                  backgroundImage: `url(${item.texture})`,
                }}
              />
              <span>
                <strong>{item.label}</strong>
                <em>{item.finish} · {item.grain}</em>
              </span>
            </button>
          ))}
        </div>
        <label>
          Material (full taxonomy)
          <select
            value={project.materialSpec}
            onChange={(event) => onSelectMaterialSpec(event.target.value)}
          >
            {Object.entries(materialCatalogByGroup()).map(([group, specs]) => (
              <optgroup
                key={group}
                label={group === "paperboard" ? "Paperboard" : "Corrugated"}
              >
                {specs.map((spec) => (
                  <option key={spec.id} value={spec.id}>
                    {spec.label} — {spec.thicknessIn.toFixed(3)} in
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p>{selectedMaterial.description}</p>
        <dl className="material-facts">
          <div><dt>Finish</dt><dd>{selectedMaterial.finish}</dd></div>
          <div><dt>Grain</dt><dd>{selectedMaterial.grain}</dd></div>
          <div>
            <dt>Roughness</dt>
            <dd>{selectedMaterial.roughness.toFixed(2)}</dd>
          </div>
        </dl>
        <label>
          Thickness
          <input
            type="range"
            min="0.4"
            max="4"
            step="any"
            value={project.thicknessMm}
            onChange={(event) =>
              onSetThickness(event.currentTarget.valueAsNumber)}
          />
          <span>{formatThickness(project.thicknessMm, preferences.units)}</span>
        </label>
        <label>
          Active fold angle
          <input
            type="range"
            min="0"
            max="180"
            step="1"
            value={activeStep?.angle ?? 0}
            onChange={(event) =>
              onSetFoldAngle(event.currentTarget.valueAsNumber)}
          />
          <span>{(activeStep?.angle ?? 0).toFixed(0)} deg</span>
        </label>
        <label>
          Place artwork on panel
          <select
            value={project.artwork.panelIndex ?? ""}
            disabled={!project.foldModel}
            onChange={(event) => {
              if (!project.foldModel || event.target.value === "") {
                onSetArtworkPlacement({ panelIndex: null });
                return;
              }
              const placement = artworkPlacementForFace(
                project.foldModel,
                Number(event.target.value),
              );
              if (placement) onSetArtworkPlacement(placement);
            }}
          >
            <option value="">UV atlas centre</option>
            {project.foldModel?.facesVertices.map((_, faceIndex) => (
              <option
                value={faceIndex}
                key={project.foldModel?.facesIDs[faceIndex] ?? faceIndex}
              >
                Panel {faceIndex + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          Artwork color
          <input
            type="color"
            value={project.artworkColor}
            onChange={(event) => onSetArtworkColor(event.target.value)}
          />
        </label>
        <div className="compact-grid">
          {([
            ["x", "Artwork X", -1, 1, 0.05],
            ["y", "Artwork Y", -1, 1, 0.05],
            ["scale", "Artwork scale", 0.25, 2, 0.05],
            ["rotation", "Artwork rotation", -180, 180, 1],
          ] as const).map(([property, label, min, max, step]) => (
            <label key={property}>
              {label}
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={project.artwork[property]}
                onChange={(event) => onSetArtworkPlacement({
                  [property]: event.currentTarget.valueAsNumber,
                })}
              />
              <span>
                {property === "rotation"
                  ? `${project.artwork[property].toFixed(0)} deg`
                  : project.artwork[property].toFixed(2)}
              </span>
            </label>
          ))}
        </div>
        <button
          type="button"
          className="secondary-action reset-artwork"
          onClick={onResetArtworkPlacement}
        >
          Reset artwork placement
        </button>
        <div className="solver-summary" aria-live="polite">
          <span>Settled solve</span>
          <strong>
            {foldDiagnostics.status === "settling"
              ? "Settling…"
              : foldDiagnostics.status === "error"
                ? "Unavailable"
                : foldDiagnostics.converged
                  ? "Converged"
                  : "Non-converging"}
          </strong>
        </div>
      </div>

      {project.design ? (
        <div className="inspector-card operation-pipeline">
          <h2>Operation pipeline</h2>
          <p className="hint">
            Source-owned pipeline from the captured design. Edits re-derive the fold.
          </p>
          <ol className="operation-list">
            {project.design.operations.map((operation, index) => (
              <li
                key={operation.id}
                className={[
                  "operation",
                  operation.enabled ? "" : "disabled",
                  operation.id === displayedActiveStepId ? "active" : "",
                ].filter(Boolean).join(" ")}
              >
                <label className="operation-toggle">
                  <input
                    type="checkbox"
                    checked={operation.enabled}
                    onChange={() => onToggleOperation(operation.id)}
                  />
                  <span>
                    <strong>{operation.name}</strong>
                    <em>{operation.type.replace(/^OPERATION_/, "")}</em>
                  </span>
                </label>
                <div className="operation-actions">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => onMoveOperation(operation.id, -1)}
                  >↑</button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === project.design!.operations.length - 1}
                    onClick={() => onMoveOperation(operation.id, 1)}
                  >↓</button>
                </div>
              </li>
            ))}
          </ol>
          <div className="modifier-toggles">
            {Object.entries(project.design.modifiers)
              .filter((entry): entry is [
                string,
                NonNullable<(typeof project.design)["modifiers"][string]>,
              ] => Boolean(entry[1]))
              .map(([modifierKey, modifier]) => (
                <label key={modifierKey} className="operation-toggle">
                  <input
                    type="checkbox"
                    checked={modifier.enabled}
                    onChange={() => onToggleModifier(modifierKey)}
                  />
                  <span>{modifier.name}</span>
                </label>
              ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
