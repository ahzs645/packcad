import { describe, expect, it } from "vitest";
import { parseViewerCommand, readViewerOptions, resolveStepId } from "./embedProtocol";

const steps = [{ id: "setup" }, { id: "a" }, { id: "b" }];

describe("viewer options", () => {
  it("reads the project and how to show it from the address", () => {
    expect(readViewerOptions("?project=bus.packcad.pdf&step=2&autoplay=1&layout=split&controls=0&background=fafafa&loop=yes"))
      .toEqual({
        projectUrl: "bus.packcad.pdf",
        step: "2",
        autoplay: true,
        layout: "split-horizontal",
        controls: false,
        background: "#fafafa",
        loop: true,
      });
  });

  it("defaults to the finished model in 3D with controls", () => {
    expect(readViewerOptions("")).toMatchObject({
      projectUrl: null, step: "final", autoplay: false, layout: "single-3d", controls: true, background: null, loop: false,
    });
  });

  it("refuses a background that is not a hex colour", () => {
    expect(readViewerOptions("?background=red;x:url(y)").background).toBeNull();
  });
});

describe("step requests", () => {
  it("names stages by position, id, or end", () => {
    expect(resolveStepId(steps, "final", "x")).toBe("b");
    expect(resolveStepId(steps, "setup", "x")).toBe("setup");
    expect(resolveStepId(steps, 1, "x")).toBe("a");
    expect(resolveStepId(steps, "9", "x")).toBe("b");
    expect(resolveStepId(steps, "a", "x")).toBe("a");
    expect(resolveStepId(steps, "missing", "x")).toBe("x");
  });
});

describe("host commands", () => {
  it("accepts the commands it knows, and nothing else", () => {
    expect(parseViewerCommand({ type: "packcad:play" })).toEqual({ type: "packcad:play" });
    expect(parseViewerCommand({ type: "packcad:seek", step: 3 })).toEqual({ type: "packcad:seek", step: 3 });
    expect(parseViewerCommand({ type: "packcad:seek" })).toBeNull();
    expect(parseViewerCommand({ type: "packcad:layout", layout: "2d" })).toEqual({ type: "packcad:layout", layout: "2d" });
    expect(parseViewerCommand({ type: "packcad:layout", layout: "4d" })).toBeNull();
    expect(parseViewerCommand({ type: "packcad:background", color: "#000" })).toEqual({ type: "packcad:background", color: "#000" });
    expect(parseViewerCommand({ type: "other:play" })).toBeNull();
    expect(parseViewerCommand("packcad:play")).toBeNull();
  });
});
