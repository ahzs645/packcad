// The viewer's camera while a project folds: each stage's shot from foldCamera.ts, reached by a
// short eased move when the stage begins, and the finished model shown from where it started.
//
// It only moves the camera when the folding moves on (a stage begins, the folding ends, a stage
// is chosen); in between the person can orbit as before. Once they take the camera during
// playback it is theirs until the next play.

import type { FoldingPlayerState } from "@packcad/fold-solver";
import type { FoldModel, FoldingStep } from "@packcad/format";
import type { CameraState, Viewport } from "@atelier/viewport";
import { Box3, Vector3 } from "three";
import { useEffect, useRef } from "react";
import { foldStepFitPadding } from "../render/foldStepAutoFit";
import {
  blendPose,
  easeInOut,
  normalize,
  planFoldShots,
  type FoldCameraPose,
  type FoldShot,
  type FoldShotPlan,
} from "./foldCamera";
import type { V3 } from "../render/foldSceneBuilder";

/** How long the camera takes to turn to a stage, at most, and at most this share of the stage. */
const STAGE_TURN_MS = 700;
const STAGE_TURN_SHARE = 0.6;
/** How long it takes to come round to the finished model. */
const FINAL_TURN_MS = 1100;
/** A rigid stage's length at speed 1 (the fold player's own). */
const STAGE_MS = 480;

const poseOf = (state: CameraState): FoldCameraPose => {
  const offset: V3 = [
    state.position[0] - state.target[0],
    state.position[1] - state.target[1],
    state.position[2] - state.target[2],
  ];
  return {
    target: [...state.target] as V3,
    direction: normalize(offset),
    distance: Math.max(Math.hypot(...offset), 1e-3),
    zoom: state.zoom,
  };
};

const stateOf = (pose: FoldCameraPose, like: CameraState): CameraState => ({
  ...like,
  target: pose.target,
  position: [
    pose.target[0] + pose.direction[0] * pose.distance,
    pose.target[1] + pose.direction[1] * pose.distance,
    pose.target[2] + pose.direction[2] * pose.distance,
  ],
  zoom: pose.zoom,
});

/** The pose that frames a shot: aimed at its target, from its direction, the whole box in view. */
function poseFor(viewport: Viewport, shot: FoldShot, distance: number): FoldCameraPose {
  const camera = viewport.camera;
  const saved = camera.getState();
  // A box centred on the aim, so fitting it keeps the aim and still shows all of the package.
  const half = [0, 1, 2].map((axis) => Math.max(
    shot.box.max[axis] - shot.target[axis],
    shot.target[axis] - shot.box.min[axis],
  ));
  const box = new Box3(
    new Vector3(shot.target[0] - half[0], shot.target[1] - half[1], shot.target[2] - half[2]),
    new Vector3(shot.target[0] + half[0], shot.target[1] + half[1], shot.target[2] + half[2]),
  );
  camera.setState(stateOf({ target: shot.target, direction: shot.direction, distance, zoom: saved.zoom }, saved));
  camera.fit(box, foldStepFitPadding("3d", false));
  const pose = poseOf(camera.getState());
  camera.setState(saved);
  return pose;
}

export function useFoldCamera({
  viewport,
  model,
  steps,
  player,
  enabled,
}: {
  viewport: Viewport | null;
  model: FoldModel | null | undefined;
  steps: readonly FoldingStep[];
  player: FoldingPlayerState;
  enabled: boolean;
}): void {
  const plan = useRef<{ model: unknown; steps: unknown; shots: FoldShotPlan | null } | null>(null);
  const shown = useRef<string | null>(null);
  const wasPlaying = useRef(false);
  const taken = useRef(false);
  const motion = useRef(0);

  // The person orbiting or zooming during playback keeps the camera until the next play.
  useEffect(() => {
    if (!viewport) return undefined;
    const take = (): void => {
      taken.current = true;
      cancelAnimationFrame(motion.current);
      motion.current = 0;
    };
    viewport.camera.controls.addEventListener("start", take);
    return () => viewport.camera.controls.removeEventListener("start", take);
  }, [viewport]);

  useEffect(() => () => cancelAnimationFrame(motion.current), []);

  const { playing, finished, stepIndex, speed } = player;
  useEffect(() => {
    if (!enabled || !viewport) {
      wasPlaying.current = playing;
      return;
    }
    const started = playing && !wasPlaying.current;
    const ended = !playing && wasPlaying.current;
    wasPlaying.current = playing;
    if (started) taken.current = false;
    if (taken.current) return;

    // The plan is made from the view the person has when the folding first moves, turned to look
    // from above, so the finished model comes back to it.
    const current = plan.current;
    if (!current || current.model !== model || current.steps !== steps) {
      if (!playing && !ended && shown.current === null) {
        // Opening on a stage: leave the editor's framing until something moves.
        shown.current = `step:${stepIndex}`;
        return;
      }
      const base = poseOf(viewport.camera.getState()).direction;
      plan.current = {
        model,
        steps,
        shots: planFoldShots(model, steps, [base[0], Math.abs(base[1]), base[2]]),
      };
    }
    const shots = plan.current?.shots;
    if (!shots) return;

    const key = ended && finished ? "final" : `step:${stepIndex}`;
    if (key === shown.current) return;
    shown.current = key;
    const shot = key === "final" ? shots.final : shots.steps[stepIndex];
    if (!shot) return;
    const stageMs = STAGE_MS / Math.max(0.1, speed);
    const duration = key === "final"
      ? FINAL_TURN_MS
      : playing ? Math.min(STAGE_TURN_MS, stageMs * STAGE_TURN_SHARE) : STAGE_TURN_MS;

    const startState = viewport.camera.getState();
    const from = poseOf(startState);
    const to = poseFor(viewport, shot, from.distance);
    const view = viewport.renderer.domElement.ownerDocument.defaultView ?? window;
    const begin = view.performance.now();
    cancelAnimationFrame(motion.current);
    const tick = (): void => {
      const t = (view.performance.now() - begin) / duration;
      viewport.camera.setState(stateOf(blendPose(from, to, easeInOut(t)), viewport.camera.getState()));
      viewport.invalidate();
      motion.current = t < 1 ? view.requestAnimationFrame(tick) : 0;
    };
    motion.current = view.requestAnimationFrame(tick);
  }, [enabled, finished, model, playing, speed, stepIndex, steps, viewport]);
}
