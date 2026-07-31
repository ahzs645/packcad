import { foldNewton } from "./foldNewtonSolver";
import {
  appendPriorTargets,
  measureCreaseAnglesDegrees,
  sourceStageConstraintAngles,
} from "./foldPlaybackConstraints";
import type { Vec3 } from "./foldSolver";
import type { FoldingStep, PackagingProject } from "@packcad/format";

export type FoldingPlayerState = {
  playing: boolean;
  stepIndex: number;
  progress: number;
  loop: boolean;
  speed: number;
  targetAngles: Record<string, number>;
  sourceDriven: boolean;
  positions: Vec3[] | null;
  stageConstraintAngles: Record<number, number> | null;
  stageIterations: number;
  solverAccumulatorMs: number;
  energyHistory: number[];
  priorTargetAngles: Record<number, number>;
  solverStepSize: number;
  solverMaxEdgeError: number;
  solverMaxAngleErrorDeg: number;
  solverIsSolved: boolean;
  displayAngle: number;
  finished: boolean;
};

export type FoldingPlayerFrame = {
  activeStepId: string;
  step: FoldingStep;
  stepIndex: number;
  angle: number;
  progress: number;
  targetAngle: number;
};

type FoldingPlayerOptions = {
  playing?: boolean;
  loop?: boolean;
  speed?: number;
};

const LEGACY_STEP_DURATION_MS = 480;
const MAX_SOLVER_ITERATIONS = 250;
const ENERGY_HISTORY_MAX_LENGTH = 15;
const ENERGY_DETECTION_WINDOW = 5;
const ENERGY_ABSOLUTE_CHANGE_THRESHOLD = 0.0001;
const ENERGY_PLATEAU_DETECTION_THRESHOLD = 0.001;
const FINAL_SOLVE_ENERGY_PLATEAU_DETECTION_THRESHOLD = 0.01;
const ADAPTIVE_STEP_DEFAULT_STEP_SIZE = 0.9;
const SOURCE_SOLVER_STEP_MS = 1000 / 20;
const MAX_SOURCE_SOLVER_STEPS_PER_UPDATE = 4;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function firstPlayableIndex(project: PackagingProject): number {
  return project.foldingSteps.length > 1 ? 1 : 0;
}

function flatPositions(project: PackagingProject): Vec3[] | null {
  return project.foldModel?.verticesCoords.map(([x, y]) => [x, y, 0]) ?? null;
}

function captureTargetAngles(project: PackagingProject): Record<string, number> {
  return Object.fromEntries(
    project.foldingSteps.map((step) => [step.id, clamp(step.angle, 0, 180)]),
  );
}

function activeStepIndex(project: PackagingProject): number {
  const index = project.foldingSteps.findIndex((step) => step.id === project.activeStepId);
  return index >= 0 ? index : 0;
}

function playableIndex(project: PackagingProject, stepIndex: number): number {
  if (project.foldingSteps.length === 0) return 0;
  return clamp(stepIndex, firstPlayableIndex(project), project.foldingSteps.length - 1);
}

function clampedStepIndex(project: PackagingProject, stepIndex: number): number {
  if (project.foldingSteps.length === 0) return 0;
  return clamp(stepIndex, 0, project.foldingSteps.length - 1);
}

function progressForStep(step: FoldingStep, targetAngle: number): number {
  if (targetAngle <= 0) return 0;
  return clamp(step.angle / targetAngle, 0, 1);
}

function freshSourceReplay(project: PackagingProject, base: FoldingPlayerState): FoldingPlayerState {
  return {
    ...base,
    playing: project.foldingSteps.length > 1,
    stepIndex: firstPlayableIndex(project),
    progress: 0,
    loop: false,
    sourceDriven: true,
    positions: flatPositions(project),
    stageConstraintAngles: null,
    stageIterations: 0,
    solverAccumulatorMs: 0,
    energyHistory: [],
    priorTargetAngles: {},
    solverStepSize: ADAPTIVE_STEP_DEFAULT_STEP_SIZE,
    solverMaxEdgeError: 0,
    solverMaxAngleErrorDeg: 0,
    solverIsSolved: false,
    displayAngle: 0,
    finished: false,
  };
}

export function createFoldingPlayer(
  project: PackagingProject,
  options: FoldingPlayerOptions = {},
): FoldingPlayerState {
  const targetAngles = captureTargetAngles(project);
  const index = clampedStepIndex(project, activeStepIndex(project));
  const step = project.foldingSteps[index] ?? project.foldingSteps[0];
  const targetAngle = step ? targetAngles[step.id] ?? step.angle : 0;
  const progress = step ? progressForStep(step, targetAngle) : 0;
  const player: FoldingPlayerState = {
    playing: Boolean(options.playing && project.foldingSteps.length > 1),
    stepIndex: index,
    progress,
    loop: options.loop ?? false,
    speed: options.speed ?? 1,
    targetAngles,
    sourceDriven: Boolean(project.foldModel),
    positions: null,
    stageConstraintAngles: null,
    stageIterations: 0,
    solverAccumulatorMs: 0,
    energyHistory: [],
    priorTargetAngles: {},
    solverStepSize: ADAPTIVE_STEP_DEFAULT_STEP_SIZE,
    solverMaxEdgeError: 0,
    solverMaxAngleErrorDeg: 0,
    solverIsSolved: false,
    displayAngle: step?.angle ?? 0,
    finished: false,
  };
  return player.playing ? startFoldingPlayer(project, player) : player;
}

export function startFoldingPlayer(
  project: PackagingProject,
  current?: FoldingPlayerState,
): FoldingPlayerState {
  const base = current ?? createFoldingPlayer(project);
  if (project.foldModel) {
    if (current?.positions && !current.finished) return { ...current, playing: true };
    return freshSourceReplay(project, base);
  }

  const first = firstPlayableIndex(project);
  const last = Math.max(first, project.foldingSteps.length - 1);
  let stepIndex = playableIndex(project, base.stepIndex);
  let progress = clamp(base.progress, 0, 1);
  if (!current || stepIndex === 0 || (stepIndex >= last && progress >= 0.98)) {
    stepIndex = first;
    progress = 0;
  }
  return {
    ...base,
    playing: project.foldingSteps.length > 1,
    loop: false,
    stepIndex,
    progress,
    targetAngles: Object.keys(base.targetAngles).length > 0
      ? base.targetAngles
      : captureTargetAngles(project),
  };
}

export function pauseFoldingPlayer(player: FoldingPlayerState): FoldingPlayerState {
  return { ...player, playing: false };
}

function isEnergyPlateau(history: number[], relativeThreshold: number): boolean {
  if (history.length < ENERGY_DETECTION_WINDOW) return false;
  const first = history[history.length - ENERGY_DETECTION_WINDOW];
  const last = history[history.length - 1];
  const change = Math.abs(last - first);
  if (change <= ENERGY_ABSOLUTE_CHANGE_THRESHOLD) return true;
  return change / (first + 1e-10) <= relativeThreshold;
}

function averageActiveAngle(
  project: PackagingProject,
  stepIndex: number,
  positions: Vec3[],
): number {
  const model = project.foldModel;
  const keyframe = model?.keyframes[stepIndex - 1];
  if (!model || !keyframe) return 0;
  const measured = measureCreaseAnglesDegrees(model, positions);
  const activeEdges = Object.keys(keyframe.creaseAnglesDeg).map(Number);
  if (activeEdges.length === 0) return 0;
  return activeEdges.reduce((sum, edge) => sum + (measured[edge] ?? 0), 0) / activeEdges.length;
}

function advanceSourceReplayStep(
  project: PackagingProject,
  player: FoldingPlayerState,
): FoldingPlayerState {
  const model = project.foldModel;
  if (!model) return player;
  const stepIndex = playableIndex(project, player.stepIndex);
  const keyframe = model.keyframes[stepIndex - 1];
  const positions = player.positions ?? flatPositions(project);
  if (!keyframe || !positions) return pauseFoldingPlayer(player);

  const stageConstraintAngles = player.stageConstraintAngles ?? sourceStageConstraintAngles(
    model,
    keyframe,
    positions,
    player.priorTargetAngles,
  );
  const result = foldNewton(model, stageConstraintAngles, {
    maxIterations: 1,
    seed: positions,
    fixedFaceIndices: keyframe.fixedFaceIndices,
    fixedVertexIndices: keyframe.fixedVertexIndices,
    initialStepSize: player.solverStepSize,
  });
  const stageIterations = player.stageIterations + 1;
  const energyHistory = result.stuck
    ? player.energyHistory
    : [...player.energyHistory, result.energy].slice(-ENERGY_HISTORY_MAX_LENGTH);
  const displayAngle = averageActiveAngle(project, stepIndex, result.positions);
  const step = project.foldingSteps[stepIndex];
  const targetAngle = step ? player.targetAngles[step.id] ?? step.angle : 0;
  const progress = targetAngle > 0 ? clamp(Math.abs(displayAngle) / Math.abs(targetAngle), 0, 1) : 0;
  const finalPlateau = isEnergyPlateau(
    energyHistory,
    FINAL_SOLVE_ENERGY_PLATEAU_DETECTION_THRESHOLD,
  );
  const converged = result.stuck
    || stageIterations >= MAX_SOLVER_ITERATIONS
    || (finalPlateau && (
      isEnergyPlateau(energyHistory, ENERGY_PLATEAU_DETECTION_THRESHOLD) || result.isSolved
    ));

  const common: FoldingPlayerState = {
    ...player,
    playing: true,
    sourceDriven: true,
    positions: result.positions,
    stageConstraintAngles,
    stageIterations,
    solverAccumulatorMs: player.solverAccumulatorMs,
    energyHistory,
    solverStepSize: result.stepSize,
    solverMaxEdgeError: result.maxEdgeError,
    solverMaxAngleErrorDeg: result.maxAngleErrorDeg,
    solverIsSolved: result.isSolved,
    displayAngle,
    progress,
  };
  if (!converged) return common;

  const priorTargetAngles = appendPriorTargets(player.priorTargetAngles, keyframe);
  const last = project.foldingSteps.length - 1;
  if (stepIndex >= last) {
    return {
      ...common,
      playing: false,
      progress: 1,
      priorTargetAngles,
      finished: true,
    };
  }
  return {
    ...common,
    stepIndex: stepIndex + 1,
    progress: 0,
    stageConstraintAngles: null,
    stageIterations: 0,
    solverAccumulatorMs: player.solverAccumulatorMs,
    energyHistory: [],
    priorTargetAngles,
    solverStepSize: ADAPTIVE_STEP_DEFAULT_STEP_SIZE,
    solverIsSolved: false,
    displayAngle: 0,
  };
}

export function advanceFoldingPlayer(
  project: PackagingProject,
  player: FoldingPlayerState,
  deltaMs: number,
): FoldingPlayerState {
  if (!player.playing || project.foldingSteps.length <= 1) return pauseFoldingPlayer(player);
  if (project.foldModel) {
    let next = {
      ...player,
      solverAccumulatorMs: Math.min(
        SOURCE_SOLVER_STEP_MS * MAX_SOURCE_SOLVER_STEPS_PER_UPDATE,
        player.solverAccumulatorMs
          + Math.max(0, deltaMs) * clamp(player.speed, 0.1, 8),
      ),
    };
    let steps = Math.min(
      MAX_SOURCE_SOLVER_STEPS_PER_UPDATE,
      Math.floor((next.solverAccumulatorMs + 1e-7) / SOURCE_SOLVER_STEP_MS),
    );
    while (steps > 0 && next.playing) {
      next = advanceSourceReplayStep(project, {
        ...next,
        solverAccumulatorMs: next.solverAccumulatorMs - SOURCE_SOLVER_STEP_MS,
      });
      steps -= 1;
    }
    return next;
  }

  const first = firstPlayableIndex(project);
  const last = project.foldingSteps.length - 1;
  let stepIndex = playableIndex(project, player.stepIndex);
  let progress = clamp(player.progress, 0, 1);
  progress += (Math.max(0, deltaMs) / LEGACY_STEP_DURATION_MS) * clamp(player.speed, 0.1, 8);
  while (progress >= 1 && stepIndex < last) {
    progress -= 1;
    stepIndex += 1;
  }
  if (progress >= 1 && stepIndex >= last) {
    if (!player.loop) return { ...player, playing: false, stepIndex: last, progress: 1 };
    stepIndex = first;
    progress = 0;
  }
  return { ...player, playing: true, stepIndex, progress };
}

export function getFoldingPlayerFrame(
  project: PackagingProject,
  player: FoldingPlayerState,
): FoldingPlayerFrame {
  const stepIndex = clampedStepIndex(project, player.stepIndex);
  const fallbackStep = project.foldingSteps[0] ?? { id: "setup", label: "Folding Setup", angle: 0 };
  const step = project.foldingSteps[stepIndex] ?? fallbackStep;
  const targetAngle = clamp(player.targetAngles[step.id] ?? step.angle, 0, 180);
  const progress = clamp(player.progress, 0, 1);
  const angle = player.sourceDriven && player.positions
    ? player.displayAngle
    : stepIndex === 0 ? 0 : targetAngle * progress;
  return {
    activeStepId: step.id,
    step: { ...step, angle },
    stepIndex,
    angle,
    progress,
    targetAngle,
  };
}
