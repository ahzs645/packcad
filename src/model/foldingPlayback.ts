import {
  advanceFoldingPlayer,
  createFoldingPlayer,
  getFoldingPlayerFrame,
  pauseFoldingPlayer,
  startFoldingPlayer,
  type FoldingPlayerFrame,
  type FoldingPlayerState,
} from "@packcad/fold-solver";
import type { PackagingProject } from "@packcad/format";
import { useCallback, useEffect, useRef, useState } from "react";

export function projectForFoldingFrame(
  project: PackagingProject,
  frame: FoldingPlayerFrame,
): PackagingProject {
  return {
    ...project,
    activeStepId: frame.activeStepId,
    foldingSteps: project.foldingSteps.map((step) =>
      step.id === frame.activeStepId ? frame.step : step),
  };
}

export function foldingPlaybackProgress(
  project: PackagingProject,
  frame: FoldingPlayerFrame,
): number {
  const playableSteps = Math.max(0, project.foldingSteps.length - 1);
  if (playableSteps === 0 || frame.stepIndex === 0) return 0;
  return Math.min(1, ((frame.stepIndex - 1) + frame.progress) / playableSteps);
}

export type FoldingPlayback = {
  player: FoldingPlayerState;
  frame: FoldingPlayerFrame;
  displayedProject: PackagingProject;
  progress: number;
  play: () => void;
  pause: () => void;
  seek: (stepId: string) => void;
};

export function useFoldingPlayback(project: PackagingProject): FoldingPlayback {
  const [player, setPlayer] = useState<FoldingPlayerState>(() =>
    createFoldingPlayer(project));
  const playerRef = useRef(player);
  const projectRef = useRef(project);
  const foldInputsRef = useRef({
    model: project.foldModel,
    steps: project.foldingSteps,
    activeStepId: project.activeStepId,
  });
  projectRef.current = project;

  const replacePlayer = useCallback((next: FoldingPlayerState): void => {
    playerRef.current = next;
    setPlayer(next);
  }, []);

  useEffect(() => {
    const previous = foldInputsRef.current;
    const changed = previous.model !== project.foldModel
      || previous.steps !== project.foldingSteps
      || previous.activeStepId !== project.activeStepId;
    foldInputsRef.current = {
      model: project.foldModel,
      steps: project.foldingSteps,
      activeStepId: project.activeStepId,
    };
    if (changed) replacePlayer(createFoldingPlayer(project));
  }, [project, replacePlayer]);

  useEffect(() => {
    if (!player.playing) return;

    let frameId = 0;
    let cancelled = false;
    let lastTick = performance.now();
    const tick = (now: number): void => {
      if (cancelled) return;
      const deltaMs = Math.min(1000, now - lastTick);
      lastTick = now;
      const next = advanceFoldingPlayer(
        projectRef.current,
        playerRef.current,
        deltaMs,
      );
      replacePlayer(next);
      if (next.playing) frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      playerRef.current = pauseFoldingPlayer(playerRef.current);
    };
  }, [player.playing, replacePlayer]);

  const play = useCallback((): void => {
    replacePlayer(startFoldingPlayer(projectRef.current, playerRef.current));
  }, [replacePlayer]);
  const pause = useCallback((): void => {
    replacePlayer(pauseFoldingPlayer(playerRef.current));
  }, [replacePlayer]);
  const seek = useCallback((stepId: string): void => {
    replacePlayer(createFoldingPlayer({
      ...projectRef.current,
      activeStepId: stepId,
    }));
  }, [replacePlayer]);
  const frame = getFoldingPlayerFrame(project, player);

  return {
    player,
    frame,
    displayedProject: projectForFoldingFrame(project, frame),
    progress: foldingPlaybackProgress(project, frame),
    play,
    pause,
    seek,
  };
}
