// Single source of truth for how a fold edge is drawn, shared by the 2D and 3D
// views via the unified scene builder so their edge styling can never drift.

import type { FoldModel } from "@packcad/format";
import {
  activeLockedFaceIndices,
  foldLineKind,
  type FoldLineKind,
} from "./foldLineInteraction";
import { creaseColorForAssignment, type EdgeColorMode } from "./foldViewSettings";

export const BOUNDARY_EDGE_COLOR = "#050505";
export const SOURCE_3D_CREASE_COLOR = "#f7f7f8";
export const SOURCE_2D_CREASE_COLOR = "#d4d4d8";
export const HOVER_EDGE_COLOR = "#f59e0b";
export const SELECTED_EDGE_COLOR = "#ffffff";

// The source does not paint a second green layer over every locked panel. It
// communicates the active bottom panel with one clean blue selection layer.
export const LOCKED_FACE_TINT = "#1677ff";
export const LOCKED_FACE_TINT_OPACITY = 0;
export const SELECTED_FACE_TINT = "#1677ff";
export const SELECTED_FACE_TINT_OPACITY = 0.72;

export type EdgePresentation = "flat-2d" | "folded-3d";

export type EdgeStyle = {
  kind: FoldLineKind;
  /** null when the edge should not be drawn at all (hidden creases). */
  color: string | null;
  dashed: boolean;
  /** multiplier on the base line width (SVG/Line2 only; plain WebGL lines ignore). */
  widthScale: number;
  /** higher = drawn later / on top. */
  renderTier: number;
};

/**
 * Resolve the appearance of a single fold edge. `hovered`/`selected` are passed
 * for the overlay tiers; the base solid/dashed line sets pass both false.
 */
export function resolveEdgeStyle(
  model: FoldModel,
  edgeIndex: number,
  foldStepIndex: number,
  edgeColorMode: EdgeColorMode,
  presentation: EdgePresentation,
  hovered: boolean,
  selected: boolean,
): EdgeStyle {
  const kind = foldLineKind(model, edgeIndex, foldStepIndex);
  const assignment = model.edgesAssignment[edgeIndex] ?? "B";
  const isBoundary = kind === "boundary";

  // Base color + visibility by mode. The die-cut boundary outline is always
  // drawn; only fold creases are hidden in "hidden" mode.
  let color: string | null;
  if (edgeColorMode === "hidden") {
    color = isBoundary ? BOUNDARY_EDGE_COLOR : null;
  } else if (edgeColorMode === "mountain-valley") {
    color = isBoundary
      ? BOUNDARY_EDGE_COLOR
      : assignment === "U" || assignment === "F"
        ? presentation === "folded-3d"
          ? SOURCE_3D_CREASE_COLOR
          : SOURCE_2D_CREASE_COLOR
        : creaseColorForAssignment(assignment);
  } else {
    color = BOUNDARY_EDGE_COLOR;
  }

  // The reference renders its simulation creases as continuous strokes. Its
  // imported 2D dieline strokes are continuous as well; dash patterns are an
  // editor convention that made the rebuilt model look materially different.
  let dashed = false;
  let widthScale = 1;
  let renderTier = 1;

  // A fixed panel changes solver behavior, not the printed edge language. The
  // source keeps its cut boundaries black and its crease assignment colors;
  // painting every edge beside a fixed face white created the bright doubled
  // seams visible in the rebuilt view.
  if (selected) {
    color = SELECTED_EDGE_COLOR;
    dashed = false;
    widthScale = Math.max(widthScale, 2.2);
    renderTier = 19;
  }
  if (hovered) {
    color = HOVER_EDGE_COLOR;
    dashed = false;
    widthScale = Math.max(widthScale, 2.6);
    renderTier = 20;
  }

  return { kind, color, dashed, widthScale, renderTier };
}

/** Face indices held rigid (locked) for the active fold step. */
export function lockedFaceSet(model: FoldModel, foldStepIndex: number): Set<number> {
  return activeLockedFaceIndices(model, foldStepIndex);
}
