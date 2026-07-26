export type PanelColorMode = "artwork" | "material" | "multicolor";

export type EdgeColorMode = "black" | "mountain-valley" | "hidden";

export const panelColorModeOptions: Array<{ value: PanelColorMode; label: string }> = [
  { value: "artwork", label: "Artwork" },
  { value: "material", label: "White" },
  { value: "multicolor", label: "Multicolor" },
];

export const edgeColorModeOptions: Array<{ value: EdgeColorMode; label: string }> = [
  { value: "mountain-valley", label: "Mountain / Valley" },
  { value: "black", label: "Black" },
  { value: "hidden", label: "Hidden" },
];

// Evenly-distributed distinct hues via the golden-ratio conjugate, matching the
// source's HSL multicolor mode (instead of a small fixed palette that repeats).
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

export function panelColorForIndex(index: number): string {
  const hue = ((Math.abs(index) * GOLDEN_RATIO_CONJUGATE) % 1) * 360;
  return `hsl(${hue.toFixed(1)}, 55%, 52%)`;
}

export function creaseColorForAssignment(assignment: string | undefined): string {
  if (assignment === "M") return "#d93025";
  if (assignment === "V") return "#2f6fed";
  if (assignment === "F") return "#71717a";
  return "#050505";
}
