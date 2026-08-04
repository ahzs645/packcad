import type { LocalDocumentMetadata } from "@atelier/core";
import type { FoldingPlayerFrame } from "@packcad/fold-solver";
import {
  materialCatalog,
  materialCatalogByGroup,
  type PackagingProject,
} from "@packcad/format";
import { useRef } from "react";
import { packCadLogo } from "../assets/sourceChrome";
import { artworkImageSources } from "../model/artworkPlacement";
import type { PackCadSampleDefinition } from "../model/sampleLibrary";
import type { UiPreferences } from "../model/uiPreferences";
import type { FoldStatusState } from "../render/foldStatus";
import { Icon } from "./Icon";

export const DIELINE_FILE_ACCEPT = ".svg,.dxf,.txt,.json";

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected artwork could not be read."));
    });
    reader.addEventListener(
      "error",
      () => reject(
        reader.error ?? new Error("The selected artwork could not be read."),
      ),
    );
    reader.readAsDataURL(file);
  });
}

function formatThickness(
  thicknessMm: number,
  units: UiPreferences["units"],
): string {
  return units === "mm"
    ? `${thicknessMm.toFixed(1)} mm`
    : `${(thicknessMm / 25.4).toFixed(4)} in`;
}

interface SourceSidebarProps {
  project: PackagingProject;
  preferences: UiPreferences;
  frame: FoldingPlayerFrame;
  playing: boolean;
  foldStatus: FoldStatusState;
  drafts: LocalDocumentMetadata[];
  activeDocumentId: string;
  samples: readonly PackCadSampleDefinition[];
  openSection: "samples" | "material" | "artwork" | null;
  onSetOpenSection: (
    section: "samples" | "material" | "artwork" | null,
  ) => void;
  onLoadSample: (sampleId: string) => void;
  onImport: (file: File) => void;
  onSelectMaterialSpec: (specId: string) => void;
  onSetThickness: (thicknessMm: number) => void;
  onSetArtwork: (
    side: "front" | "back",
    dataUrl: string | null,
    fileName: string | null,
  ) => void;
  onFlipArtwork: () => void;
  onSetArtworkColor: (color: string) => void;
  onUpdatePreferences: (patch: Partial<UiPreferences>) => void;
  onSaveDraft: () => void;
  onOpenDraft: (draft: LocalDocumentMetadata) => void;
  onDeleteDraft: (draft: LocalDocumentMetadata) => void;
  onTogglePlayback: () => void;
  onResetFold: () => void;
  onSelectStep: (stepId: string) => void;
  onAddKeyframe: () => void;
}

export function SourceSidebar({
  project,
  preferences,
  frame,
  playing,
  foldStatus,
  drafts,
  activeDocumentId,
  samples,
  openSection,
  onSetOpenSection,
  onLoadSample,
  onImport,
  onSelectMaterialSpec,
  onSetThickness,
  onSetArtwork,
  onFlipArtwork,
  onSetArtworkColor,
  onUpdatePreferences,
  onSaveDraft,
  onOpenDraft,
  onDeleteDraft,
  onTogglePlayback,
  onResetFold,
  onSelectStep,
  onAddKeyframe,
}: SourceSidebarProps) {
  const dielineInput = useRef<HTMLInputElement>(null);
  const keyframeStatus = foldStatus.status === "ready"
    ? new Map(foldStatus.summary.keyframes.map((item) => [item.id, item]))
    : new Map<string, { status: "Solved" | "Non-Rigid" }>();
  const sources = artworkImageSources(project);

  const readArtworkFile = async (
    file: File | undefined,
    side: "front" | "back",
  ): Promise<void> => {
    if (!file) return;
    onSetArtwork(side, await fileAsDataUrl(file), file.name);
  };

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <img className="brand-logo" src={packCadLogo} alt="PackCAD logo" />
        <div>
          <strong>PackCAD Mockup</strong>
          <span>v1.3.31</span>
        </div>
      </div>

      <section className="workflow">
        <div className="section-title source-section-title">
          <span>Setup</span>
        </div>
        <button
          type="button"
          className={
            openSection === "samples"
              ? "workflow-item open"
              : "workflow-item"
          }
          title="Sample Library"
          aria-expanded={openSection === "samples"}
          onClick={() => onSetOpenSection(
            openSection === "samples" ? null : "samples",
          )}
        >
          <Icon name="box" size={18} />
          <span>Sample Library</span>
        </button>
        {openSection === "samples" ? (
          <div className="workflow-panel sample-library" data-testid="sample-library">
            {samples.map((sample) => (
              <article className="sample-card" key={sample.id}>
                <div className="sample-card-heading">
                  <span className="sample-card-icon"><Icon name="package" size={18} /></span>
                  <span>
                    <strong>{sample.name}</strong>
                    <small>{sample.source}</small>
                  </span>
                </div>
                <p>{sample.description}</p>
                <small className="sample-card-details">{sample.details}</small>
                <button
                  type="button"
                  onClick={() => onLoadSample(sample.id)}
                >
                  Load sample
                </button>
              </article>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="workflow-item active"
          title="Import Dieline"
          onClick={() => dielineInput.current?.click()}
        >
          <Icon name="file-up" size={18} />
          <span>Import Dieline</span>
        </button>
        <input
          ref={dielineInput}
          className="hidden-file"
          type="file"
          accept={DIELINE_FILE_ACCEPT}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onImport(file);
          }}
        />
        <button
          type="button"
          className={
            openSection === "material"
              ? "workflow-item open"
              : "workflow-item"
          }
          title="Material + Thickness"
          aria-expanded={openSection === "material"}
          onClick={() => onSetOpenSection(
            openSection === "material" ? null : "material",
          )}
        >
          <Icon name="layers" size={18} />
          <span>Material + Thickness</span>
        </button>
        {openSection === "material" ? (
          <div className="workflow-panel">
            <label>
              Material
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
                      <option key={spec.id} value={spec.id}>{spec.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {materialCatalog[project.materialSpec]?.group === "corrugated" ? (
              <>
                <label>
                  Flute Size
                  <select
                    value={preferences.fluteSize}
                    onChange={(event) => onUpdatePreferences({
                      fluteSize: event.target.value,
                    })}
                  >
                    {["F Flute", "E Flute", "B Flute", "C Flute", "A Flute"].map(
                      (size) => <option key={size}>{size}</option>,
                    )}
                  </select>
                </label>
                <label>
                  Flute Angle (deg)
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="5"
                    value={preferences.fluteAngle}
                    onChange={(event) => onUpdatePreferences({
                      fluteAngle: event.currentTarget.valueAsNumber,
                    })}
                  />
                </label>
              </>
            ) : null}
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
            <div className="offset-direction" role="group" aria-label="Offset Direction">
              <span>Offset Direction</span>
              <div className="offset-direction-buttons">
                {([
                  ["top", "Front"],
                  ["center", "Both"],
                  ["bottom", "Back"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      preferences.offsetDirection === value ? "active" : ""
                    }
                    aria-pressed={preferences.offsetDirection === value}
                    onClick={() => onUpdatePreferences({ offsetDirection: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          className={
            openSection === "artwork"
              ? "workflow-item open"
              : "workflow-item"
          }
          title="Artwork"
          aria-expanded={openSection === "artwork"}
          onClick={() => onSetOpenSection(
            openSection === "artwork" ? null : "artwork",
          )}
        >
          <Icon name="image" size={18} />
          <span>Artwork</span>
        </button>
        {openSection === "artwork" ? (
          <div className="workflow-panel">
            {(["front", "back"] as const).map((side) => (
              <label className="artwork-upload" key={side}>
                <span>{side === "front" ? "Exterior" : "Interior"}</span>
                {sources[side] ? (
                  <span className="artwork-preview">
                    <img
                      src={sources[side] ?? undefined}
                      alt={`${side === "front" ? "Exterior" : "Interior"} artwork`}
                    />
                    <small>{side === "front"
                      ? sources.frontName
                      : sources.backName}</small>
                  </span>
                ) : (
                  <span className="artwork-upload-empty">Upload image</span>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(event) => {
                    void readArtworkFile(event.currentTarget.files?.[0], side);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              className="artwork-flip"
              onClick={onFlipArtwork}
            >
              <Icon name="arrow-up-down" size={14} />
              Flip exterior / interior
            </button>
            <label>
              Color
              <input
                type="color"
                value={project.artworkColor}
                onChange={(event) => onSetArtworkColor(event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section className="draft-section">
        <div className="section-title">
          <span>Local Drafts</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Save Draft"
            onClick={onSaveDraft}
          >
            <Icon name="save" size={15} />
          </button>
        </div>
        <div className="draft-list">
          {drafts.length > 0 ? drafts.slice(0, 4).map((draft) => (
            <div
              className={
                draft.id === activeDocumentId
                  ? "draft-item active"
                  : "draft-item"
              }
              key={draft.id}
            >
              <button type="button" onClick={() => onOpenDraft(draft)}>
                <span>{draft.name}</span>
                <small>{new Date(draft.updatedAt).toLocaleString()}</small>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete ${draft.name}`}
                onClick={() => onDeleteDraft(draft)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          )) : <p>No local drafts</p>}
        </div>
      </section>

      <section
        className="control-section"
        data-fold-playing={playing ? "true" : "false"}
        data-fold-step-index={frame.stepIndex}
        data-fold-angle={frame.angle.toFixed(2)}
      >
        <div className="section-title">
          <span>Folding Simulation</span>
          <div className="section-actions">
            <button
              type="button"
              className={playing ? "icon-button selected" : "icon-button"}
              aria-label={playing ? "Pause folding simulation" : "Play folding simulation"}
              onClick={onTogglePlayback}
            >
              <Icon name={playing ? "pause" : "play"} size={15} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Reset folding"
              onClick={onResetFold}
            >
              <Icon name="reset" size={15} />
            </button>
          </div>
        </div>
        {project.foldingSteps.map((step) => {
          const stepStatus = keyframeStatus.get(step.id);
          return (
            <div
              key={step.id}
              className={
                step.id === frame.activeStepId ? "step-row active" : "step-row"
              }
              data-playback-active={
                step.id === frame.activeStepId ? "true" : "false"
              }
              data-playback-playing={playing ? "true" : "false"}
            >
              <button
                type="button"
                className="step-select"
                title={step.label}
                onClick={() => onSelectStep(step.id)}
              >
                <Icon name="stack" size={16} />
                <span>{step.label}</span>
                {stepStatus ? (
                  <span
                    className={
                      stepStatus.status === "Solved"
                        ? "step-status solved"
                        : "step-status non-rigid"
                    }
                    aria-label={stepStatus.status}
                  >
                    {stepStatus.status === "Non-Rigid" ? (
                      <Icon name="triangle" size={12} />
                    ) : null}
                  </span>
                ) : null}
                <strong>
                  {Math.round(
                    step.id === frame.activeStepId ? frame.angle : step.angle,
                  )}deg
                </strong>
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="add-step"
          title="Add a folding keyframe"
          onClick={onAddKeyframe}
        >
          <Icon name="package-plus" size={17} />
          <span>Add Keyframe</span>
        </button>
      </section>

      <footer>
        <a href="#">About</a>
        <span>·</span>
        <a href="https://packcad.com/privacy-policy.html">Privacy Policy</a>
        <span>·</span>
        <a href="https://packcad.com/mockup/terms-of-use.html">Terms of Use</a>
      </footer>
    </aside>
  );
}
