import { createDoc, Editor } from "@atelier/core";
import {
  toDXF,
  toHPGL,
  toSVG,
  toTiledPDF,
} from "@atelier/io";
import { downloadBlob, downloadText, toPNG } from "@atelier/io/browser";
import { toGLTF } from "@atelier/io/three";
import { useEditor } from "@atelier/react";
import { createMailerBoxProject } from "@packcad/fold-solver";
import type { PackagingProject } from "@packcad/format";
import type { Object3D } from "three";
import { useCallback, useEffect, useState } from "react";
import { Inspector } from "./components/Inspector";
import { MaterialPanel } from "./components/MaterialPanel";
import { OperationPipelinePanel } from "./components/OperationPipelinePanel";
import { Toolbar } from "./components/Toolbar";
import { ViewportPane } from "./components/ViewportPane";
import { createCommandRegistry } from "./model/commands";
import { foldModelToDrawing } from "./model/drawing";
import type { FoldDiagnostics } from "./render/foldSettlement";

// App owns one document for the lifetime of the SPA. Keeping the Editor at module
// scope avoids React Strict Mode's development-only effect rehearsal disposing a
// still-live Editor before the first user command.
const editor = new Editor<PackagingProject>(
  createDoc(createMailerBoxProject(), { name: "Mailer Box" }),
  { registry: createCommandRegistry(), history: { limit: 100 } },
);

export default function App() {
  const state = useEditor(editor);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number | null>(null);
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  const [foldDiagnostics, setFoldDiagnostics] = useState<FoldDiagnostics>({
    status: "settling",
  });
  const handleSceneObject = useCallback((object: Object3D | null): void => {
    setSceneObject(object);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor]);

  const exportProject = useCallback(async (
    format: "svg" | "gltf" | "dxf" | "hpgl" | "pdf" | "png",
  ): Promise<void> => {
    const model = state.content.foldModel;
    if (!model) return;
    if (format === "gltf") {
      if (!sceneObject) return;
      // Crease guides are LineSegments and have no glTF PBR material analogue;
      // the deliverable is the closed package shell, not viewport-only guides.
      const exportObject = sceneObject.children.find((child) => child.type === "Mesh")
        ?? sceneObject;
      const gltf = await toGLTF(exportObject);
      if (gltf instanceof ArrayBuffer) {
        downloadBlob("mailer-box.glb", new Blob([gltf], { type: "model/gltf-binary" }));
      } else {
        downloadText("mailer-box.gltf", JSON.stringify(gltf, null, 2), "model/gltf+json");
      }
      return;
    }
    const drawing = foldModelToDrawing(model);
    if (format === "svg") downloadText("mailer-box.svg", toSVG(drawing), "image/svg+xml");
    if (format === "dxf") downloadText("mailer-box.dxf", toDXF(drawing), "application/dxf");
    if (format === "hpgl") downloadText("mailer-box.hpgl", toHPGL(drawing));
    if (format === "pdf") {
      const bytes = Uint8Array.from(toTiledPDF(drawing));
      downloadBlob("mailer-box-tiled.pdf", new Blob([bytes], { type: "application/pdf" }));
    }
    if (format === "png") {
      const blob = await toPNG(drawing);
      if (blob) downloadBlob("mailer-box.png", blob);
    }
  }, [sceneObject, state.content.foldModel]);

  return (
    <main className="app-shell">
      <Toolbar
        viewMode={state.content.viewMode}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        undoLabel={state.undoLabel}
        redoLabel={state.redoLabel}
        onSetView={(viewMode) => state.execute("view.setMode", { viewMode })}
        onUndo={state.undo}
        onRedo={state.redo}
        onExport={(format) => void exportProject(format)}
      />
      <div className="workspace">
        <div className="left-rail">
          <OperationPipelinePanel
            project={state.content}
            onToggleOperation={(operationId) =>
              state.execute("pipeline.toggleOperation", { operationId })}
          />
          <MaterialPanel
            project={state.content}
            onSelect={(specId) => state.execute("material.selectSpec", { specId })}
          />
        </div>
        <ViewportPane
          project={state.content}
          selectedFaceIndex={selectedFaceIndex}
          onSelectFace={setSelectedFaceIndex}
          onSceneObject={handleSceneObject}
          onFoldDiagnostics={setFoldDiagnostics}
        />
        <Inspector
          project={state.content}
          selectedFaceIndex={selectedFaceIndex}
          foldDiagnostics={foldDiagnostics}
          onSelectStep={(stepId) => state.execute("fold.selectStep", { stepId })}
          onSetAngle={(angle) => state.execute("fold.setAngle", { angle })}
          onSetThickness={(thicknessMm) =>
            state.execute("material.setThickness", { thicknessMm })}
        />
      </div>
    </main>
  );
}
