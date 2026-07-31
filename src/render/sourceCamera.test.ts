import { describe, expect, it } from "vitest";
import { sourceIsometricCameraState } from "./sourceCamera";

describe("source isometric camera", () => {
  it("matches the centred PackCAD direction without changing orbit distance", () => {
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
    expect(
      (next.position[0] - next.target[0])
        / (next.position[2] - next.target[2]),
    ).toBeCloseTo(4.8 / 5.8, 10);
    expect(
      (next.position[1] - next.target[1])
        / (next.position[2] - next.target[2]),
    ).toBeCloseTo(-4.8 / 5.8, 10);
    expect(next.target).toEqual(source.target);
    expect(next.zoom).toBe(source.zoom);
  });
});
