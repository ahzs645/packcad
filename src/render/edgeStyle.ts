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
export const LOCKED_EDGE_COLOR = "#2d9d78";
export const HOVER_EDGE_COLOR = "#f59e0b";
export const SELECTED_EDGE_COLOR = "#ff7a45";

export const LOCKED_FACE_TINT = "#2d9d78";
export const LOCKED_FACE_TINT_OPACITY = 0.18;
export const SELECTED_FACE_TINT = "#ff7a45";
export const SELECTED_FACE_TINT_OPACITY = 0.22;

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
    color = isBoundary ? BOUNDARY_EDGE_COLOR : creaseColorForAssignment(assignment);
  } else {
    color = BOUNDARY_EDGE_COLOR;
  }

  let dashed = kind === "crease";
  let widthScale = 1;
  let renderTier = 1;

  // Locked edges read as a continuous fixed-panel border in every mode.
  if (kind === "locked") {
    color = LOCKED_EDGE_COLOR;
    dashed = false;
    widthScale = 1.45;
    renderTier = 2;
  }
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
