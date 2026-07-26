import { createDoc, Editor } from "@atelier/core";
import { createMailerBoxProject } from "@packcad/fold-solver";
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
    sceneData.dashedEdgeGeometry.dispose();
    sceneData.edgePickGeometry.dispose();
  });
});
