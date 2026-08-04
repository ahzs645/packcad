import {
  edgeColorModeOptions,
  panelColorModeOptions,
  type EdgeColorMode,
  type PanelColorMode,
} from "../render/foldViewSettings";
import type { PackagingProject } from "@packcad/format";

export type ViewLayout =
  | "split-horizontal"
  | "split-vertical"
  | "single-3d"
  | "single-2d";

export type UiPreferences = {
  schemaVersion: 4;
  darkMode: boolean;
  units: "mm" | "in";
  viewLayout: ViewLayout;
  panelColorMode: PanelColorMode;
  edgeColorMode: EdgeColorMode;
  groundPlane: boolean;
  shadow: boolean;
  origin: boolean;
  backgroundColor: string;
  cameraType: "orthographic" | "perspective";
  fluteSize: string;
  fluteAngle: number;
  offsetDirection: "top" | "center" | "bottom";
};

export const UI_PREFERENCES_STORAGE_KEY = "packcad-ui-preferences";

type StoredUiPreferences = Partial<Omit<UiPreferences, "schemaVersion">> & {
  schemaVersion?: number;
};

export const defaultUiPreferences: UiPreferences = {
  schemaVersion: 4,
  darkMode: false,
  units: "in",
  viewLayout: "single-3d",
  panelColorMode: "artwork",
  edgeColorMode: "mountain-valley",
  groundPlane: true,
  shadow: true,
  origin: true,
  backgroundColor: "#f2f2f3",
  cameraType: "orthographic",
  fluteSize: "E Flute",
  fluteAngle: 0,
  offsetDirection: "bottom",
};

const offsetDirectionFromDocument: Record<string, UiPreferences["offsetDirection"]> = {
  THICKNESS_OFFSET_DIRECTION_FRONT: "top",
  THICKNESS_OFFSET_DIRECTION_BACK: "bottom",
  THICKNESS_OFFSET_DIRECTION_BOTH: "center",
};

/**
 * A document brings its own material settings; the viewer keeps their own view
 * settings. Units, board, grain angle, and offset direction are authored in the
 * PackCAD file's `OPERATION_THICKNESS` modifier, so they are read from whatever
 * document is being opened. Everything else (theme, layout, camera, ground
 * plane, ...) is a viewer preference and survives the load untouched.
 *
 * No document is recognised by name, artwork, or vertex count -- opening a file
 * and opening the same design from the sample library must behave identically.
 */
export function preferencesForLoadedProject(
  project: PackagingProject,
  preferences: UiPreferences,
): UiPreferences {
  const design = project.design;
  if (!design) return preferences;
  const thickness = design.modifiers?.OPERATION_THICKNESS;
  const next: UiPreferences = { ...preferences };

  if (design.units === "mm" || design.units === "in") next.units = design.units;
  if (thickness?.enabled) {
    const offset = offsetDirectionFromDocument[thickness.thicknessOffsetDirection];
    if (offset) next.offsetDirection = offset;
    if (Number.isFinite(thickness.materialRotationDegrees)) {
      next.fluteAngle = thickness.materialRotationDegrees;
    }
    const flute = /_([A-Z])_FLUTE$/.exec(thickness.materialSubType ?? "")?.[1];
    if (flute) next.fluteSize = `${flute} Flute`;
  }
  return next;
}

export function normalizeUiPreferences(
  candidate: StoredUiPreferences,
): UiPreferences {
  const next: UiPreferences = {
    ...defaultUiPreferences,
    ...candidate,
    schemaVersion: 4,
  };
  // v4 aligns the built-in Mailer Box with the live example. Only replace the
  // old stock defaults so deliberately selected non-default flute sizes remain
  // intact when an existing local preference record is upgraded.
  if (candidate.schemaVersion !== 4) {
    if (candidate.units === undefined || candidate.units === "mm") {
      next.units = defaultUiPreferences.units;
    }
    if (candidate.fluteSize === undefined || candidate.fluteSize === "F Flute") {
      next.fluteSize = defaultUiPreferences.fluteSize;
    }
  }
  if (
    !panelColorModeOptions.some((option) => option.value === next.panelColorMode)
  ) {
    next.panelColorMode = defaultUiPreferences.panelColorMode;
  }
  if (
    !edgeColorModeOptions.some((option) => option.value === next.edgeColorMode)
  ) {
    next.edgeColorMode = defaultUiPreferences.edgeColorMode;
  }
  return next;
}

export function loadUiPreferences(): UiPreferences {
  try {
    const saved = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!saved) return defaultUiPreferences;
    return normalizeUiPreferences(
      JSON.parse(saved) as StoredUiPreferences,
    );
  } catch {
    return defaultUiPreferences;
  }
}

export function modeForSingleLayout(
  layout: ViewLayout,
): "3d" | "2d" | null {
  if (layout === "single-3d") return "3d";
  if (layout === "single-2d") return "2d";
  return null;
}

export function viewLayoutNotice(layout: ViewLayout): string {
  if (layout === "single-3d") return "Switched to folded model";
  if (layout === "single-2d") return "Switched to dieline";
  return layout === "split-horizontal"
    ? "View layout set to split horizontally"
    : "View layout set to split vertically";
}
