import type { LocalDocumentMetadata } from "@atelier/core";
import type { ViewMode } from "@packcad/format";
import { useRef, type ChangeEvent } from "react";
import type { ProjectSaveState } from "../persistence/projectDocuments";

export const DIELINE_FILE_ACCEPT = ".svg,.dxf,.txt,.json";

interface ToolbarProps {
  documentName: string;
  drafts: LocalDocumentMetadata[];
  activeDocumentId: string;
  persistenceReady: boolean;
  saveState: ProjectSaveState;
  viewMode: ViewMode;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  onNew: () => void;
  onOpenDraft: (draft: LocalDocumentMetadata) => void;
  onSaveAs: () => void;
  onRename: () => void;
  onDeleteDraft: (draft: LocalDocumentMetadata) => void;
  onImport: (file: File) => void;
  onSetView: (viewMode: ViewMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: (format: "svg" | "gltf" | "dxf" | "hpgl" | "pdf" | "png") => void;
}

export function Toolbar(props: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) props.onImport(file);
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <span>PackCAD</span>
        <small title={props.documentName}>{props.documentName}</small>
      </div>
      <div className="toolbar-group" aria-label="File">
        <button type="button" disabled={!props.persistenceReady} onClick={props.onNew}>
          New
        </button>
        <details className="draft-menu">
          <summary>Drafts</summary>
          <div className="draft-menu-popover">
            <div className="draft-menu-actions">
              <button
                type="button"
                disabled={!props.persistenceReady}
                onClick={props.onSaveAs}
              >
                Save as…
              </button>
              <button
                type="button"
                disabled={!props.persistenceReady}
                onClick={props.onRename}
              >
                Rename…
              </button>
            </div>
            <span className="draft-menu-heading">Open draft</span>
            <div className="draft-list">
              {props.drafts.length === 0 ? (
                <p>No saved drafts</p>
              ) : props.drafts.map((draft) => (
                <div
                  className={draft.id === props.activeDocumentId ? "active" : ""}
                  key={draft.id}
                >
                  <button
                    type="button"
                    className="draft-open"
                    onClick={() => props.onOpenDraft(draft)}
                  >
                    <strong>{draft.name}</strong>
                    <small>{new Date(draft.updatedAt).toLocaleString()}</small>
                  </button>
                  <button
                    type="button"
                    className="draft-delete"
                    aria-label={`Delete ${draft.name}`}
                    onClick={() => props.onDeleteDraft(draft)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </details>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Import…
        </button>
        <input
          ref={fileInputRef}
          className="hidden-file"
          type="file"
          accept={DIELINE_FILE_ACCEPT}
          aria-label="Import dieline file"
          onChange={handleFileChange}
        />
        <span
          className={`save-state ${props.saveState}`}
          role="status"
          title={props.saveState === "error" ? "Local draft save failed" : undefined}
        >
          {!props.persistenceReady
            ? "Loading…"
            : props.saveState === "saving"
              ? "Saving…"
              : props.saveState === "error"
                ? "Save failed"
                : "Saved"}
        </span>
      </div>
      <div className="toolbar-group" aria-label="History">
        <button type="button" disabled={!props.canUndo} onClick={props.onUndo} title={props.undoLabel ?? "Undo"}>
          ↶ Undo
        </button>
        <button type="button" disabled={!props.canRedo} onClick={props.onRedo} title={props.redoLabel ?? "Redo"}>
          ↷ Redo
        </button>
      </div>
      <div className="toolbar-group segmented" aria-label="View">
        {(["2d", "3d"] as const).map((mode) => (
          <button
            type="button"
            className={props.viewMode === mode ? "active" : ""}
            onClick={() => props.onSetView(mode)}
            key={mode}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="toolbar-group export-group" aria-label="Export">
        {(["svg", "gltf", "dxf", "hpgl", "pdf", "png"] as const).map((format) => (
          <button type="button" onClick={() => props.onExport(format)} key={format}>
            {format === "gltf" ? "glTF" : format.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}
