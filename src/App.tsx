import {
  LocalDocumentStore,
  makeUid,
  type LocalDocumentMetadata,
} from "@atelier/core";
import { toDXF, toHPGL, toSVG, toTiledPDF } from "@atelier/io";
import { downloadBlob, downloadText, toPNG } from "@atelier/io/browser";
import { toGLTF } from "@atelier/io/three";
import { useEditor } from "@atelier/react";
import { createMailerBoxProject } from "@packcad/fold-solver";
import type {
  PackagingProject,
  PanelId,
} from "@packcad/format";
import { materialCatalog } from "@packcad/format";
import type { Object3D } from "three";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { packCadLogo } from "./assets/sourceChrome";
import { Inspector } from "./components/Inspector";
import { Icon } from "./components/Icon";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { SourceSidebar } from "./components/SourceSidebar";
import { Topbar, type OpenMenu } from "./components/Topbar";
import { ViewportWorkspace } from "./components/ViewportWorkspace";
import { foldModelToDrawing } from "./model/drawing";
import { useFoldingPlayback } from "./model/foldingPlayback";
import {
  projectFromFileText,
  projectFromUnknown,
} from "./model/projectImport";
import {
  createPackCadSampleProject,
  packCadSampleLibrary,
} from "./model/sampleLibrary";
import {
  defaultUiPreferences,
  loadUiPreferences,
  modeForSingleLayout,
  preferencesForLoadedProject,
  UI_PREFERENCES_STORAGE_KEY,
  viewLayoutNotice,
  type UiPreferences,
  type ViewLayout,
} from "./model/uiPreferences";
import {
  bindProjectAutosave,
  createProjectEditor,
  type ProjectAutosaveBinding,
  type ProjectDocumentIdentity,
  type ProjectSaveState,
  type ProjectSnapshot,
} from "./persistence/projectDocuments";
import {
  createFoldStatusHost,
  type FoldStatusState,
} from "./render/foldStatus";
import { useFoldSettlement } from "./render/useFoldSettlement";

type ImportNotice = {
  kind: "success" | "error";
  message: string;
};

function projectFromRoute(): ProjectSnapshot | null {
  try {
    const encoded = new URLSearchParams(window.location.hash.slice(1)).get(
      "project",
    );
    if (!encoded) return null;
    return JSON.parse(encoded) as ProjectSnapshot;
  } catch {
    return null;
  }
}

const routeProject = projectFromRoute();
const initialEditor = createProjectEditor(
  routeProject ?? createMailerBoxProject(),
  { name: routeProject ? "Shared PackCAD project" : "Mailer Box" },
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
  const [importNotice, setImportNotice] = useState<ImportNotice | null>(null);
  const [projectDragActive, setProjectDragActive] = useState(false);
  const [notice, setNotice] = useState("Ready");
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mobileNoticeVisible, setMobileNoticeVisible] = useState(true);
  const [openSection, setOpenSection] = useState<
    "samples" | "material" | "artwork" | null
  >(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [preferences, setPreferences] = useState<UiPreferences>(
    () => preferencesForLoadedProject(
      initialEditor.content,
      loadUiPreferences(),
    ),
  );
  const [fitNonce, setFitNonce] = useState(0);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number | null>(null);
  const [selectedFoldEdgeIndex, setSelectedFoldEdgeIndex] = useState<
    number | null
  >(null);
  const [hoveredFoldEdgeIndex, setHoveredFoldEdgeIndex] = useState<
    number | null
  >(null);
  const [sceneObject, setSceneObject] = useState<Object3D | null>(null);
  const [foldStatus, setFoldStatus] = useState<FoldStatusState>({
    status: "idle",
  });
  const autosaveRef = useRef<ProjectAutosaveBinding | null>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const menuDielineInputRef = useRef<HTMLInputElement>(null);
  const projectDragDepthRef = useRef(0);
  const autoplayEditorRef = useRef<typeof initialEditor | null>(null);
  const foldingPlayback = useFoldingPlayback(state.content);
  const sharedSettlement = useFoldSettlement(
    foldingPlayback.displayedProject,
    foldingPlayback.player,
  );

  const refreshDrafts = useCallback(async (): Promise<void> => {
    setDrafts(await documentStore.list());
  }, []);

  const replaceEditor = useCallback((
    nextEditor: typeof initialEditor,
  ): void => {
    setPreferences((current) =>
      preferencesForLoadedProject(nextEditor.content, current));
    setEditor((current) => {
      if (current !== nextEditor) current.dispose();
      return nextEditor;
    });
    setSelectedFaceIndex(null);
    setSelectedFoldEdgeIndex(null);
    setHoveredFoldEdgeIndex(null);
    setSceneObject(null);
  }, []);

  const updatePreferences = useCallback((
    patch: Partial<UiPreferences>,
  ): void => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      window.localStorage.setItem(
        UI_PREFERENCES_STORAGE_KEY,
        JSON.stringify(next),
      );
      return next;
    });
  }, []);

  const applyViewLayout = useCallback((layout: ViewLayout): void => {
    updatePreferences({ viewLayout: layout });
    const mode = modeForSingleLayout(layout);
    if (mode) state.execute("view.setMode", { viewMode: mode });
    setNotice(viewLayoutNotice(layout));
  }, [state.execute, updatePreferences]);

  const updatePreferencesAndProject = useCallback((
    patch: Partial<UiPreferences>,
  ): void => {
    updatePreferences(patch);
    if (patch.cameraType) {
      state.execute("view.setProjection", {
        projection: patch.cameraType,
      });
    }
    if (patch.fluteSize) {
      const flute = /^([A-Z])\s+Flute$/i.exec(patch.fluteSize)?.[1];
      const specId = flute
        ? `MATERIAL_CORRUGATED_CARDBOARD_${flute.toUpperCase()}_FLUTE`
        : null;
      if (specId && materialCatalog[specId]) {
        state.execute("material.selectSpec", { specId });
      }
    }
  }, [state.execute, updatePreferences]);

  const selectMaterialSpec = useCallback((specId: string): void => {
    state.execute("material.selectSpec", { specId });
    const flute = materialCatalog[specId]?.subType?.match(
      /_([A-Z])_FLUTE$/,
    )?.[1];
    if (flute) updatePreferences({ fluteSize: `${flute} Flute` });
    setNotice(`Selected ${materialCatalog[specId]?.label ?? "material"}`);
  }, [state.execute, updatePreferences]);

  const startFresh = useCallback(async (
    flushCurrent = true,
  ): Promise<void> => {
    try {
      if (flushCurrent) await autosaveRef.current?.flush();
      const commandEditor = createProjectEditor(editor.content);
      const result = commandEditor.execute("project.new");
      const snapshot = commandEditor.content;
      commandEditor.dispose();
      if (!result.ok) {
        throw new Error(result.error ?? "Could not create a project.");
      }
      const identity = {
        id: makeUid("doc"),
        name: "Untitled project",
      };
      await documentStore.save(identity.id, identity.name, snapshot);
      replaceEditor(createProjectEditor(snapshot, identity));
      setActiveDocument(identity);
      setRestoredDraftName(null);
      setSaveState("saved");
      setNotice("Started a new project");
      window.history.replaceState(null, "", window.location.pathname);
      await refreshDrafts();
    } catch (error) {
      setSaveState("error");
      setImportNotice({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Could not create a project.",
      });
    }
  }, [editor.content, refreshDrafts, replaceEditor]);

  const openDraft = useCallback(async (
    metadata: LocalDocumentMetadata,
  ): Promise<void> => {
    try {
      await autosaveRef.current?.flush();
      const stored = await documentStore.load(metadata.id);
      if (!stored) throw new Error(`Draft “${metadata.name}” is unavailable.`);
      const snapshot = projectFromUnknown(stored);
      await documentStore.save(metadata.id, metadata.name, snapshot);
      replaceEditor(createProjectEditor(snapshot, metadata));
      setActiveDocument({ id: metadata.id, name: metadata.name });
      setRestoredDraftName(null);
      setSaveState("saved");
      setNotice(`Loaded local draft: ${metadata.name}`);
    } catch (error) {
      setSaveState("error");
      setImportNotice({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Could not open the draft.",
      });
    }
  }, [replaceEditor]);

  const loadSample = useCallback(async (sampleId: string): Promise<void> => {
    try {
      await autosaveRef.current?.flush();
      const definition = packCadSampleLibrary.find(
        (sample) => sample.id === sampleId,
      );
      if (!definition) throw new Error(`Unknown PackCAD sample: ${sampleId}`);
      const snapshot = createPackCadSampleProject(sampleId);
      const identity = { id: makeUid("doc"), name: definition.name };
      await documentStore.save(identity.id, identity.name, snapshot);
      replaceEditor(createProjectEditor(snapshot, identity));
      setActiveDocument(identity);
      setRestoredDraftName(null);
      setSaveState("saved");
      setOpenSection(null);
      setNotice(`Loaded sample: ${definition.name}`);
      window.history.replaceState(null, "", window.location.pathname);
      await refreshDrafts();
    } catch (error) {
      setSaveState("error");
      setImportNotice({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Could not load the sample.",
      });
    }
  }, [refreshDrafts, replaceEditor]);

  const saveAs = useCallback(async (): Promise<void> => {
    const requested = window.prompt("Draft name", activeDocument.name);
    const name = requested?.trim();
    if (!name) return;
    try {
      await autosaveRef.current?.flush();
      const identity = { id: makeUid("doc"), name };
      await documentStore.save(identity.id, identity.name, editor.content);
      replaceEditor(createProjectEditor(editor.content, identity));
      setActiveDocument(identity);
      setSaveState("saved");
      setNotice(`Saved local draft: ${name}`);
      await refreshDrafts();
    } catch {
      setSaveState("error");
    }
  }, [
    activeDocument.name,
    editor.content,
    refreshDrafts,
    replaceEditor,
  ]);

  const saveDraft = useCallback(async (): Promise<void> => {
    try {
      await autosaveRef.current?.flush();
      setSaveState("saved");
      setNotice(`Saved local draft: ${activeDocument.name}`);
      await refreshDrafts();
    } catch {
      setSaveState("error");
    }
  }, [activeDocument.name, refreshDrafts]);

  const deleteDraft = useCallback(async (
    metadata: LocalDocumentMetadata,
  ): Promise<void> => {
    if (!window.confirm(`Delete “${metadata.name}”? This cannot be undone.`)) {
      return;
    }
    try {
      if (metadata.id === activeDocument.id) {
        autosaveRef.current?.dispose();
        autosaveRef.current = null;
      }
      await documentStore.delete(metadata.id);
      if (metadata.id === activeDocument.id) await startFresh(false);
      else await refreshDrafts();
      setNotice("Deleted local draft");
    } catch {
      setSaveState("error");
    }
  }, [activeDocument.id, refreshDrafts, startFresh]);

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
      setSelectedFoldEdgeIndex(null);
      setNotice(`Imported dieline: ${file.name}`);
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

  const openProjectFile = useCallback(async (file: File): Promise<void> => {
    setImportNotice(null);
    try {
      await autosaveRef.current?.flush();
      const snapshot = projectFromFileText(await file.text());
      const identity = {
        id: makeUid("doc"),
        name: file.name.replace(/\.packcad(?:\.json)?$|\.json$/i, ""),
      };
      const nextEditor = createProjectEditor(snapshot, identity);
      await documentStore.save(identity.id, identity.name, nextEditor.content);
      replaceEditor(nextEditor);
      setActiveDocument(identity);
      setSaveState("saved");
      setNotice(`Opened project: ${file.name}`);
      setImportNotice({
        kind: "success",
        message: `Opened project: ${file.name}`,
      });
      await refreshDrafts();
    } catch (error) {
      setImportNotice({
        kind: "error",
        message: error instanceof Error
          ? `Could not open ${file.name}: ${error.message}`
          : `Could not open ${file.name}.`,
      });
    }
  }, [refreshDrafts, replaceEditor]);

  const handleProjectDragEnter = useCallback((
    event: DragEvent<HTMLDivElement>,
  ): void => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    projectDragDepthRef.current += 1;
    setProjectDragActive(true);
  }, []);

  const handleProjectDragOver = useCallback((
    event: DragEvent<HTMLDivElement>,
  ): void => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleProjectDragLeave = useCallback((
    event: DragEvent<HTMLDivElement>,
  ): void => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    projectDragDepthRef.current = Math.max(
      0,
      projectDragDepthRef.current - 1,
    );
    if (projectDragDepthRef.current === 0) setProjectDragActive(false);
  }, []);

  const handleProjectDrop = useCallback((
    event: DragEvent<HTMLDivElement>,
  ): void => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    projectDragDepthRef.current = 0;
    setProjectDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length !== 1) {
      setImportNotice({
        kind: "error",
        message: files.length === 0
          ? "Drop a PackCAD JSON project file."
          : "Drop one PackCAD project at a time.",
      });
      return;
    }
    const [file] = files;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setImportNotice({
        kind: "error",
        message: `Could not open ${file.name}: expected a JSON project file.`,
      });
      return;
    }
    void openProjectFile(file);
  }, [openProjectFile]);

  const saveProjectFile = useCallback((): void => {
    downloadText(
      "packcad-project.packcad.json",
      JSON.stringify(editor.content, null, 2),
      "application/json",
    );
    setNotice("Saved project document");
  }, [editor.content]);

  const copyProjectUrl = useCallback(async (): Promise<void> => {
    const params = new URLSearchParams();
    params.set("project", JSON.stringify(editor.content));
    const url = `${window.location.origin}${window.location.pathname}#${params}`;
    window.history.replaceState(null, "", url);
    try {
      await window.navigator.clipboard?.writeText(url);
      setNotice("Copied project URL");
    } catch {
      setNotice("Project URL is in the address bar");
    }
  }, [editor.content]);

  const exportProject = useCallback(async (
    format: "svg" | "gltf" | "dxf" | "hpgl" | "pdf" | "png",
  ): Promise<void> => {
    const model = state.content.foldModel;
    if (!model) {
      setNotice("Import a fold model before exporting");
      return;
    }
    if (format === "gltf") {
      if (!sceneObject) {
        setNotice("Switch to the 3D view before exporting");
        return;
      }
      const exportObject = sceneObject.children.find(
        (child) => child.type === "Mesh",
      ) ?? sceneObject;
      const gltf = await toGLTF(exportObject);
      if (gltf instanceof ArrayBuffer) {
        downloadBlob(
          "packcad-model.glb",
          new Blob([gltf], { type: "model/gltf-binary" }),
        );
      } else {
        downloadText(
          "packcad-model.gltf",
          JSON.stringify(gltf, null, 2),
          "model/gltf+json",
        );
      }
      setNotice("Exported 3D model");
      return;
    }
    const drawing = foldModelToDrawing(model);
    if (format === "svg") {
      downloadText("packcad-dieline.svg", toSVG(drawing), "image/svg+xml");
    }
    if (format === "dxf") {
      downloadText("packcad-dieline.dxf", toDXF(drawing), "application/dxf");
    }
    if (format === "hpgl") {
      downloadText("packcad-dieline.hpgl", toHPGL(drawing));
    }
    if (format === "pdf") {
      const bytes = Uint8Array.from(toTiledPDF(drawing));
      downloadBlob(
        "packcad-dieline-tiled.pdf",
        new Blob([bytes], { type: "application/pdf" }),
      );
    }
    if (format === "png") {
      const blob = await toPNG(drawing);
      if (blob) downloadBlob("packcad-dieline.png", blob);
    }
    setNotice(`Exported ${format.toUpperCase()}`);
  }, [sceneObject, state.content.foldModel]);

  useEffect(() => {
    let cancelled = false;
    void documentStore.list().then(async (listed) => {
      if (cancelled) return;
      let restored = false;
      if (!routeProject) {
        const recent = listed[0];
        if (recent) {
          const snapshot = await documentStore.load(recent.id);
          if (cancelled) return;
          if (snapshot) {
            const normalized = projectFromUnknown(snapshot);
            await documentStore.save(recent.id, recent.name, normalized);
            replaceEditor(createProjectEditor(normalized, recent));
            setActiveDocument({ id: recent.id, name: recent.name });
            setRestoredDraftName(recent.name);
            restored = true;
          }
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
      setDrafts(await documentStore.list());
      if (!cancelled) setPersistenceReady(true);
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
    const flush = (): void => {
      void binding.flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      if (autosaveRef.current === binding) autosaveRef.current = null;
      binding.dispose();
    };
  }, [activeDocument.id, editor, persistenceReady, refreshDrafts]);

  useEffect(() => {
    if (!persistenceReady || autoplayEditorRef.current === editor) return;
    autoplayEditorRef.current = editor;
    foldingPlayback.play();
  }, [editor, foldingPlayback, persistenceReady]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveProjectFile();
        return;
      }
      if (editing) return;
      if (event.key === "2") applyViewLayout("single-2d");
      if (event.key === "3") applyViewLayout("single-3d");
      if (event.key === "Escape") {
        setOpenMenu(null);
        setPreferencesOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [applyViewLayout, editor, saveProjectFile]);

  useEffect(() => {
    const model = state.content.foldModel;
    if (!model) {
      setFoldStatus({ status: "idle" });
      return;
    }
    let cancelled = false;
    let activeHost: Awaited<ReturnType<typeof createFoldStatusHost>> | null = null;
    setFoldStatus({ status: "solving" });
    void createFoldStatusHost(model).then(async (host) => {
      activeHost = host;
      if (cancelled) {
        host.dispose();
        return;
      }
      const summary = await host.solve("summary");
      if (!cancelled) setFoldStatus({ status: "ready", summary });
    }).catch((error: unknown) => {
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

  const pauseAndExecute = useCallback((
    command: string,
    params?: unknown,
  ): void => {
    foldingPlayback.pause();
    state.execute(command, params);
  }, [foldingPlayback, state]);

  const selectStep = useCallback((stepId: string): void => {
    foldingPlayback.seek(stepId);
    const stepIndex = state.content.foldingSteps.findIndex((step) => step.id === stepId);
    const setupFace = state.content.foldModel?.fixedFaceIndex;
    setSelectedFaceIndex(
      stepIndex === 0 && setupFace !== undefined ? setupFace : null,
    );
    setSelectedFoldEdgeIndex(null);
    setHoveredFoldEdgeIndex(null);
    state.execute("fold.selectStep", { stepId });
  }, [foldingPlayback, state]);

  const setFoldAngle = useCallback((angle: number): void => {
    foldingPlayback.pause();
    if (state.content.activeStepId !== foldingPlayback.frame.activeStepId) {
      state.execute("fold.selectStep", {
        stepId: foldingPlayback.frame.activeStepId,
      });
    }
    state.execute("fold.setAngle", { angle });
  }, [foldingPlayback, state]);

  if (!persistenceReady) {
    return (
      <main className="app-loading" aria-live="polite">
        <img className="brand-logo" src={packCadLogo} alt="PackCAD logo" />
        <strong>Restoring local drafts…</strong>
      </main>
    );
  }

  const displayedProject = foldingPlayback.displayedProject;

  return (
    <div
      className={
        sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"
      }
      data-app="packcad-editable"
      onClick={() => setOpenMenu(null)}
      onDragEnter={handleProjectDragEnter}
      onDragOver={handleProjectDragOver}
      onDragLeave={handleProjectDragLeave}
      onDrop={handleProjectDrop}
    >
      <SourceSidebar
        project={state.content}
        preferences={preferences}
        frame={foldingPlayback.frame}
        playing={foldingPlayback.player.playing}
        foldStatus={foldStatus}
        drafts={drafts}
        activeDocumentId={activeDocument.id}
        samples={packCadSampleLibrary}
        openSection={openSection}
        onSetOpenSection={setOpenSection}
        onLoadSample={(sampleId) => void loadSample(sampleId)}
        onImport={(file) => void importDielineFile(file)}
        onSelectMaterialSpec={selectMaterialSpec}
        onSetThickness={(thicknessMm) =>
          state.execute("material.setThickness", { thicknessMm })}
        onSetArtwork={(side, dataUrl, fileName) => {
          state.execute("artwork.setPlacement", side === "front"
            ? { imageDataUrl: dataUrl, imageName: fileName }
            : { backImageDataUrl: dataUrl, backImageName: fileName });
        }}
        onFlipArtwork={() => state.execute("artwork.setPlacement", {
          imageDataUrl: state.content.artwork.backImageDataUrl ?? null,
          imageName: state.content.artwork.backImageName ?? null,
          backImageDataUrl: state.content.artwork.imageDataUrl ?? null,
          backImageName: state.content.artwork.imageName ?? null,
        })}
        onSetArtworkColor={(artworkColor) =>
          state.execute("artwork.setColor", { artworkColor })}
        onUpdatePreferences={updatePreferencesAndProject}
        onSaveDraft={() => void saveDraft()}
        onOpenDraft={(draft) => void openDraft(draft)}
        onDeleteDraft={(draft) => void deleteDraft(draft)}
        onTogglePlayback={
          foldingPlayback.player.playing
            ? foldingPlayback.pause
            : foldingPlayback.play
        }
        onResetFold={() => {
          pauseAndExecute("fold.reset");
          setNotice("Reset folding simulation");
        }}
        onSelectStep={selectStep}
        onAddKeyframe={() => {
          pauseAndExecute(
            state.content.design
              ? "pipeline.addOrigamiKeyframe"
              : "fold.appendStep",
          );
          setNotice("Added folding keyframe");
        }}
      />

      <main className="workspace">
        {projectDragActive ? (
          <div className="project-drop-overlay" aria-hidden="true">
            <div className="project-drop-card">
              <Icon name="file-up" size={32} />
              <strong>Drop to open in PackCAD</strong>
              <span>PackCAD JSON project</span>
            </div>
          </div>
        ) : null}
        <Topbar
          openMenu={openMenu}
          sidebarCollapsed={sidebarCollapsed}
          inspectorOpen={inspectorOpen}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          undoLabel={state.undoLabel}
          redoLabel={state.redoLabel}
          saveState={saveState}
          drafts={drafts}
          activeDocumentId={activeDocument.id}
          preferences={preferences}
          projection={state.content.projection}
          onSetOpenMenu={setOpenMenu}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          onOpenPreferences={() => {
            setOpenMenu(null);
            setPreferencesOpen(true);
          }}
          onToggleInspector={() => setInspectorOpen((current) => !current)}
          onNewProject={() => void startFresh()}
          onOpenSampleLibrary={() => {
            setSidebarCollapsed(false);
            setOpenSection("samples");
            setNotice("Opened sample library");
          }}
          onOpenProject={() => projectInputRef.current?.click()}
          onImportDieline={() => menuDielineInputRef.current?.click()}
          onSaveProject={saveProjectFile}
          onSaveDraft={() => void saveAs()}
          onCopyProjectUrl={() => void copyProjectUrl()}
          onOpenDraft={(draft) => void openDraft(draft)}
          onDeleteDraft={(draft) => void deleteDraft(draft)}
          onExport={(format) => void exportProject(format)}
          onUndo={state.undo}
          onRedo={state.redo}
          onSetViewLayout={applyViewLayout}
          onUpdatePreferences={updatePreferences}
          onSetProjection={(projection) => {
            state.execute("view.setProjection", { projection });
            updatePreferences({ cameraType: projection });
          }}
        />
        <input
          ref={projectInputRef}
          className="hidden-file"
          type="file"
          accept=".json,.packcad.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void openProjectFile(file);
          }}
        />
        <input
          ref={menuDielineInputRef}
          className="hidden-file"
          type="file"
          accept=".svg,.dxf,.txt,.json"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importDielineFile(file);
          }}
        />

        <ViewportWorkspace
          project={displayedProject}
          foldPlayback={foldingPlayback.player}
          settlement={sharedSettlement.data}
          preferences={preferences}
          fitNonce={fitNonce}
          notice={notice}
          selectedFaceIndex={selectedFaceIndex}
          selectedFoldEdgeIndex={selectedFoldEdgeIndex}
          hoveredFoldEdgeIndex={hoveredFoldEdgeIndex}
          onSelectFace={(faceIndex) => {
            setSelectedFaceIndex(faceIndex);
            if (faceIndex !== null) setSelectedFoldEdgeIndex(null);
          }}
          onSelectFoldEdge={(edgeIndex) => {
            setSelectedFoldEdgeIndex(edgeIndex);
            if (edgeIndex !== null) setSelectedFaceIndex(null);
          }}
          onHoverFoldEdge={setHoveredFoldEdgeIndex}
          onSceneObject={setSceneObject}
          onSetViewLayout={applyViewLayout}
          onFit={() => {
            setFitNonce((current) => current + 1);
            setNotice("Framed view");
          }}
          onToggleGridAxes={() => {
            const next = !(preferences.groundPlane || preferences.origin);
            updatePreferences({ groundPlane: next, origin: next });
            state.execute("view.setHelpers", { showHelpers: next });
            setNotice(next ? "Showed grid + axes" : "Hid grid + axes");
          }}
          onToggleShading={() => {
            const renderMode = state.content.renderMode === "solid"
              ? "technical"
              : "solid";
            state.execute("view.setRenderMode", { renderMode });
            setNotice("Toggled shading");
          }}
          onResetCamera={() => {
            state.execute("view.setCamera", { cameraPreset: "isometric" });
            setFitNonce((current) => current + 1);
            setNotice("Reset camera");
          }}
        />

        <Inspector
          open={inspectorOpen}
          project={displayedProject}
          displayedActiveStepId={foldingPlayback.frame.activeStepId}
          selectedFaceIndex={selectedFaceIndex}
          selectedFoldEdgeIndex={selectedFoldEdgeIndex}
          foldDiagnostics={sharedSettlement.diagnostics}
          foldStatus={foldStatus}
          preferences={preferences}
          onSetFixedPanel={(panelId: PanelId | null) =>
            state.execute("fold.setFixedPanel", { panelId })}
          onRenameOperation={(operationId, name) =>
            pauseAndExecute("pipeline.renameOperation", { operationId, name })}
          onSetTargetAngle={(operationId, angleDegrees, groupIndex) =>
            pauseAndExecute("pipeline.setTargetAngle", {
              operationId,
              angleDegrees,
              groupIndex,
            })}
          onSetEnforcePrior={(operationId, value) =>
            pauseAndExecute("pipeline.enforcePrior", { operationId, value })}
          onToggleLockedFace={(operationId, faceId) =>
            pauseAndExecute("pipeline.toggleLockedFace", {
              operationId,
              faceId,
            })}
          onSetCreaseAngle={(operationId, edgeId, angleDegrees) =>
            pauseAndExecute("pipeline.setCreaseAngle", {
              operationId,
              edgeId,
              angleDegrees,
            })}
          onSetCamera={(cameraPreset) =>
            state.execute("view.setCamera", { cameraPreset })}
          onSetHelpers={(showHelpers) =>
            state.execute("view.setHelpers", { showHelpers })}
          onSelectMaterial={(material) =>
            state.execute("material.select", { material })}
          onSelectMaterialSpec={selectMaterialSpec}
          onSetThickness={(thicknessMm) =>
            state.execute("material.setThickness", { thicknessMm })}
          onSetFoldAngle={setFoldAngle}
          onSetArtworkColor={(artworkColor) =>
            state.execute("artwork.setColor", { artworkColor })}
          onSetArtworkPlacement={(placement) =>
            state.execute("artwork.setPlacement", placement)}
          onResetArtworkPlacement={() =>
            state.execute("artwork.resetPlacement")}
          onToggleOperation={(operationId) =>
            pauseAndExecute("pipeline.toggleOperation", { operationId })}
          onMoveOperation={(operationId, direction) =>
            pauseAndExecute("pipeline.moveOperation", {
              operationId,
              direction,
            })}
          onToggleModifier={(modifierKey) =>
            pauseAndExecute("pipeline.toggleModifier", { modifierKey })}
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
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : null}
        {importNotice ? (
          <div
            className={`import-notice ${importNotice.kind}`}
            role={importNotice.kind === "error" ? "alert" : "status"}
          >
            <span>{importNotice.message}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setImportNotice(null)}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ) : null}
        {mobileNoticeVisible ? (
          <div className="mobile-screen-notice" role="status">
            <Icon name="monitor" size={20} />
            <span>
              PackCAD Mockup works on any device, but is optimized for larger
              screens.
            </span>
            <button
              type="button"
              aria-label="Dismiss screen-size notice"
              onClick={() => setMobileNoticeVisible(false)}
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        ) : null}

        <PreferencesDialog
          open={preferencesOpen}
          project={state.content}
          preferences={preferences}
          onClose={() => setPreferencesOpen(false)}
          onRestoreDefaults={() => {
            setPreferences(defaultUiPreferences);
            window.localStorage.setItem(
              UI_PREFERENCES_STORAGE_KEY,
              JSON.stringify(defaultUiPreferences),
            );
            state.execute("view.setProjection", {
              projection: defaultUiPreferences.cameraType,
            });
            setNotice("Restored preference defaults");
          }}
          onUpdate={updatePreferencesAndProject}
          onSetViewLayout={applyViewLayout}
          onSelectMaterialSpec={selectMaterialSpec}
          onSetThickness={(thicknessMm) =>
            state.execute("material.setThickness", { thicknessMm })}
          onResetCamera={() => {
            state.execute("view.setCamera", { cameraPreset: "isometric" });
            setFitNonce((current) => current + 1);
          }}
        />
      </main>
    </div>
  );
}
