// The viewer's contract with a page that embeds it (viewer.html in an iframe).
//
// Everything a host can say arrives in the address (what to open and how to show it) or as a
// window message from the parent frame; everything the viewer reports goes back the same way.
// Messages are plain objects whose `type` starts with "packcad:", so a host can share its message
// channel with other embeds.

import type { ViewLayout } from "../model/uiPreferences";

export type ViewerStep = { id: string; label: string; angle: number };

export type ViewerOptions = {
  /** Where the project comes from: a .packcad.json or .packcad.pdf, relative to the viewer page. */
  projectUrl: string | null;
  /** Which stage to open on: "final", "setup", a step index, or a step id. */
  step: string;
  autoplay: boolean;
  layout: ViewLayout;
  /** False when the host draws its own transport and only the viewport is wanted. */
  controls: boolean;
  /** The viewport's background, so the model sits on the host page's ground. */
  background: string | null;
  /** Loop the fold animation (folds, holds, unfolds, holds, folds again) for a display stage. */
  loop: boolean;
};

const LAYOUTS: Record<string, ViewLayout> = {
  "3d": "single-3d",
  "2d": "single-2d",
  split: "split-horizontal",
  "split-vertical": "split-vertical",
};

const flag = (value: string | null, fallback: boolean): boolean =>
  value === null ? fallback : !["0", "false", "no", "off"].includes(value.toLowerCase());

/** A colour the viewport can be given safely: a hex colour, nothing else. */
const colour = (value: string | null): string | null =>
  value && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)
    ? (value.startsWith("#") ? value : `#${value}`)
    : null;

export function readViewerOptions(search: string): ViewerOptions {
  const params = new URLSearchParams(search);
  return {
    projectUrl: params.get("project"),
    step: params.get("step") ?? "final",
    autoplay: flag(params.get("autoplay"), false),
    layout: LAYOUTS[params.get("layout") ?? "3d"] ?? "single-3d",
    controls: flag(params.get("controls"), true),
    background: colour(params.get("background")),
    loop: flag(params.get("loop"), false),
  };
}

/** The step a request names: "final", "setup", an index, or an id. Unknown names fall back to `fallback`. */
export function resolveStepId(
  steps: readonly { id: string }[],
  request: string | number | null | undefined,
  fallback: string,
): string {
  if (steps.length === 0) return fallback;
  if (request === "final" || request === "last") return steps[steps.length - 1].id;
  if (request === "setup" || request === "flat" || request === "first") return steps[0].id;
  if (typeof request === "number" || (typeof request === "string" && /^\d+$/.test(request))) {
    const index = Number(request);
    return steps[Math.min(steps.length - 1, Math.max(0, index))].id;
  }
  if (typeof request === "string" && steps.some((step) => step.id === request)) return request;
  return fallback;
}

/** What the host can ask of the viewer. */
export type ViewerCommand =
  | { type: "packcad:play" }
  | { type: "packcad:pause" }
  | { type: "packcad:seek"; step: string | number }
  | { type: "packcad:load"; url: string; step?: string | number; autoplay?: boolean }
  | { type: "packcad:layout"; layout: "3d" | "2d" | "split" | "split-vertical" }
  | { type: "packcad:fit" }
  | { type: "packcad:background"; color: string };

/** What the viewer tells the host. */
export type ViewerEvent =
  | { type: "packcad:ready"; name: string | null; steps: ViewerStep[]; panels: number }
  | { type: "packcad:state"; playing: boolean; stepId: string; stepIndex: number; progress: number }
  | { type: "packcad:error"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A message from the host, if it is one the viewer understands; anything else is ignored. */
export function parseViewerCommand(data: unknown): ViewerCommand | null {
  if (!isRecord(data) || typeof data.type !== "string") return null;
  switch (data.type) {
    case "packcad:play":
    case "packcad:pause":
    case "packcad:fit":
      return { type: data.type };
    case "packcad:seek":
      return typeof data.step === "string" || typeof data.step === "number"
        ? { type: "packcad:seek", step: data.step }
        : null;
    case "packcad:load":
      return typeof data.url === "string"
        ? {
            type: "packcad:load",
            url: data.url,
            step: typeof data.step === "string" || typeof data.step === "number" ? data.step : undefined,
            autoplay: typeof data.autoplay === "boolean" ? data.autoplay : undefined,
          }
        : null;
    case "packcad:layout":
      return typeof data.layout === "string" && data.layout in LAYOUTS
        ? { type: "packcad:layout", layout: data.layout as "3d" }
        : null;
    case "packcad:background": {
      const color = colour(typeof data.color === "string" ? data.color : null);
      return color ? { type: "packcad:background", color } : null;
    }
    default:
      return null;
  }
}

export const layoutFor = (name: string): ViewLayout => LAYOUTS[name] ?? "single-3d";
