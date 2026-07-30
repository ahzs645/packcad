import type { FoldModel } from "./foldGeometry";
import type { PackCadDesign } from "./packcadProject";

export type ViewMode = "3d" | "2d";

export type RenderMode = "solid" | "technical";

export type CameraPreset = "isometric" | "front" | "top";

export type CameraProjection = "perspective" | "orthographic";

export type MaterialId =
  | "chipboard"
  | "corrugated"
  | "flute"
  | "kraft";

export type MaterialFinish = "matte" | "natural" | "corrugated" | "fluted";

export type MaterialGrain = "fine" | "medium" | "coarse" | "fluted";

export type MaterialDefinition = {
  label: string;
  texture: string;
  color: string;
  description: string;
  finish: MaterialFinish;
  grain: MaterialGrain;
  roughness: number;
  metalness: number;
  fluteDirection?: "horizontal" | "vertical";
};

export type FoldingStep = {
  id: string;
  label: string;
  angle: number;
};

export type DielineSource = {
  name: string;
  kind: "sample" | "svg" | "text";
  text: string;
};

export type ArtworkPlacement = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /**
   * Uploaded artwork is stored with the project rather than as an object URL so
   * undo/redo, IndexedDB drafts, and reopened sessions all see the same image.
   */
  imageDataUrl?: string | null;
  imageName?: string | null;
  /**
   * The face used by the "place on panel" affordance. Rendering still uses the
   * source FOLD UV atlas; this index records the author's chosen target.
   */
  panelIndex?: number | null;
};

export type PanelId =
  | "center"
  | "left-flap"
  | "right-flap"
  | "top-flap"
  | "bottom-flap"
  | "artwork";

export const panelDefinitions: Record<PanelId, { label: string }> = {
  center: { label: "Center Panel" },
  "left-flap": { label: "Left Flap" },
  "right-flap": { label: "Right Flap" },
  "top-flap": { label: "Top Flap" },
  "bottom-flap": { label: "Bottom Flap" },
  artwork: { label: "Artwork Patch" },
};

export type PackagingProject = {
  material: MaterialId;
  thicknessMm: number;
  artworkColor: string;
  artwork: ArtworkPlacement;
  viewMode: ViewMode;
  renderMode: RenderMode;
  showHelpers: boolean;
  cameraPreset: CameraPreset;
  projection: CameraProjection;
  selectedPanelId: PanelId | null;
  /** Bottom/fixed panel for the folding simulation (Folding Setup). */
  fixedPanelId: PanelId | null;
  activeStepId: string;
  foldingSteps: FoldingStep[];
  dieline: DielineSource;
  /** Captured MATERIAL_* spec id (full taxonomy); `material` is its swatch. */
  materialSpec: string;
  /**
   * Real FOLD crease-pattern geometry + fold timeline, present only when the
   * project was opened from a captured PackCAD document. Derived (not persisted
   * by the editable save format).
   */
  foldModel?: FoldModel | null;
  /**
   * The captured, source-owned operation pipeline + modifiers, present only
   * when opened from a PackCAD document. Editable via operationPipeline.ts;
   * the fold model / steps / material are re-derived from it. Not persisted by
   * the editable save format.
   */
  design?: PackCadDesign | null;
};

// Resolve the app's public base path without depending on Vite's client types
// (this package typechecks standalone). Vite still statically injects the value.
const ASSET_BASE =
  (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

export const materials: Record<MaterialId, MaterialDefinition> = {
  chipboard: {
    label: "Chipboard",
    texture: `${ASSET_BASE}assets/chipboard.jpg`,
    color: "#c8b394",
    description: "Smooth recycled board for compact retail packaging.",
    finish: "matte",
    grain: "fine",
    roughness: 0.74,
    metalness: 0.02,
  },
  corrugated: {
    label: "Corrugated cardboard",
    texture: `${ASSET_BASE}assets/corrugated_cardboard.jpg`,
    color: "#b98f5a",
    description: "Brown corrugated stock with visible fiber variation.",
    finish: "corrugated",
    grain: "coarse",
    roughness: 0.88,
    metalness: 0.01,
    fluteDirection: "vertical",
  },
  flute: {
    label: "Single-wall flute",
    texture: `${ASSET_BASE}assets/corrugated_flute_single_layer_sideband.jpg`,
    color: "#d0a66b",
    description: "Sideband flute preview for thicker structural folds.",
    finish: "fluted",
    grain: "fluted",
    roughness: 0.91,
    metalness: 0.01,
    fluteDirection: "horizontal",
  },
  kraft: {
    label: "Kraft paperboard",
    texture: `${ASSET_BASE}assets/kraft_paperboard.jpg`,
    color: "#bc8d55",
    description: "Warm kraft board for natural-package mockups.",
    finish: "natural",
    grain: "medium",
    roughness: 0.82,
    metalness: 0.02,
  },
};

const defaultSteps: FoldingStep[] = [
  { id: "setup", label: "Folding Setup", angle: 0 },
  { id: "fold-1", label: "Folding Keyframe 1", angle: 18 },
  { id: "fold-2", label: "Folding Keyframe 2", angle: 38 },
  { id: "fold-3", label: "Folding Keyframe 3", angle: 58 },
  { id: "fold-4", label: "Folding Keyframe 4", angle: 76 },
  { id: "fold-5", label: "Folding Keyframe 5", angle: 92 },
];

export const sampleDieline = `<svg viewBox="0 0 520 360" xmlns="http://www.w3.org/2000/svg">
  <path d="M170 80h180v140H170z" fill="none" stroke="#111"/>
  <path d="M170 80H88v140h82M350 80h82v140h-82" fill="none" stroke="#111"/>
  <path d="M170 80V28h180v52M170 220v84h180v-84" fill="none" stroke="#111"/>
  <path d="M170 80h180M170 220h180M170 80v140M350 80v140" fill="none" stroke="#d23b3b" stroke-dasharray="8 6"/>
</svg>`;

export function createProject(): PackagingProject {
  return {
    material: "kraft",
    thicknessMm: 1.6,
    artworkColor: "#2f6fed",
    artwork: {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      imageDataUrl: null,
      imageName: null,
      panelIndex: null,
    },
    viewMode: "3d",
    renderMode: "solid",
    showHelpers: true,
    cameraPreset: "isometric",
    projection: "perspective",
    selectedPanelId: null,
    fixedPanelId: null,
    activeStepId: "setup",
    materialSpec: "MATERIAL_KRAFT_PAPERBOARD",
    foldingSteps: defaultSteps,
    dieline: {
      name: "sample-mailer.svg",
      kind: "sample",
      text: sampleDieline,
    },
  };
}

export function getActiveStep(project: PackagingProject): FoldingStep {
  return (
    project.foldingSteps.find((step) => step.id === project.activeStepId) ??
    project.foldingSteps[0]
  );
}

export function createImportedDieline(fileName: string, text: string): DielineSource {
  const rootElement = /<([a-z][\w:-]*)\b/i.exec(text)?.[1]?.toLowerCase();
  return {
    name: fileName,
    kind: rootElement === "svg" ? "svg" : "text",
    text,
  };
}

export function addFoldingStep(project: PackagingProject): PackagingProject {
  const nextIndex = project.foldingSteps.length;
  const next: FoldingStep = {
    id: `fold-${nextIndex}`,
    label: `Folding Keyframe ${nextIndex}`,
    angle: Math.min(110, 18 * nextIndex),
  };

  return {
    ...project,
    activeStepId: next.id,
    foldingSteps: [...project.foldingSteps, next],
  };
}

export function resetFolding(project: PackagingProject): PackagingProject {
  return {
    ...project,
    activeStepId: "setup",
    foldingSteps: defaultSteps.map((step) => ({ ...step })),
  };
}
