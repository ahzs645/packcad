import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  sourceCameraLightBasis,
  sourceIsometricCameraState,
} from "./sourceCamera";

describe("source isometric camera", () => {
  it("matches the captured PackCAD direction without changing orbit distance", () => {
    const source = {
      kind: "orthographic" as const,
      position: [4, 5, 8] as [number, number, number],
      target: [1, 2, 3] as [number, number, number],
      zoom: 12,
      fov: 42,
    };
    const next = sourceIsometricCameraState(source);
    const sourceDistance = Math.hypot(3, 3, 5);
    const nextDistance = Math.hypot(
      next.position[0] - next.target[0],
      next.position[1] - next.target[1],
      next.position[2] - next.target[2],
    );

    expect(nextDistance).toBeCloseTo(sourceDistance, 10);
    const component = sourceDistance / Math.sqrt(3);
    expect(next.position[0] - next.target[0]).toBeCloseTo(
      component,
      10,
    );
    expect(next.position[1] - next.target[1]).toBeCloseTo(
      component,
      10,
    );
    expect(next.position[2] - next.target[2]).toBeCloseTo(
      component,
      10,
    );
    expect(next.target).toEqual(source.target);
    expect(next.zoom).toBe(source.zoom);
    expect(next.kind).toBe(source.kind);
    expect(next.fov).toBe(15);
  });
});

describe("source camera light basis", () => {
  it("uses fixed camera-up instead of the orbit camera's rotating screen-up", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(4, 3, 5);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.rotateZ(0.4);
    camera.updateMatrixWorld(true);

    const basis = sourceCameraLightBasis(camera);
    const screenUp = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

    expect(basis.up.toArray()).toEqual([0, 1, 0]);
    expect(basis.up.distanceTo(screenUp)).toBeGreaterThan(0.1);
    expect(basis.right.distanceTo(
      basis.forward.clone().cross(basis.up).normalize(),
    )).toBeLessThan(1e-12);
  });
});
