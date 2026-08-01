import { createDoc, Editor } from "@atelier/core";
import { createMailerBoxProject } from "@packcad/fold-solver";
import { createProject } from "@packcad/format";
import type { OrigamiSimulationOperation } from "@packcad/format";
import { describe, expect, it } from "vitest";
import { createCommandRegistry } from "./commands";
import { foldModelToDrawing } from "./drawing";
import { toSVG } from "@atelier/io";
import { toGLTF } from "@atelier/io/three";
import { Group, Mesh, MeshStandardMaterial } from "three";
import { buildFoldScene } from "../render/foldSceneBuilder";

describe("PackCAD editor integration", () => {
  it("records app commands in Atelier history and supports undo/redo", () => {
    const editor = new Editor(
      createDoc(createMailerBoxProject()),
      { registry: createCommandRegistry() },
    );
    const original = editor.content.thicknessMm;

    const result = editor.execute("material.setThickness", { thicknessMm: 2.25 });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(editor.content.thicknessMm).toBe(2.25);
    expect(editor.canUndo).toBe(true);

    editor.undo();
    expect(editor.content.thicknessMm).toBe(original);
    expect(editor.canRedo).toBe(true);

    editor.redo();
    expect(editor.content.thicknessMm).toBe(2.25);
    editor.dispose();
  });

  it("imports the bundled SVG fixture through the undoable dieline command", () => {
    const sampleDieline = createMailerBoxProject().dieline;
    const editor = new Editor(
      createDoc(createProject()),
      { registry: createCommandRegistry() },
    );

    const result = editor.execute("project.importDieline", {
      fileName: sampleDieline.name,
      text: sampleDieline.text,
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(editor.content.dieline).toEqual({
      name: sampleDieline.name,
      kind: "svg",
      text: sampleDieline.text,
    });
    expect(editor.undoLabel).toBe("Import dieline");

    editor.undo();
    expect(editor.content.dieline.name).toBe("sample-mailer.svg");
    editor.dispose();
  });

  it("dispatches the persisted view controls through registered commands", () => {
    const editor = new Editor(
      createDoc(createMailerBoxProject()),
      { registry: createCommandRegistry() },
    );

    expect(editor.execute("view.setRenderMode", { renderMode: "technical" }).ok).toBe(true);
    expect(editor.execute("view.setCamera", { cameraPreset: "front" }).ok).toBe(true);
    expect(editor.execute("view.setProjection", { projection: "perspective" }).ok).toBe(true);
    expect(editor.execute("view.setHelpers", { showHelpers: false }).ok).toBe(true);
    expect(editor.content).toMatchObject({
      renderMode: "technical",
      cameraPreset: "front",
      projection: "perspective",
      showHelpers: false,
    });
    expect(editor.undoLabel).toBe("Set helper visibility");

    editor.undo();
    expect(editor.content.showHelpers).toBe(true);
    editor.undo();
    expect(editor.content.projection).toBe("orthographic");
    editor.redo();
    expect(editor.content.projection).toBe("perspective");
    editor.dispose();
  });

  it("dispatches artwork upload, tint, placement, and reset through history", () => {
    const editor = new Editor(
      createDoc(createMailerBoxProject()),
      { registry: createCommandRegistry() },
    );
    const imageDataUrl = "data:image/png;base64,cGFja2NhZA==";
    const backImageDataUrl = "data:image/png;base64,aW50ZXJpb3I=";

    expect(editor.execute("artwork.setColor", { artworkColor: "#aabbcc" }).ok).toBe(true);
    expect(editor.execute("artwork.setPlacement", {
      imageDataUrl,
      imageName: "mark.png",
      backImageDataUrl,
      backImageName: "interior.png",
      panelIndex: 2,
      x: 0.35,
      y: -0.2,
      scale: 1.4,
      rotation: 25,
    }).ok).toBe(true);
    expect(editor.content).toMatchObject({
      artworkColor: "#aabbcc",
      artwork: {
        imageDataUrl,
        imageName: "mark.png",
        backImageDataUrl,
        backImageName: "interior.png",
        panelIndex: 2,
        x: 0.35,
        y: -0.2,
        scale: 1.4,
        rotation: 25,
      },
    });

    expect(editor.execute("artwork.resetPlacement").ok).toBe(true);
    expect(editor.content.artwork).toMatchObject({
      imageDataUrl,
      imageName: "mark.png",
      backImageDataUrl,
      backImageName: "interior.png",
      panelIndex: 2,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    editor.undo();
    expect(editor.content.artwork.rotation).toBe(25);
    editor.dispose();
  });

  it("dispatches manual fixed-panel, append-step, and reset-fold commands", () => {
    const editor = new Editor(
      createDoc(createProject()),
      { registry: createCommandRegistry() },
    );
    const initialStepCount = editor.content.foldingSteps.length;

    expect(editor.execute("fold.setFixedPanel", { panelId: "center" }).ok).toBe(true);
    expect(editor.content.fixedPanelId).toBe("center");
    expect(editor.execute("fold.appendStep").ok).toBe(true);
    expect(editor.content.foldingSteps).toHaveLength(initialStepCount + 1);
    expect(editor.execute("fold.reset").ok).toBe(true);
    expect(editor.content.foldingSteps).toHaveLength(initialStepCount);
    expect(editor.content.activeStepId).toBe("setup");
    editor.dispose();
  });

  it("dispatches every source-backed origami authoring command", () => {
    const editor = new Editor(
      createDoc(createMailerBoxProject()),
      { registry: createCommandRegistry() },
    );
    const originalOperationCount = editor.content.design?.operations.length ?? 0;

    expect(editor.execute("pipeline.addOrigamiKeyframe").ok).toBe(true);
    expect(editor.content.design?.operations).toHaveLength(originalOperationCount + 1);
    const activeOperation = editor.content.design?.operations.find(
      (operation): operation is OrigamiSimulationOperation =>
        operation.id === editor.content.activeStepId
        && operation.type === "OPERATION_ORIGAMI_SIMULATION",
    );
    if (!activeOperation) throw new Error("Added keyframe was not selected");

    expect(editor.execute("pipeline.setTargetAngle", {
      operationId: activeOperation.id,
      angleDegrees: -42,
      groupIndex: 0,
    }).ok).toBe(true);
    const retargeted = editor.content.design?.operations.find(
      (operation) => operation.id === activeOperation.id,
    ) as OrigamiSimulationOperation | undefined;
    expect(retargeted?.foldingEdgeGroups[0]?.targetAngleDegrees).toBe(-42);

    expect(editor.execute("pipeline.enforcePrior", {
      operationId: activeOperation.id,
      value: false,
    }).ok).toBe(true);
    const faceId = editor.content.foldModel?.facesIDs.find(
      (candidate) => !retargeted?.fixedFaceIDs.includes(candidate),
    );
    if (!faceId) throw new Error("Fixture did not expose an unlockable face");
    expect(editor.execute("pipeline.toggleLockedFace", {
      operationId: activeOperation.id,
      faceId,
    }).ok).toBe(true);

    const model = editor.content.foldModel;
    const edgeIndex = model?.edgesAssignment.findIndex(
      (assignment, index) => assignment !== "B" && (model.edgeFaces[index]?.length ?? 0) >= 2,
    ) ?? -1;
    const edge = model?.edgesVertices[edgeIndex];
    const firstVertexId = edge ? model?.verticesIDs[edge[0]] : undefined;
    const secondVertexId = edge ? model?.verticesIDs[edge[1]] : undefined;
    if (!firstVertexId || !secondVertexId) throw new Error("Fixture did not expose a crease");
    const edgeId = `${firstVertexId}-${secondVertexId}`;
    expect(editor.execute("pipeline.setCreaseAngle", {
      operationId: activeOperation.id,
      edgeId,
      angleDegrees: 67,
    }).ok).toBe(true);

    const authored = editor.content.design?.operations.find(
      (operation) => operation.id === activeOperation.id,
    ) as OrigamiSimulationOperation | undefined;
    expect(authored?.enforcePriorConstraints).toBe(false);
    expect(authored?.fixedFaceIDs).toContain(faceId);
    expect(
      authored?.foldingEdgeGroups.find((group) => group.edgeIDs.includes(edgeId))
        ?.targetAngleDegrees,
    ).toBe(67);
    expect(editor.undoLabel).toBe("Set crease angle");
    editor.dispose();
  });

  it("flattens the bundled FOLD graph into an Atelier SVG drawing", () => {
    const model = createMailerBoxProject().foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const svg = toSVG(foldModelToDrawing(model));
    expect(svg).toContain("<svg");
    expect(svg).toContain('data-layer="cut"');
    expect(svg).toContain('data-layer="crease"');
  });

  it("exports the bundled final folded mesh through Atelier glTF", async () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const sceneData = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: project.foldingSteps.length - 1,
      foldAngle: project.foldingSteps.at(-1)?.angle ?? 0,
      thicknessMm: project.thicknessMm,
      panelColorMode: "material",
      edgeColorMode: "mountain-valley",
    });
    const material = new MeshStandardMaterial({ color: "#bc8d55" });
    const mesh = new Mesh(sceneData.geometry, material);
    const group = new Group();
    group.add(mesh);

    const gltf = await toGLTF(group);
    expect(gltf).not.toBeInstanceOf(ArrayBuffer);
    if (gltf instanceof ArrayBuffer) throw new Error("Expected JSON glTF");
    expect("asset" in gltf).toBe(true);

    material.dispose();
    sceneData.geometry.dispose();
    sceneData.lockedTintGeometry?.dispose();
    sceneData.selectedTintGeometry?.dispose();
    sceneData.solidEdgeGeometry.dispose();
    sceneData.creaseEdgeGeometry.dispose();
    sceneData.dashedEdgeGeometry.dispose();
    sceneData.edgePickGeometry.dispose();
  });
});
