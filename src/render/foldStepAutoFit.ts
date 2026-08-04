import type { FoldModel, ViewMode } from "@packcad/format";

export type FoldStepFrame = {
  model: FoldModel;
  viewMode: ViewMode;
  foldStepIndex: number;
};

export type SettledFoldStepAutoFit = FoldStepFrame & {
  sawPlayback: boolean;
  needsSettledFit: boolean;
  fitted: boolean;
};

export function foldStepFrame(
  model: FoldModel,
  viewMode: ViewMode,
  foldStepIndex: number,
): FoldStepFrame {
  return {
    model,
    viewMode,
    // Folding does not change the flat dieline. Treat all of its steps as one
    // camera frame so selecting a 3D keyframe does not reset 2D pan and zoom.
    foldStepIndex: viewMode === "2d" ? 0 : foldStepIndex,
  };
}

export function hasFoldPositionsForModel(
  model: FoldModel,
  ...candidates: Array<ReadonlyArray<unknown> | null | undefined>
): boolean {
  return candidates.some(
    (positions) => positions?.length === model.verticesCoords.length,
  );
}

export function foldStepFitPadding(
  viewMode: ViewMode,
  compact: boolean,
): number {
  // PackCAD fills 90% of the limiting viewport axis when it recentres. Atelier
  // expresses the inverse of that fill factor as bounds-fit padding.
  return viewMode === "2d" ? 1.08 : compact ? 1.55 : 1 / 0.9;
}

export function isSameFoldStepFrame(
  previous: FoldStepFrame | null,
  next: FoldStepFrame,
): boolean {
  return previous?.model === next.model
    && previous.viewMode === next.viewMode
    && previous.foldStepIndex === next.foldStepIndex;
}

export function beginSettledFoldStepAutoFit(
  frame: FoldStepFrame,
  playing: boolean,
  hasPositions: boolean,
): SettledFoldStepAutoFit {
  return {
    ...frame,
    sawPlayback: playing,
    needsSettledFit: !hasPositions,
    fitted: false,
  };
}

export function updateSettledFoldStepAutoFit(
  current: SettledFoldStepAutoFit,
  frame: FoldStepFrame,
  playing: boolean,
  hasPositions: boolean,
): { state: SettledFoldStepAutoFit; fit: boolean } {
  if (!isSameFoldStepFrame(current, frame)) {
    return {
      state: beginSettledFoldStepAutoFit(frame, playing, hasPositions),
      fit: false,
    };
  }

  const sawPlayback = current.sawPlayback || playing;
  const fit = !current.fitted
    && !playing
    && hasPositions
    && (current.needsSettledFit || sawPlayback);
  return {
    state: {
      ...current,
      sawPlayback,
      fitted: current.fitted || fit,
    },
    fit,
  };
}
