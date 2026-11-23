// PackCAD as a viewer: one project, folded and played, with none of the editor around it.
//
// This is the same viewport, fold player and settlement worker the editor uses (ViewportWorkspace,
// useFoldingPlayback, useFoldSettlement), composed without the document store, inspector, menus or
// sidebar. It is built as its own page (viewer.html) so another site can show a PackCAD project in
// an iframe without carrying the editor, and without sharing its React or three.js versions with
// the host. embedProtocol.ts is the whole contract: the address says what to open, and window
// messages drive playback and report it back.

import type { PackagingProject } from "@packcad/format";
import type { Object3D } from "three";
import type { Viewport } from "@atelier/viewport";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../components/Icon";
import { ViewportWorkspace } from "../components/ViewportWorkspace";
import { useFoldingPlayback } from "../model/foldingPlayback";
import { projectFromFile } from "../model/projectFileImport";
import {
  defaultUiPreferences,
  preferencesForLoadedProject,
  type UiPreferences,
  type ViewLayout,
} from "../model/uiPreferences";
import { useFoldSettlement } from "../render/useFoldSettlement";
import { useFoldCamera } from "./useFoldCamera";
import {
  DEFAULT_BACKGROUND,
  layoutFor,
  parseViewerCommand,
  resolveStepId,
  type ViewerCamera,
  type ViewerEvent,
  type ViewerOptions,
  type ViewerTheme,
} from "./embedProtocol";

/** How long a looping display holds the finished model before folding it again. */
const LOOP_HOLD_MS = 2500;
/** Announce the project anyway if its print has not loaded by then (a texture that fails). */
const DRAWN_TIMEOUT_MS = 4000;
/** At most this often, playback progress is reported to the host. */
const STATE_INTERVAL_MS = 100;

const post = (event: ViewerEvent): void => {
  if (window.parent !== window) window.parent.postMessage(event, "*");
};

async function fetchProject(url: string): Promise<PackagingProject> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url} (${response.status}).`);
  const blob = await response.blob();
  const name = decodeURIComponent(new URL(url, window.location.href).pathname.split("/").pop() ?? "project");
  return projectFromFile(new File([blob], name, { type: blob.type }));
}

type Loaded = { project: PackagingProject; autoplay: boolean; step: string | number };

export function ViewerApp({ options }: { options: ViewerOptions }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<ViewLayout>(options.layout);
  const [background, setBackground] = useState(options.background);
  const [theme, setTheme] = useState<ViewerTheme>(options.theme);

  // The page's own colours (viewer.css) follow the theme; the viewport's ground
  // is the host's colour when it gave one, else the theme's.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  const ground = background ?? DEFAULT_BACKGROUND[theme];

  const load = useCallback((url: string, step: string | number, autoplay: boolean): void => {
    setError(null);
    fetchProject(url)
      .then((project) => setLoaded({ project, autoplay, step }))
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        post({ type: "packcad:error", message });
      });
  }, []);

  useEffect(() => {
    if (options.projectUrl) load(options.projectUrl, options.step, options.autoplay);
    else setError("No project was given. Open viewer.html?project=<url of a .packcad.json or .packcad.pdf>.");
  }, [load, options]);

  // Commands that do not need a project are handled here; the rest by the loaded viewer.
  useEffect(() => {
    const listen = (event: MessageEvent): void => {
      if (event.source !== window.parent) return;
      const command = parseViewerCommand(event.data);
      if (command?.type === "packcad:load") load(command.url, command.step ?? "final", command.autoplay ?? false);
      if (command?.type === "packcad:layout") setLayout(layoutFor(command.layout));
      if (command?.type === "packcad:background") setBackground(command.color);
      if (command?.type === "packcad:theme") setTheme(command.theme);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [load]);

  const groundStyle = { "--viewer-ground": ground } as CSSProperties;
  if (error) return <div className="viewer-message" role="alert" style={groundStyle}>{error}</div>;
  if (!loaded) return <div className="viewer-message" role="status" style={groundStyle}>Opening the project…</div>;
  return (
    <LoadedViewer
      key={loaded.project.design?.id ?? loaded.project.dieline?.name ?? "project"}
      loaded={loaded}
      layout={layout}
      onLayout={setLayout}
      background={ground}
      controls={options.controls}
      loop={options.loop}
      speed={options.speed}
      camera={options.camera}
    />
  );
}

function LoadedViewer({
  loaded,
  layout,
  onLayout,
  background,
  controls,
  loop,
  speed,
  camera,
}: {
  loaded: Loaded;
  layout: ViewLayout;
  onLayout: (layout: ViewLayout) => void;
  background: string;
  controls: boolean;
  loop: boolean;
  speed: number;
  camera: ViewerCamera;
}) {
  // A project that will fold at once opens on its flat sheet, so what is drawn first is where the
  // folding starts, framed for it, rather than the finished model the folding then replaces.
  const [project, setProject] = useState<PackagingProject>(() => ({
    ...loaded.project,
    activeStepId: resolveStepId(
      loaded.project.foldingSteps,
      loaded.autoplay ? "setup" : loaded.step,
      loaded.project.activeStepId,
    ),
  }));
  const playback = useFoldingPlayback(project, { speed });
  const settlement = useFoldSettlement(playback.displayedProject, playback.player);
  const [fitNonce, setFitNonce] = useState(0);
  const [, setSceneObject] = useState<Object3D | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [selectedFaceIndex, setSelectedFaceIndex] = useState<number | null>(null);
  const [selectedFoldEdgeIndex, setSelectedFoldEdgeIndex] = useState<number | null>(null);
  const [hoveredFoldEdgeIndex, setHoveredFoldEdgeIndex] = useState<number | null>(null);
  const [helpers, setHelpers] = useState(false);

  const preferences: UiPreferences = useMemo(() => ({
    ...preferencesForLoadedProject(project, defaultUiPreferences),
    viewLayout: layout,
    groundPlane: helpers,
    origin: helpers,
    backgroundColor: background,
  }), [background, helpers, layout, project]);

  const steps = project.foldingSteps;
  // The flat sheet (2D) never moves its camera; the 3D pane follows the folding when asked to.
  useFoldCamera({
    viewport,
    model: project.foldModel,
    steps,
    player: playback.player,
    enabled: camera === "follow" && layout !== "single-2d",
  });
  const { play, pause, seek } = playback;
  const seekTo = useCallback((request: string | number): void => {
    seek(resolveStepId(steps, request, steps[steps.length - 1]?.id ?? ""));
  }, [seek, steps]);

  // Announce the project once it is drawn with its print, then play it if asked: before that the
  // viewport is blank or bare board, and a host showing its own loading state would uncover that,
  // and the folding would start out of sight.
  const [drawn, setDrawn] = useState(false);
  const markDrawn = useCallback(() => setDrawn(true), []);
  useEffect(() => {
    const timer = window.setTimeout(markDrawn, DRAWN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [markDrawn]);
  const announced = useRef(false);
  useEffect(() => {
    if (!drawn || announced.current) return;
    announced.current = true;
    post({
      type: "packcad:ready",
      name: project.design?.name ?? null,
      steps: steps.map(({ id, label, angle }) => ({ id, label, angle })),
      panels: project.foldModel?.facesVertices.length ?? 0,
    });
    if (loaded.autoplay) play();
    // Only once: a later edit to the shading or camera is not a new project.
  }, [drawn, loaded.autoplay, play, project, steps]);

  // Playback commands from the host.
  useEffect(() => {
    const listen = (event: MessageEvent): void => {
      if (event.source !== window.parent) return;
      const command = parseViewerCommand(event.data);
      if (command?.type === "packcad:play") play();
      if (command?.type === "packcad:pause") pause();
      if (command?.type === "packcad:seek") seekTo(command.step);
      if (command?.type === "packcad:fit") setFitNonce((n) => n + 1);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [pause, play, seekTo]);

  // Report where playback is: at once when the stage or play state changes, otherwise throttled.
  const { frame, player } = playback;
  const lastReport = useRef({ at: 0, key: "" });
  useEffect(() => {
    const key = `${player.playing}:${frame.activeStepId}`;
    const now = performance.now();
    if (key === lastReport.current.key && now - lastReport.current.at < STATE_INTERVAL_MS) return;
    lastReport.current = { at: now, key };
    post({
      type: "packcad:state",
      playing: player.playing,
      stepId: frame.activeStepId,
      stepIndex: frame.stepIndex,
      progress: playback.progress,
    });
  }, [frame.activeStepId, frame.stepIndex, playback.progress, player.playing]);

  // A looping display folds, holds the finished model, and folds again.
  useEffect(() => {
    if (!loop || player.playing || !player.finished) return undefined;
    const timer = window.setTimeout(play, LOOP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [loop, play, player.finished, player.playing]);

  const stepIndex = Math.max(0, steps.findIndex((step) => step.id === frame.activeStepId));
  const step = steps[stepIndex];

  return (
    <div
      className="viewer"
      data-controls={controls || undefined}
      style={{ "--viewer-ground": background } as CSSProperties}
    >
      <ViewportWorkspace
        project={playback.displayedProject}
        foldPlayback={player}
        settlement={settlement.data}
        preferences={preferences}
        fitNonce={fitNonce}
        notice=""
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
        onViewport={setViewport}
        onDrawn={markDrawn}
        onSetViewLayout={onLayout}
        onFit={() => setFitNonce((n) => n + 1)}
        onToggleGridAxes={() => setHelpers((shown) => !shown)}
        onToggleShading={() => setProject((current) => ({
          ...current,
          renderMode: current.renderMode === "solid" ? "technical" : "solid",
        }))}
        onResetCamera={() => {
          setProject((current) => ({ ...current, cameraPreset: "isometric" }));
          setFitNonce((n) => n + 1);
        }}
      />
      {controls && steps.length > 1 && (
        <div className="viewer-transport" role="toolbar" aria-label="Folding">
          <button
            type="button"
            className="icon-button"
            aria-label={player.playing ? "Pause folding" : "Play folding"}
            title={player.playing ? "Pause" : "Play the folding sequence"}
            onClick={player.playing ? pause : play}
          >
            <Icon name={player.playing ? "pause" : "play"} size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Previous stage"
            disabled={stepIndex === 0}
            onClick={() => { pause(); seekTo(stepIndex - 1); }}
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <input
            type="range"
            className="viewer-steps"
            min={0}
            max={steps.length - 1}
            value={stepIndex}
            aria-label="Folding stage"
            aria-valuetext={step?.label}
            onChange={(event) => { pause(); seekTo(Number(event.target.value)); }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Next stage"
            disabled={stepIndex >= steps.length - 1}
            onClick={() => { pause(); seekTo(stepIndex + 1); }}
          >
            <Icon name="chevron-right" size={16} />
          </button>
          <span className="viewer-step-label" aria-live="polite">{step?.label}</span>
        </div>
      )}
    </div>
  );
}
