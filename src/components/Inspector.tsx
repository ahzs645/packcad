import type { PackagingProject } from "@packcad/format";
import type { FoldDiagnostics } from "../render/foldSettlement";

interface InspectorProps {
  project: PackagingProject;
  selectedFaceIndex: number | null;
  foldDiagnostics: FoldDiagnostics;
  onSelectStep: (stepId: string) => void;
  onSetAngle: (angle: number) => void;
  onSetThickness: (thicknessMm: number) => void;
}

export function Inspector({
  project,
  selectedFaceIndex,
  foldDiagnostics,
  onSelectStep,
  onSetAngle,
  onSetThickness,
}: InspectorProps) {
  const active = project.foldingSteps.find((step) => step.id === project.activeStepId)
    ?? project.foldingSteps[0];
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
      <div className="selection-card">
        <span>Picked face</span>
        <strong>{selectedFaceIndex === null ? "None" : `Face ${selectedFaceIndex + 1}`}</strong>
        <p>Face selection is resolved by Atelier’s raycast picker against the folded mesh.</p>
      </div>
    </aside>
  );
}
