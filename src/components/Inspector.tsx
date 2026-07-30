import {
  panelDefinitions,
  type OrigamiSimulationOperation,
  type PackagingProject,
  type PanelId,
} from "@packcad/format";
import { foldEdgeId } from "../render/foldLineInteraction";
import type { FoldDiagnostics } from "../render/foldSettlement";
import type { FoldStatusState } from "../render/foldStatus";

interface InspectorProps {
  project: PackagingProject;
  selectedFaceIndex: number | null;
  selectedFoldEdgeIndex: number | null;
  foldDiagnostics: FoldDiagnostics;
  foldStatus: FoldStatusState;
  foldPlaying: boolean;
  foldProgress: number;
  onToggleFoldPlayback: () => void;
  onSelectStep: (stepId: string) => void;
  onSetAngle: (angle: number) => void;
  onSetThickness: (thicknessMm: number) => void;
  onSetFixedPanel: (panelId: PanelId | null) => void;
  onAppendStep: () => void;
  onResetFold: () => void;
  onAddOrigamiKeyframe: () => void;
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
}

function finiteNumber(value: number, run: (value: number) => void): void {
  if (Number.isFinite(value)) run(value);
}

export function Inspector({
  project,
  selectedFaceIndex,
  selectedFoldEdgeIndex,
  foldDiagnostics,
  foldStatus,
  foldPlaying,
  foldProgress,
  onToggleFoldPlayback,
  onSelectStep,
  onSetAngle,
  onSetThickness,
  onSetFixedPanel,
  onAppendStep,
  onResetFold,
  onAddOrigamiKeyframe,
  onSetTargetAngle,
  onSetEnforcePrior,
  onToggleLockedFace,
  onSetCreaseAngle,
}: InspectorProps) {
  const active = project.foldingSteps.find((step) => step.id === project.activeStepId)
    ?? project.foldingSteps[0];
  const activeOperation = project.design?.operations.find(
    (operation): operation is OrigamiSimulationOperation =>
      operation.id === active?.id
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
  const setupActive = active?.id === project.foldingSteps[0]?.id;

  return (
    <aside className="inspector panel">
      <div className="panel-heading">
        <span>Inspector</span>
        <span className="status-dot" />
      </div>
      <label>
        Folding stage
        <select value={project.activeStepId} onChange={(event) => onSelectStep(event.target.value)}>
          {project.foldingSteps.map((step) => (
            <option value={step.id} key={step.id}>{step.label}</option>
          ))}
        </select>
      </label>
      <label>
        Fold angle <output>{active?.angle.toFixed(0) ?? 0}°</output>
        <input
          type="range"
          min="0"
          max="180"
          step="1"
          value={active?.angle ?? 0}
          onChange={(event) => onSetAngle(event.currentTarget.valueAsNumber)}
        />
      </label>
      <div className="fold-playback">
        <button
          type="button"
          className={foldPlaying ? "active" : ""}
          onClick={onToggleFoldPlayback}
          disabled={project.foldingSteps.length <= 1}
          aria-label={foldPlaying ? "Pause fold playback" : "Play fold playback"}
        >
          {foldPlaying ? "❚❚ Pause" : "▶ Play"}
        </button>
        <label>
          Playback
          <output>{Math.round(foldProgress * 100)}%</output>
          <progress max="1" value={foldProgress} />
        </label>
      </div>
      <div className="fold-author-actions">
        {project.design ? (
          <button type="button" onClick={onAddOrigamiKeyframe}>Add keyframe</button>
        ) : (
          <button type="button" onClick={onAppendStep}>Append step</button>
        )}
        <button type="button" onClick={onResetFold}>Reset fold</button>
      </div>
      {setupActive ? (
        <div className="authoring-card">
          <strong>Folding setup</strong>
          <label>
            Fixed panel
            <select
              value={project.fixedPanelId ?? ""}
              onChange={(event) =>
                onSetFixedPanel((event.currentTarget.value || null) as PanelId | null)}
            >
              <option value="">None</option>
              {Object.entries(panelDefinitions).map(([panelId, definition]) => (
                <option value={panelId} key={panelId}>{definition.label}</option>
              ))}
            </select>
          </label>
          <p>The chosen panel remains fixed while authoring manual fold steps.</p>
        </div>
      ) : null}
      {activeOperation ? (
        <div className="authoring-card">
          <strong>Keyframe authoring</strong>
          <div className="crease-constraints">
            <span>Crease constraints</span>
            {selectedEdgeId ? (
              <label>
                Selected crease <output>Edge {selectedFoldEdgeIndex! + 1}</output>
                <input
                  type="number"
                  min="-180"
                  max="180"
                  value={Math.round(selectedCreaseAngle)}
                  onChange={(event) => finiteNumber(
                    event.currentTarget.valueAsNumber,
                    (angleDegrees) =>
                      onSetCreaseAngle(activeOperation.id, selectedEdgeId, angleDegrees),
                  )}
                />
              </label>
            ) : (
              <p>Select a crease in the 2D or 3D viewport to author its angle.</p>
            )}
            {activeOperation.foldingEdgeGroups.map((group, groupIndex) => (
              <label
                className={
                  selectedFoldEdgeIndex !== null
                  && activeKeyframe?.creaseEdgeGroup[selectedFoldEdgeIndex] === groupIndex
                    ? "active-constraint"
                    : ""
                }
                key={`${group.edgeIDs.join(":")}:${groupIndex}`}
              >
                Group {groupIndex + 1} · {group.edgeIDs.length} crease
                {group.edgeIDs.length === 1 ? "" : "s"}
                <input
                  type="number"
                  min="-180"
                  max="180"
                  value={Math.round(group.targetAngleDegrees)}
                  onChange={(event) => finiteNumber(
                    event.currentTarget.valueAsNumber,
                    (angleDegrees) =>
                      onSetTargetAngle(activeOperation.id, angleDegrees, groupIndex),
                  )}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={activeOperation.enforcePriorConstraints}
            className={activeOperation.enforcePriorConstraints ? "author-switch active" : "author-switch"}
            onClick={() => onSetEnforcePrior(
              activeOperation.id,
              !activeOperation.enforcePriorConstraints,
            )}
          >
            Enforce prior constraints
          </button>
          <div className="locked-faces">
            <span>Locked panels</span>
            {lockedFaces.length ? (
              <ul>
                {lockedFaces.map(({ faceId, faceIndex }) => (
                  <li key={faceId}>
                    <span>{faceIndex >= 0 ? `Panel ${faceIndex + 1}` : faceId}</span>
                    <button
                      type="button"
                      onClick={() => onToggleLockedFace(activeOperation.id, faceId)}
                    >
                      Unlock
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No panels locked for this keyframe.</p>
            )}
            {selectedFaceId ? (
              <button
                type="button"
                onClick={() => onToggleLockedFace(activeOperation.id, selectedFaceId)}
              >
                {selectedFaceLocked ? "Unlock selected panel" : "Lock selected panel"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <label>
        Board thickness <output>{project.thicknessMm.toFixed(2)} mm</output>
        <input
          type="range"
          min="0.4"
          max="4"
          step="0.05"
          value={project.thicknessMm}
          onChange={(event) => onSetThickness(event.currentTarget.valueAsNumber)}
        />
      </label>
      <div className="selection-card solver-card" aria-live="polite">
        <span>Settled solve</span>
        {foldDiagnostics.status === "settling" ? (
          <strong>Settling…</strong>
        ) : foldDiagnostics.status === "error" ? (
          <>
            <strong>Invalid fold</strong>
            <p>{foldDiagnostics.message}</p>
          </>
        ) : (
          <>
            <strong>{foldDiagnostics.converged ? "Converged" : "Non-converging"}</strong>
            <p>
              Edge error {foldDiagnostics.maxEdgeError.toExponential(2)}
              <br />
              Angle error {foldDiagnostics.maxAngleErrorDeg.toExponential(2)}°
            </p>
          </>
        )}
      </div>
      {project.foldModel ? (
        <div className="selection-card solver-card" aria-live="polite">
          <span>Project fold status</span>
          {foldStatus.status === "solving" ? (
            <strong>Solving…</strong>
          ) : foldStatus.status === "error" ? (
            <>
              <strong>Unavailable</strong>
              <p>{foldStatus.message}</p>
            </>
          ) : foldStatus.status === "ready" ? (
            <>
              <strong>{foldStatus.summary.overall.status}</strong>
              <p>{foldStatus.summary.overall.message}</p>
            </>
          ) : (
            <strong>Unavailable</strong>
          )}
        </div>
      ) : null}
      <div className="selection-card">
        <span>Viewport selection</span>
        <strong>
          {selectedFoldEdgeIndex !== null
            ? `Crease ${selectedFoldEdgeIndex + 1}`
            : selectedFaceIndex === null ? "None" : `Face ${selectedFaceIndex + 1}`}
        </strong>
        <p>Faces and creases use Atelier’s raycast picker against the current folded geometry.</p>
      </div>
    </aside>
  );
}
