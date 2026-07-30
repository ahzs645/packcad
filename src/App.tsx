import {
  LocalDocumentStore,
  makeUid,
  type LocalDocumentMetadata,
} from "@atelier/core";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { ArtworkPanel } from "./components/ArtworkPanel";
import { Inspector } from "./components/Inspector";
import { MaterialPanel } from "./components/MaterialPanel";
import { OperationPipelinePanel } from "./components/OperationPipelinePanel";
import { Toolbar } from "./components/Toolbar";
import { ViewportPane } from "./components/ViewportPane";
import { foldModelToDrawing } from "./model/drawing";
import { useFoldingPlayback } from "./model/foldingPlayback";
import type { FoldDiagnostics } from "./render/foldSettlement";
import {
  createFoldStatusHost,
  type FoldStatusState,
} from "./render/foldStatus";
import {
  bindProjectAutosave,
  createProjectEditor,
  type ProjectAutosaveBinding,
  type ProjectDocumentIdentity,
  type ProjectSaveState,
} from "./persistence/projectDocuments";

type ImportNotice = {
  kind: "success" | "error";
  message: string;
};

// Keep the initial Editor at module scope so React Strict Mode's development
// effect rehearsal cannot dispose a still-live first session. Draft loads swap
// in newly constructed Editors so each document receives an isolated History.
const initialEditor = createProjectEditor(
  createMailerBoxProject(),
  { name: "Mailer Box" },
);
const documentStore = new LocalDocumentStore<PackagingProject>({
  dbName: "packcad-documents",
});

export default function App() {
  const [editor, setEditor] = useState(initialEditor);
  const state = useEditor(editor);
  const [activeDocument, setActiveDocument] = useState<ProjectDocumentIdentity>({
    id: initialEditor.doc.meta.id,
    name: initialEditor.doc.meta.name,
  });
  const [drafts, setDrafts] = useState<LocalDocumentMetadata[]>([]);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [saveState, setSaveState] = useState<ProjectSaveState>("saved");
  const [restoredDraftName, setRestoredDraftName] = useState<string | null>(null);
  const autosaveRef = useRef<ProjectAutosaveBinding | null>(null);
  const foldingPlayback = useFoldingPlayback(state.content);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number | null>(null);
  const [selectedFoldEdgeIndex, setSelectedFoldEdgeIndex] = useState<number | null>(null);
  const [hoveredFoldEdgeIndex, setHoveredFoldEdgeIndex] = useState<number | null>(null);
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  const [foldDiagnostics, setFoldDiagnostics] = useState<FoldDiagnostics>({
    status: "settling",
  });
  const [foldStatus, setFoldStatus] = useState<FoldStatusState>({
    status: "idle",
  });
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const handleSceneObject = useCallback((object: Object3D | null): void => {
    setSceneObject(object);
  }, []);

  const refreshDrafts = useCallback(async (): Promise<void> => {
    setDrafts(await documentStore.list());
  }, []);

  const replaceEditor = useCallback((
    nextEditor: typeof initialEditor,
  ): void => {
    setEditor((current) => {
      if (current !== nextEditor) current.dispose();
      return nextEditor;
    });
    setSelectedFaceIndex(null);
    setSelectedFoldEdgeIndex(null);
    setHoveredFoldEdgeIndex(null);
  }, []);

  const handleSelectFace = useCallback((faceIndex: number | null): void => {
    setSelectedFaceIndex(faceIndex);
    if (faceIndex !== null) setSelectedFoldEdgeIndex(null);
  }, []);

  const handleSelectFoldEdge = useCallback((edgeIndex: number | null): void => {
    setSelectedFoldEdgeIndex(edgeIndex);
    if (edgeIndex !== null) setSelectedFaceIndex(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void documentStore.list().then(async (listed) => {
      if (cancelled) return;
      const recent = listed[0];
      let restored = false;
      if (recent) {
        const snapshot = await documentStore.load(recent.id);
        if (cancelled) return;
        if (snapshot) {
          replaceEditor(createProjectEditor(snapshot, recent));
          setActiveDocument({ id: recent.id, name: recent.name });
          setRestoredDraftName(recent.name);
          restored = true;
        }
      }
      if (!restored) {
        await documentStore.save(
          initialEditor.doc.meta.id,
          initialEditor.doc.meta.name,
          initialEditor.content,
        );
        if (cancelled) return;
      }
      const nextDrafts = await documentStore.list();
      if (cancelled) return;
      setDrafts(nextDrafts);
      setPersistenceReady(true);
    }).catch(() => {
      if (cancelled) return;
      setSaveState("error");
      setPersistenceReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [replaceEditor]);

  useEffect(() => {
    if (!persistenceReady) return;
    const binding = bindProjectAutosave(
      editor,
      documentStore,
      activeDocument.id,
      (nextState) => {
        setSaveState(nextState);
        if (nextState === "saved") void refreshDrafts();
      },
    );
    autosaveRef.current = binding;
    const handleBeforeUnload = (): void => {
      void binding.flush();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      if (autosaveRef.current === binding) autosaveRef.current = null;
      binding.dispose();
    };
  }, [activeDocument.id, editor, persistenceReady, refreshDrafts]);

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

  useEffect(() => {
    const model = state.content.foldModel;
    if (!model) {
      setFoldStatus({ status: "idle" });
      return;
    }
    let cancelled = false;
    let activeHost: Awaited<ReturnType<typeof createFoldStatusHost>> | null = null;
    setFoldStatus({ status: "solving" });
    void createFoldStatusHost(model)
      .then(async (host) => {
        activeHost = host;
        if (cancelled) {
          host.dispose();
          return;
        }
        const summary = await host.solve("summary");
        if (!cancelled) setFoldStatus({ status: "ready", summary });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFoldStatus({
          status: "error",
          message: error instanceof Error
            ? error.message
            : "Fold solve did not return a verdict.",
        });
      });
    return () => {
      cancelled = true;
      activeHost?.dispose();
    };
  }, [state.content.foldModel]);

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

  const importDielineFile = useCallback(async (file: File): Promise<void> => {
    setImportNotice(null);
    try {
      const text = await file.text();
      const result = state.execute("project.importDieline", {
        fileName: file.name,
        text,
      });
      if (!result.ok) {
        throw new Error(result.error ?? "The dieline could not be imported.");
      }
      setSelectedFaceIndex(null);
      setImportNotice({
        kind: "success",
        message: `Imported dieline: ${file.name}`,
      });
    } catch (error) {
      setImportNotice({
        kind: "error",
        message: error instanceof Error
          ? `Could not import ${file.name}: ${error.message}`
          : `Could not import ${file.name}.`,
      });
    }
  }, [state.execute]);

  const startFresh = useCallback(async (
    flushCurrent = true,
  ): Promise<void> => {
    try {
      if (flushCurrent) await autosaveRef.current?.flush();
      const commandEditor = createProjectEditor(editor.content);
      const result = commandEditor.execute("project.new");
      const snapshot = commandEditor.content;
      commandEditor.dispose();
      if (!result.ok) throw new Error(result.error ?? "Could not create a project.");

      const identity = {
        id: makeUid("doc"),
        name: "Untitled project",
      };
      await documentStore.save(identity.id, identity.name, snapshot);
      replaceEditor(createProjectEditor(snapshot, identity));
      setActiveDocument(identity);
      setRestoredDraftName(null);
      setSaveState("saved");
      await refreshDrafts();
    } catch (error) {
      setSaveState("error");
      setImportNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not create a project.",
      });
    }
  }, [editor.content, refreshDrafts, replaceEditor]);

  const openDraft = useCallback(async (
    metadata: LocalDocumentMetadata,
  ): Promise<void> => {
    try {
      await autosaveRef.current?.flush();
      const snapshot = await documentStore.load(metadata.id);
      if (!snapshot) throw new Error(`Draft “${metadata.name}” is unavailable.`);
      replaceEditor(createProjectEditor(snapshot, metadata));
      setActiveDocument({ id: metadata.id, name: metadata.name });
      setRestoredDraftName(null);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setImportNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not open the draft.",
      });
    }
  }, [replaceEditor]);

  const saveAs = useCallback(async (): Promise<void> => {
    const requested = window.prompt("Draft name", activeDocument.name);
    const name = requested?.trim();
    if (!name) return;
    try {
      await autosaveRef.current?.flush();
      const identity = { id: makeUid("doc"), name };
      await documentStore.save(identity.id, identity.name, editor.content);
      setActiveDocument(identity);
      setSaveState("saved");
      await refreshDrafts();
    } catch {
      setSaveState("error");
    }
  }, [activeDocument.name, editor.content, refreshDrafts]);

  const renameDraft = useCallback(async (): Promise<void> => {
    const requested = window.prompt("Rename draft", activeDocument.name);
    const name = requested?.trim();
    if (!name || name === activeDocument.name) return;
    try {
      await autosaveRef.current?.flush();
      await documentStore.save(activeDocument.id, name, editor.content);
      setActiveDocument((current) => ({ ...current, name }));
      setSaveState("saved");
      await refreshDrafts();
    } catch {
      setSaveState("error");
    }
  }, [activeDocument, editor.content, refreshDrafts]);

  const deleteDraft = useCallback(async (
    metadata: LocalDocumentMetadata,
  ): Promise<void> => {
    if (!window.confirm(`Delete “${metadata.name}”? This cannot be undone.`)) return;
    try {
      if (metadata.id === activeDocument.id) {
        autosaveRef.current?.dispose();
        autosaveRef.current = null;
      }
      await documentStore.delete(metadata.id);
      if (metadata.id === activeDocument.id) await startFresh(false);
      else await refreshDrafts();
    } catch {
      setSaveState("error");
    }
  }, [activeDocument.id, refreshDrafts, startFresh]);

  if (!persistenceReady) {
    return (
      <main className="app-loading" aria-live="polite">
        <span className="brand-mark">P</span>
        <strong>Restoring local drafts…</strong>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Toolbar
        documentName={activeDocument.name}
        drafts={drafts}
        activeDocumentId={activeDocument.id}
        persistenceReady={persistenceReady}
        saveState={saveState}
        viewMode={state.content.viewMode}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        undoLabel={state.undoLabel}
        redoLabel={state.redoLabel}
        onNew={() => void startFresh()}
        onOpenDraft={(draft) => void openDraft(draft)}
        onSaveAs={() => void saveAs()}
        onRename={() => void renameDraft()}
        onDeleteDraft={(draft) => void deleteDraft(draft)}
        onImport={(file) => void importDielineFile(file)}
        onSetView={(viewMode) => state.execute("view.setMode", { viewMode })}
        onUndo={state.undo}
        onRedo={state.redo}
        onExport={(format) => void exportProject(format)}
      />
      {restoredDraftName ? (
        <div className="restore-notice" role="status">
          <span>Restored “{restoredDraftName}”</span>
          <button type="button" onClick={() => void startFresh()}>
            Start fresh
          </button>
          <button
            type="button"
            aria-label="Dismiss restore notice"
            onClick={() => setRestoredDraftName(null)}
          >
            ×
          </button>
        </div>
      ) : null}
      {importNotice ? (
        <div
          className={`import-notice ${importNotice.kind}`}
          role={importNotice.kind === "error" ? "alert" : "status"}
        >
          {importNotice.message}
        </div>
      ) : null}
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
          <ArtworkPanel
            project={state.content}
            onSetColor={(artworkColor) =>
              state.execute("artwork.setColor", { artworkColor })}
            onSetPlacement={(placement) =>
              state.execute("artwork.setPlacement", placement)}
            onResetPlacement={() => state.execute("artwork.resetPlacement")}
          />
        </div>
        <ViewportPane
          project={foldingPlayback.displayedProject}
          foldPlayback={foldingPlayback.player}
          selectedFaceIndex={selectedFaceIndex}
          selectedFoldEdgeIndex={selectedFoldEdgeIndex}
          hoveredFoldEdgeIndex={hoveredFoldEdgeIndex}
          onSelectFace={handleSelectFace}
          onSelectFoldEdge={handleSelectFoldEdge}
          onHoverFoldEdge={setHoveredFoldEdgeIndex}
          onSceneObject={handleSceneObject}
          onFoldDiagnostics={setFoldDiagnostics}
          onSetRenderMode={(renderMode) =>
            state.execute("view.setRenderMode", { renderMode })}
          onSetCamera={(cameraPreset) =>
            state.execute("view.setCamera", { cameraPreset })}
          onSetProjection={(projection) =>
            state.execute("view.setProjection", { projection })}
          onSetHelpers={(showHelpers) =>
            state.execute("view.setHelpers", { showHelpers })}
        />
        <Inspector
          project={foldingPlayback.displayedProject}
          selectedFaceIndex={selectedFaceIndex}
          selectedFoldEdgeIndex={selectedFoldEdgeIndex}
          foldDiagnostics={foldDiagnostics}
          foldStatus={foldStatus}
          foldPlaying={foldingPlayback.player.playing}
          foldProgress={foldingPlayback.progress}
          onToggleFoldPlayback={
            foldingPlayback.player.playing
              ? foldingPlayback.pause
              : foldingPlayback.play
          }
          onSelectStep={(stepId) => {
            foldingPlayback.pause();
            setSelectedFaceIndex(null);
            setSelectedFoldEdgeIndex(null);
            setHoveredFoldEdgeIndex(null);
            state.execute("fold.selectStep", { stepId });
          }}
          onSetAngle={(angle) => {
            foldingPlayback.pause();
            if (state.content.activeStepId !== foldingPlayback.frame.activeStepId) {
              state.execute("fold.selectStep", {
                stepId: foldingPlayback.frame.activeStepId,
              });
            }
            state.execute("fold.setAngle", { angle });
          }}
          onSetThickness={(thicknessMm) =>
            state.execute("material.setThickness", { thicknessMm })}
          onSetFixedPanel={(panelId) =>
            state.execute("fold.setFixedPanel", { panelId })}
          onAppendStep={() => {
            foldingPlayback.pause();
            state.execute("fold.appendStep");
          }}
          onResetFold={() => {
            foldingPlayback.pause();
            setSelectedFoldEdgeIndex(null);
            state.execute("fold.reset");
          }}
          onAddOrigamiKeyframe={() => {
            foldingPlayback.pause();
            setSelectedFoldEdgeIndex(null);
            state.execute("pipeline.addOrigamiKeyframe");
          }}
          onSetTargetAngle={(operationId, angleDegrees, groupIndex) => {
            foldingPlayback.pause();
            state.execute("pipeline.setTargetAngle", {
              operationId,
              angleDegrees,
              groupIndex,
            });
          }}
          onSetEnforcePrior={(operationId, value) => {
            foldingPlayback.pause();
            state.execute("pipeline.enforcePrior", { operationId, value });
          }}
          onToggleLockedFace={(operationId, faceId) => {
            foldingPlayback.pause();
            state.execute("pipeline.toggleLockedFace", { operationId, faceId });
          }}
          onSetCreaseAngle={(operationId, edgeId, angleDegrees) => {
            foldingPlayback.pause();
            state.execute("pipeline.setCreaseAngle", {
              operationId,
              edgeId,
              angleDegrees,
            });
          }}
        />
      </div>
    </main>
  );
}
