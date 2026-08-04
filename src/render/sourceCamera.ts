import type { CameraState } from "@atelier/viewport";
import { Vector3, type Camera } from "three";

// PackCAD starts its 3D camera at (100, -100, 100), with Z up, while its graph
// visualization is scaled by (1, -1, 1). Atelier stores that same graph as
// (graph.x, graph.z, -graph.y), with Y up, so the exact equivalent camera
// offset is the positive XYZ diagonal. PackCAD also uses a deliberately narrow
// 15-degree perspective lens. Preserve the current orbit distance and target;
// the subsequent bounds fit supplies the active step's target and distance.
const SOURCE_PERSPECTIVE_FOV = 15;
const SOURCE_ISOMETRIC_COMPONENT = 1 / Math.sqrt(3);

export function sourceIsometricCameraState(state: CameraState): CameraState {
  const [px, py, pz] = state.position;
  const [tx, ty, tz] = state.target;
  const distance = Math.max(Math.hypot(px - tx, py - ty, pz - tz), 1);
  return {
    ...state,
    position: [
      tx + distance * SOURCE_ISOMETRIC_COMPONENT,
      ty + distance * SOURCE_ISOMETRIC_COMPONENT,
      tz + distance * SOURCE_ISOMETRIC_COMPONENT,
    ],
    fov: SOURCE_PERSPECTIVE_FOV,
  };
}

export type SourceCameraLightBasis = {
  forward: Vector3;
  right: Vector3;
  up: Vector3;
};

/** Match PackCAD's camera-relative light basis without inheriting camera roll. */
export function sourceCameraLightBasis(camera: Camera): SourceCameraLightBasis {
  const forward = camera.getWorldDirection(new Vector3()).normalize();
  const up = camera.up.clone().normalize();
  const right = forward.clone().cross(up).normalize();
  return { forward, right, up };
}
