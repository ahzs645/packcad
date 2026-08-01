import {
  materialCatalogByGroup,
  type PackagingProject,
} from "@packcad/format";
import type {
  UiPreferences,
  ViewLayout,
} from "../model/uiPreferences";
import {
  edgeColorModeOptions,
  panelColorModeOptions,
} from "../render/foldViewSettings";
import { Icon } from "./Icon";

interface PreferencesDialogProps {
  open: boolean;
  project: PackagingProject;
  preferences: UiPreferences;
  onClose: () => void;
  onRestoreDefaults: () => void;
  onUpdate: (patch: Partial<UiPreferences>) => void;
  onSetViewLayout: (layout: ViewLayout) => void;
  onSelectMaterialSpec: (specId: string) => void;
  onSetThickness: (thicknessMm: number) => void;
  onResetCamera: () => void;
}

export function PreferencesDialog({
  open,
  project,
  preferences,
  onClose,
  onRestoreDefaults,
  onUpdate,
  onSetViewLayout,
  onSelectMaterialSpec,
  onSetThickness,
  onResetCamera,
}: PreferencesDialogProps) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="preferences-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <h2 id="preferences-title">Preferences</h2>
            <button
              type="button"
              className="restore-defaults"
              onClick={onRestoreDefaults}
            >
              <Icon name="reset" size={13} />
              Restore Defaults
            </button>
          </div>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close preferences"
            onClick={onClose}
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <p className="dialog-copy">
          These defaults are saved and restored each time you open the app.
        </p>
        <div className="info-bubble">
          <Icon name="monitor" size={16} />
          <span>
            Preferences are stored locally on this device and won&apos;t sync
            across devices.
          </span>
        </div>

        <section className="preference-section">
          <h3>General</h3>
          <label className="preference-row">
            <span>Dark Mode:</span>
            <input
              type="checkbox"
              checked={preferences.darkMode}
              onChange={(event) => onUpdate({
                darkMode: event.target.checked,
              })}
            />
          </label>
          <label className="preference-row">
            <span>Units:</span>
            <select
              value={preferences.units}
              onChange={(event) => onUpdate({
                units: event.target.value as UiPreferences["units"],
              })}
            >
              <option value="mm">mm</option>
              <option value="in">in</option>
            </select>
          </label>
        </section>

        <section className="preference-section">
          <h3>View</h3>
          <label className="preference-row">
            <span>View Layout:</span>
            <select
              value={preferences.viewLayout}
              onChange={(event) =>
                onSetViewLayout(event.target.value as ViewLayout)}
            >
              <option value="single-3d">Folded Model</option>
              <option value="single-2d">Dieline</option>
              <option value="split-horizontal">Split Horizontally</option>
              <option value="split-vertical">Split Vertically</option>
            </select>
          </label>
          <label className="preference-row">
            <span>Panel Color Mode:</span>
            <select
              value={preferences.panelColorMode}
              onChange={(event) => onUpdate({
                panelColorMode:
                  event.target.value as UiPreferences["panelColorMode"],
              })}
            >
              {panelColorModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="preference-row">
            <span>Edge Color Mode:</span>
            <select
              value={preferences.edgeColorMode}
              onChange={(event) => onUpdate({
                edgeColorMode:
                  event.target.value as UiPreferences["edgeColorMode"],
              })}
            >
              {edgeColorModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {([
            ["groundPlane", "Ground Plane"],
            ["shadow", "Shadow"],
            ["origin", "Origin"],
          ] as const).map(([property, label]) => (
            <label className="preference-row" key={property}>
              <span>{label}:</span>
              <input
                type="checkbox"
                checked={preferences[property]}
                onChange={(event) => onUpdate({
                  [property]: event.target.checked,
                })}
              />
            </label>
          ))}
          <label className="preference-row">
            <span>Background Color:</span>
            <input
              type="color"
              value={preferences.backgroundColor}
              onChange={(event) => onUpdate({
                backgroundColor: event.target.value,
              })}
            />
          </label>
        </section>

        <section className="preference-section">
          <h3>Material &amp; Thickness</h3>
          <label className="preference-row">
            <span>Material:</span>
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
                      {spec.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="preference-row">
            <span>Flute Size:</span>
            <select
              value={preferences.fluteSize}
              onChange={(event) => onUpdate({
                fluteSize: event.target.value,
              })}
            >
              {["F Flute", "E Flute", "B Flute", "C Flute", "A Flute"].map(
                (size) => <option key={size}>{size}</option>,
              )}
            </select>
          </label>
          <label className="preference-row">
            <span>Thickness ({preferences.units}):</span>
            <input
              type="number"
              min="0"
              step={preferences.units === "mm" ? "0.1" : "0.0001"}
              value={
                preferences.units === "mm"
                  ? project.thicknessMm.toFixed(1)
                  : (project.thicknessMm / 25.4).toFixed(4)
              }
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (Number.isFinite(value)) {
                  onSetThickness(
                    preferences.units === "mm" ? value : value * 25.4,
                  );
                }
              }}
            />
          </label>
          <div className="preference-row">
            <span>Offset Direction:</span>
            <div className="segmented-icons" role="group" aria-label="Offset Direction">
              {(["top", "center", "bottom"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  className={
                    preferences.offsetDirection === direction ? "selected" : ""
                  }
                  onClick={() => onUpdate({ offsetDirection: direction })}
                >
                  {direction}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="preference-section">
          <h3>Camera</h3>
          <label className="preference-row">
            <span>Camera Type:</span>
            <select
              value={preferences.cameraType}
              onChange={(event) => onUpdate({
                cameraType:
                  event.target.value as UiPreferences["cameraType"],
              })}
            >
              <option value="orthographic">Orthographic</option>
              <option value="perspective">Perspective</option>
            </select>
          </label>
          <div className="dialog-actions">
            <button type="button" onClick={onResetCamera}>
              Reset Camera Position
            </button>
            <button type="button" onClick={onClose}>Done</button>
          </div>
        </section>
      </div>
    </div>
  );
}
