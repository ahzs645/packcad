// Where the viewer's camera looks while a project folds.
//
// The editor leaves the camera where it was while the folding plays, and frames the result once
// it stops. For a model that ends far smaller than its sheet, that shows the folding small and off
// to one side, then jumps; and for one whose later stages happen underneath (closing a floor,
// tucking flaps inside), it shows a camera aimed at panels that have stopped moving while the
// stage being played happens out of sight.
//
// The viewer plans a shot for each stage instead. A rigid timeline can be solved at any stage and
// angle at once, so before anything plays each stage is solved at its start, middle and end: the
// vertices that move are the panels that stage folds. The shot keeps the whole package in frame
// across the stage, aims a little toward the moving panels, and looks from the side they are on:
// from below when they are on the underside, from the end or side they are at when they are
// there. The finished model is shown from the view the folding started in.
//
// This file is the plan, and the pose arithmetic between two shots; useFoldCamera.ts drives the
// viewport with it.

import { solveRigidFoldTimeline, type Vec3 } from "@packcad/fold-solver";
import type { FoldModel, FoldingStep } from "@packcad/format";
import { foldScenePositions, type V3 } from "../render/foldSceneBuilder";

export type SceneBox = { min: V3; max: V3 };

export type FoldShot = {
  /** Unit vector from the target toward the camera. */
  direction: V3;
  /** What stays in frame: the whole package, across the stage's motion. */
  box: SceneBox;
  /** Where the camera aims: the box's centre, drawn toward the panels that move. */
  target: V3;
  /**
   * Where the panels the stage moves are, as a share of the package's half extent from its centre
   * on each axis (−1 to 1); null when nothing moves, as on the flat sheet.
   */
  offset: V3 | null;
  /** How many panels the stage moves. */
  moving: number;
};

export type FoldShotPlan = {
  /** One shot per folding step, the setup (flat sheet) first. */
  steps: FoldShot[];
  /** The finished model, from the view the folding started in. */
  final: FoldShot;
};

/** A vertex moves in a stage when it travels this share of the package's diagonal: any real motion, so small tabs count. */
const MOVING_SHARE = 0.002;
/** Moving panels this far below the package's centre (of its half height) are watched from below. */
const UNDERSIDE = 0.35;
/** ...and this far toward one end or side are watched from that end or side. */
const SIDEWAYS = 0.45;
/**
 * An axis tells where the panels are only once the shape has depth along it, this share of its
 * largest half extent: tabs dipping under a sheet that is still flat do not put them "underneath".
 */
const SOLID_SHARE = 0.15;
/** How far the aim is drawn from the package's centre toward the moving panels. */
const AIM_PULL = 0.25;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export function normalize(a: V3, fallback: V3 = [0, 0, 1]): V3 {
  const size = length(a);
  return size > 1e-9 ? [a[0] / size, a[1] / size, a[2] / size] : fallback;
}

export function boxOf(points: readonly V3[]): SceneBox {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  }
  return { min, max };
}

export const boxCentre = (box: SceneBox): V3 => lerp3(box.min, box.max, 0.5);

/**
 * The view to watch a stage from: the starting view, turned to look from below when the moving
 * panels are on the underside, and from their end or side when they are clearly at one. `offset`
 * is where the moving panels are, as a share of the package's half extent on each axis.
 */
export function shotDirection(base: V3, offset: V3): V3 {
  const [bx, by, bz] = normalize(base);
  const above = Math.abs(by);
  const toward = (component: number, at: number): number =>
    Math.abs(at) > SIDEWAYS ? Math.sign(at) * Math.abs(component) : component;
  return normalize([
    toward(bx, offset[0]),
    offset[1] < -UNDERSIDE ? -above : above,
    toward(bz, offset[2]),
  ]);
}

/** The package at a stage and angle, in the scene but not yet stood on the ground. */
const sceneAt = (model: FoldModel, stepIndex: number, angle: number): V3[] =>
  foldScenePositions(model, solveRigidFoldTimeline(model, stepIndex, angle).positions as Vec3[], { grounded: false });

/** Stood on the ground, as the viewport shows it: lowest point at y = 0. */
const grounded = (points: readonly V3[]): V3[] => {
  const ground = Math.min(...points.map((point) => point[1]));
  return points.map(([x, y, z]) => [x, y - ground, z]);
};

function wholeShot(points: readonly V3[], base: V3): FoldShot {
  const box = boxOf(points);
  return { direction: normalize(base), box, target: boxCentre(box), offset: null, moving: 0 };
}

/**
 * Plans a shot for every stage of a rigid timeline, or returns null for a model the planner cannot
 * solve ahead (one folded by the iterative solver), which keeps the editor's behaviour.
 */
export function planFoldShots(
  model: FoldModel | null | undefined,
  steps: readonly FoldingStep[],
  base: V3,
): FoldShotPlan | null {
  if (!model?.rigidTimeline || steps.length === 0) return null;
  if (model.verticesCoords.length === 0) return null;

  const shots: FoldShot[] = [wholeShot(grounded(sceneAt(model, 0, 0)), base)];
  for (let index = 1; index < steps.length; index += 1) {
    const angle = steps[index].angle;
    const start = sceneAt(model, index, 0);
    const middle = sceneAt(model, index, angle / 2);
    const end = sceneAt(model, index, angle);
    // The frame is where the viewport will show the package, grounded at each moment; which
    // panels move, and where they end up, are read from the ungrounded shapes, which do not
    // shift as a whole.
    const groundedEnd = grounded(end);
    const box = boxOf([...grounded(start), ...grounded(middle), ...groundedEnd]);
    const centre = boxCentre(box);
    const threshold = MOVING_SHARE * 2 * length(sub(box.max, centre));

    // Where the moving panels end up, against the shape the stage ends in. (Against the whole
    // sweep, a floor that starts hanging below the package and closes underneath it would read as
    // central.)
    const ending = boxOf(end);
    const endCentre = boxCentre(ending);
    const endHalf = sub(ending.max, endCentre);
    // Weighted by area, so a wheel drawn with many vertices counts no more than its size.
    const moved = start.map((point, vertex) => Math.max(
      length(sub(middle[vertex], point)),
      length(sub(end[vertex], point)),
    ) > threshold);
    let area = 0;
    let count = 0;
    const sum: V3 = [0, 0, 0];
    for (const face of model.facesVertices) {
      if (!face.some((vertex) => moved[vertex])) continue;
      count += 1;
      const anchor = end[face[0]];
      for (let corner = 1; corner + 1 < face.length; corner += 1) {
        const b = end[face[corner]];
        const c = end[face[corner + 1]];
        const ab = sub(b, anchor);
        const ac = sub(c, anchor);
        const piece = length([
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ]) / 2;
        area += piece;
        for (let axis = 0; axis < 3; axis += 1) {
          sum[axis] += piece * (anchor[axis] + b[axis] + c[axis]) / 3;
        }
      }
    }
    if (count === 0 || area <= 0) {
      shots.push({ direction: normalize(base), box, target: centre, offset: null, moving: 0 });
      continue;
    }
    const focus: V3 = [sum[0] / area, sum[1] / area, sum[2] / area];
    // The same point where the viewport shows it, to aim at.
    const lift = groundedEnd[0][1] - end[0][1];
    const aim: V3 = [focus[0], focus[1] + lift, focus[2]];
    const solid = SOLID_SHARE * Math.max(...endHalf);
    const offset: V3 = [0, 1, 2].map((axis) =>
      endHalf[axis] > solid ? (focus[axis] - endCentre[axis]) / endHalf[axis] : 0) as V3;
    shots.push({
      direction: shotDirection(base, offset),
      box,
      target: lerp3(centre, aim, AIM_PULL),
      offset,
      moving: count,
    });
  }

  const finalIndex = steps.length - 1;
  const final = finalIndex === 0
    ? shots[0]
    : wholeShot(grounded(sceneAt(model, finalIndex, steps[finalIndex].angle)), base);
  return { steps: shots, final };
}

/** A camera pose the viewer moves between: where it aims, from which way, how far, and its zoom. */
export type FoldCameraPose = {
  target: V3;
  direction: V3;
  distance: number;
  zoom: number;
};

/** Smooth start and stop. */
export const easeInOut = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
};

/**
 * The pose `t` of the way from one pose to another: the aim and distance move straight, the view
 * turns (normalised linear interpolation, which is a turn for any two views less than half a turn
 * apart) and the zoom changes by the same ratio each moment.
 */
export function blendPose(from: FoldCameraPose, to: FoldCameraPose, t: number): FoldCameraPose {
  const k = Math.min(1, Math.max(0, t));
  return {
    target: lerp3(from.target, to.target, k),
    direction: normalize(lerp3(from.direction, to.direction, k), to.direction),
    distance: from.distance + (to.distance - from.distance) * k,
    zoom: from.zoom * (to.zoom / from.zoom) ** k,
  };
}
