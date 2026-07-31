import type { CameraState } from "@atelier/viewport";

// PackCAD Mockup v1.3.x uses a centred, elevated front view for its
// "isometric" preset from the elevated front-left diagonal. PackCAD's scene
// remap reverses the reference renderer's depth axis, so the equivalent
// viewport direction is (-4.8, 4.8, -5.8). Preserve the current orbit distance
// and target while adopting it.
const SOURCE_ISOMETRIC_X = -4.8;
const SOURCE_ISOMETRIC_Y = 4.8;
const SOURCE_ISOMETRIC_Z = -5.8;
const SOURCE_ISOMETRIC_LENGTH = Math.hypot(
  SOURCE_ISOMETRIC_X,
  SOURCE_ISOMETRIC_Y,
  SOURCE_ISOMETRIC_Z,
);

export function sourceIsometricCameraState(state: CameraState): CameraState {
  const [px, py, pz] = state.position;
  const [tx, ty, tz] = state.target;
  const distance = Math.max(Math.hypot(px - tx, py - ty, pz - tz), 1);
  return {
    ...state,
    position: [
      tx + distance * SOURCE_ISOMETRIC_X / SOURCE_ISOMETRIC_LENGTH,
      ty + distance * SOURCE_ISOMETRIC_Y / SOURCE_ISOMETRIC_LENGTH,
      tz + distance * SOURCE_ISOMETRIC_Z / SOURCE_ISOMETRIC_LENGTH,
    ],
  };
}
