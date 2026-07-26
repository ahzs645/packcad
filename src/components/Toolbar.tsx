import type { ViewMode } from "@packcad/format";

interface ToolbarProps {
  viewMode: ViewMode;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  onSetView: (viewMode: ViewMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  onExport: (format: "svg" | "gltf" | "dxf" | "hpgl" | "pdf" | "png") => void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">P</span>
        <span>PackCAD</span>
        <small>Mailer Box</small>
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
