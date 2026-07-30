import type { FoldingPlayerState } from "@packcad/fold-solver";
import type { ThicknessOffsetDirection } from "@packcad/fold-solver";
import type { PackagingProject, ViewMode } from "@packcad/format";
import type { Object3D } from "three";
import type { UiPreferences, ViewLayout } from "../model/uiPreferences";
import type { CachedFoldSettlement } from "../render/foldSettlement";
import { Icon } from "./Icon";
import { ViewportPane } from "./ViewportPane";

interface ViewportWorkspaceProps {
  project: PackagingProject;
  foldPlayback: FoldingPlayerState;
  settlement: CachedFoldSettlement | null;
  preferences: UiPreferences;
  fitNonce: number;
  notice: string;
  selectedFaceIndex: number | null;
  selectedFoldEdgeIndex: number | null;
  hoveredFoldEdgeIndex: number | null;
  onSelectFace: (faceIndex: number | null) => void;
  onSelectFoldEdge: (edgeIndex: number | null) => void;
  onHoverFoldEdge: (edgeIndex: number | null) => void;
  onSceneObject: (object: Object3D | null) => void;
  onSetViewLayout: (layout: ViewLayout) => void;
  onFit: () => void;
  onToggleGridAxes: () => void;
  onToggleShading: () => void;
  onResetCamera: () => void;
}

export function ViewportWorkspace({
  project,
  foldPlayback,
  settlement,
  preferences,
  fitNonce,
  notice,
  selectedFaceIndex,
  selectedFoldEdgeIndex,
  hoveredFoldEdgeIndex,
  onSelectFace,
  onSelectFoldEdge,
  onHoverFoldEdge,
  onSceneObject,
  onSetViewLayout,
  onFit,
  onToggleGridAxes,
  onToggleShading,
  onResetCamera,
}: ViewportWorkspaceProps) {
  const singleMode = preferences.viewLayout === "single-2d" ? "2d" : "3d";
  const splitOrientation = preferences.viewLayout === "split-horizontal"
    ? "horizontal"
    : preferences.viewLayout === "split-vertical"
      ? "vertical"
      : "none";
  const isSplit = splitOrientation !== "none";
  const thicknessOffsetDirection: ThicknessOffsetDirection =
    preferences.offsetDirection === "top"
      ? "THICKNESS_OFFSET_DIRECTION_FRONT"
      : preferences.offsetDirection === "center"
        ? "THICKNESS_OFFSET_DIRECTION_BOTH"
        : "THICKNESS_OFFSET_DIRECTION_BACK";

  const renderView = (
    mode: ViewMode,
    options: {
      compact?: boolean;
      interactive?: boolean;
      trackScene?: boolean;
    } = {},
  ) => (
    <ViewportPane
      project={project}
      viewMode={mode}
      foldPlayback={foldPlayback}
      settlement={settlement}
      selectedFaceIndex={selectedFaceIndex}
      selectedFoldEdgeIndex={selectedFoldEdgeIndex}
      hoveredFoldEdgeIndex={hoveredFoldEdgeIndex}
      onSelectFace={onSelectFace}
      onSelectFoldEdge={onSelectFoldEdge}
      onHoverFoldEdge={onHoverFoldEdge}
      onSceneObject={options.trackScene ? onSceneObject : undefined}
      panelColorMode={preferences.panelColorMode}
      edgeColorMode={preferences.edgeColorMode}
      showGroundPlane={preferences.groundPlane}
      showOrigin={preferences.origin}
      showShadow={preferences.shadow}
      backgroundColor={
        preferences.darkMode
          ? preferences.backgroundColor
          : mode === "2d" ? "#f2f2f3" : "#ffffff"
      }
      compact={options.compact}
      interactive={options.interactive}
      fitNonce={fitNonce}
      thicknessOffsetDirection={thicknessOffsetDirection}
      fluteAngle={preferences.fluteAngle}
    />
  );

  return (
    <section
      className="viewport"
      data-view-layout={preferences.viewLayout}
      data-view-mode={singleMode}
      data-split-orientation={splitOrientation}
    >
      <div className="viewport-toolbar" role="toolbar" aria-label="Viewport tools">
        <button
          type="button"
          className="icon-button"
          aria-label="Fit to view"
          title="Fit to view"
          onClick={onFit}
        >
          <Icon name="maximize" size={16} />
        </button>
        <button
          type="button"
          className={
            preferences.groundPlane || preferences.origin
              ? "icon-button selected"
              : "icon-button"
          }
          aria-label="Toggle grid + axes"
          title="Toggle grid + axes"
          onClick={onToggleGridAxes}
        >
          <Icon name="grid" size={16} />
        </button>
        <button
          type="button"
          className={
            project.renderMode === "technical"
              ? "icon-button selected"
              : "icon-button"
          }
          aria-label="Toggle shading (solid / technical)"
          title="Shading: solid / technical"
          onClick={onToggleShading}
        >
          <Icon name="contrast" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Reset camera"
          title="Reset camera to isometric"
          onClick={onResetCamera}
        >
          <Icon name="move" size={16} />
        </button>
      </div>

      {isSplit ? (
        <div className="split-view" data-split-orientation={splitOrientation}>
          <div className="viewport-pane-host" data-view-pane="3d">
            {renderView("3d", { interactive: true, trackScene: true })}
            <span className="pane-label">3D</span>
          </div>
          <div className="viewport-pane-host" data-view-pane="2d">
            {renderView("2d", { interactive: true })}
            <span className="pane-label">2D</span>
          </div>
        </div>
      ) : (
        <>
          {renderView(singleMode, {
            interactive: true,
            trackScene: singleMode === "3d",
          })}
          <button
            type="button"
            className="inset"
            aria-label="Toggle 2D/3D View"
            onClick={() => onSetViewLayout(
              singleMode === "3d" ? "single-2d" : "single-3d",
            )}
          >
            {renderView(singleMode === "3d" ? "2d" : "3d", {
              compact: true,
              interactive: false,
              trackScene: singleMode === "2d",
            })}
            <span className="inset-label">
              {singleMode === "3d" ? "2D" : "3D"}
            </span>
          </button>
          <span className="corner-mode">{singleMode.toUpperCase()}</span>
        </>
      )}
      <div className="status-pill" role="status">{notice}</div>
    </section>
  );
}
