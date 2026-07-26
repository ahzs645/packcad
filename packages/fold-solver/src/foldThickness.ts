// Thickness offset extents for the folded shell (OPERATION_THICKNESS).
//
// The captured modifier carries a `thickness` and a
// THICKNESS_OFFSET_DIRECTION_{FRONT,BACK,BOTH}. The renderer extrudes the folded
// mid-surface into a two-sided shell using these signed front/back extents,
// offsetting each face along its OWN normal (a per-face slab) with a rounded
// bend fillet across creases -- the reference's getOffsetPVertexPosition +
// __bendRadius. Keeping the extents here (pure + framework-free) lets the offset
// direction be verified headlessly.

export type ThicknessOffsetDirection =
  | "THICKNESS_OFFSET_DIRECTION_FRONT"
  | "THICKNESS_OFFSET_DIRECTION_BACK"
  | "THICKNESS_OFFSET_DIRECTION_BOTH";

/** PackCAD's SVG importer uses 72 px/in for both px and pt geometry. */
const SVG_POINTS_PER_INCH = 72;

/** Convert the editor's millimetres into the FOLD geometry's coordinate unit. */
export function thicknessMillimetresToFoldUnits(
  thicknessMm: number,
  coordinateUnit: string,
): number {
  const safeThickness = Number.isFinite(thicknessMm) ? Math.max(0, thicknessMm) : 0;
  switch (coordinateUnit.toLowerCase()) {
    case "px":
    case "pt":
      return safeThickness * SVG_POINTS_PER_INCH / 25.4;
    case "in":
      return safeThickness / 25.4;
    case "cm":
      return safeThickness / 10;
    case "mm":
    default:
      return safeThickness;
  }
}

/** Signed front/back offsets (in mid-surface units) for an offset direction. */
export function offsetExtents(
  thickness: number,
  direction: ThicknessOffsetDirection,
): { front: number; back: number } {
  switch (direction) {
    case "THICKNESS_OFFSET_DIRECTION_FRONT":
      return { front: thickness, back: 0 };
    case "THICKNESS_OFFSET_DIRECTION_BACK":
      return { front: 0, back: -thickness };
    case "THICKNESS_OFFSET_DIRECTION_BOTH":
    default:
      return { front: thickness / 2, back: -thickness / 2 };
  }
}
