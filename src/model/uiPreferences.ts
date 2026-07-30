import {
  edgeColorModeOptions,
  panelColorModeOptions,
  type EdgeColorMode,
  type PanelColorMode,
} from "../render/foldViewSettings";

export type ViewLayout =
  | "split-horizontal"
  | "split-vertical"
  | "single-3d"
  | "single-2d";

export type UiPreferences = {
  schemaVersion: 3;
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

export const defaultUiPreferences: UiPreferences = {
  schemaVersion: 3,
  darkMode: false,
  units: "mm",
  viewLayout: "single-3d",
  panelColorMode: "artwork",
  edgeColorMode: "mountain-valley",
  groundPlane: true,
  shadow: true,
  origin: true,
  backgroundColor: "#f2f2f3",
  cameraType: "orthographic",
  fluteSize: "F Flute",
  fluteAngle: 0,
  offsetDirection: "bottom",
};

export function normalizeUiPreferences(
  candidate: Partial<UiPreferences>,
): UiPreferences {
  const next = { ...defaultUiPreferences, ...candidate };
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
  next.schemaVersion = 3;
  return next;
}

export function loadUiPreferences(): UiPreferences {
  try {
    const saved = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!saved) return defaultUiPreferences;
    return normalizeUiPreferences(
      JSON.parse(saved) as Partial<UiPreferences>,
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
