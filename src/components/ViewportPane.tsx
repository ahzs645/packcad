import {
  AxesHelper,
  BackSide,
  Box3,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Object3D,
  type Texture,
} from "three";
import { ViewportCanvas } from "@atelier/react";
import { SolveSuperseded } from "@atelier/sim";
import type { PickHit, Viewport } from "@atelier/viewport";
import type { FoldingPlayerState } from "@packcad/fold-solver";
import {
  materials,
  type CameraProjection,
  type CameraPreset,
  type PackagingProject,
  type RenderMode,
} from "@packcad/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { artworkImageSources } from "../model/artworkPlacement";
import {
  isSelectableCrease,
  sourceEdgeIndexFromPickSegment,
} from "../render/foldLineInteraction";
import { buildFoldScene, type FoldSceneData } from "../render/foldSceneBuilder";
import {
  HOVER_EDGE_COLOR,
  SELECTED_EDGE_COLOR,
} from "../render/edgeStyle";
import type {
  CachedFoldSettlement,
  FoldDiagnostics,
} from "../render/foldSettlement";
import {
  createFoldSettlementWorkerPlugin,
  FoldSettlementClient,
} from "../render/foldSettlementPlugin";

interface ViewportPaneProps {
  project: PackagingProject;
  foldPlayback: FoldingPlayerState;
  selectedFaceIndex: number | null;
  selectedFoldEdgeIndex: number | null;
  hoveredFoldEdgeIndex: number | null;
  onSelectFace: (faceIndex: number | null) => void;
  onSelectFoldEdge: (edgeIndex: number | null) => void;
  onHoverFoldEdge: (edgeIndex: number | null) => void;
  onSceneObject: (object: Object3D | null) => void;
  onFoldDiagnostics: (diagnostics: FoldDiagnostics) => void;
  onSetRenderMode: (renderMode: RenderMode) => void;
  onSetCamera: (cameraPreset: CameraPreset) => void;
  onSetProjection: (projection: CameraProjection) => void;
  onSetHelpers: (showHelpers: boolean) => void;
}

type ActiveSettlement = {
  model: NonNullable<PackagingProject["foldModel"]>;
  cacheKey: string;
  data: CachedFoldSettlement;
};

function disposeSceneData(data: FoldSceneData): void {
  data.geometry.dispose();
  data.lockedTintGeometry?.dispose();
  data.selectedTintGeometry?.dispose();
  data.solidEdgeGeometry.dispose();
  data.dashedEdgeGeometry.dispose();
  data.edgePickGeometry.dispose();
}

function configureArtworkTexture(texture: Texture): Texture {
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Faithful port of packager/FoldScene.tsx's ArtworkPlacement texture transform.
 * The projection-dependent mirror is deliberately supplied by the caller.
 */
function applyArtworkPlacement(
  texture: Texture,
  artwork: PackagingProject["artwork"],
  mirror: boolean,
): void {
  const scale = Math.max(0.0001, artwork.scale);
  texture.center.set(0.5, 0.5);
  texture.rotation = (artwork.rotation * Math.PI) / 180;
  texture.repeat.set((mirror ? -1 : 1) / scale, 1 / scale);
  texture.offset.set(-artwork.x / scale, -artwork.y / scale);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
}

function replaceOverlayGeometry(
  line: LineSegments,
  positions: Float32Array | undefined,
): void {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(positions ?? new Float32Array(), 3),
  );
  line.geometry.dispose();
  line.geometry = geometry;
}

export function ViewportPane({
  project,
  foldPlayback,
  selectedFaceIndex,
  selectedFoldEdgeIndex,
  hoveredFoldEdgeIndex,
  onSelectFace,
  onSelectFoldEdge,
  onHoverFoldEdge,
  onSceneObject,
  onFoldDiagnostics,
  onSetRenderMode,
  onSetCamera,
  onSetProjection,
  onSetHelpers,
}: ViewportPaneProps) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [settlement, setSettlement] = useState<ActiveSettlement | null>(null);
  const [materialTexture, setMaterialTexture] = useState<Texture | null>(null);
  const [frontArtworkTexture, setFrontArtworkTexture] = useState<Texture | null>(null);
  const [backArtworkTexture, setBackArtworkTexture] = useState<Texture | null>(null);
  const sceneDataRef = useRef<FoldSceneData | null>(null);
  const sceneObjectRef = useRef<Object3D | null>(null);
  const hoverLineRef = useRef<LineSegments | null>(null);
  const selectedLineRef = useRef<LineSegments | null>(null);
  const autoFitRef = useRef<{
    model: PackagingProject["foldModel"];
    viewMode: PackagingProject["viewMode"];
  } | null>(null);
  const settlementClientRef = useRef<FoldSettlementClient | null>(null);
  const onSelectFaceRef = useRef(onSelectFace);
  onSelectFaceRef.current = onSelectFace;
  const onSelectFoldEdgeRef = useRef(onSelectFoldEdge);
  onSelectFoldEdgeRef.current = onSelectFoldEdge;
  const onHoverFoldEdgeRef = useRef(onHoverFoldEdge);
  onHoverFoldEdgeRef.current = onHoverFoldEdge;

  const handleReady = useCallback((readyViewport: Viewport): void => {
    setViewport(readyViewport);
  }, []);

  const fitToView = useCallback((): void => {
    if (!viewport || !sceneObjectRef.current) return;
    viewport.camera.fit(
      new Box3().setFromObject(sceneObjectRef.current),
      project.viewMode === "2d" ? 1.08 : 1.35,
    );
    viewport.invalidate();
  }, [project.viewMode, viewport]);

  useEffect(() => {
    const client = new FoldSettlementClient(
      createFoldSettlementWorkerPlugin(),
    );
    settlementClientRef.current = client;
    return () => {
      settlementClientRef.current = null;
      client.dispose();
    };
  }, []);

  const model = project.foldModel;
  const foldStepIndex = Math.max(
    0,
    project.foldingSteps.findIndex((step) => step.id === project.activeStepId),
  );
  const activeStep = project.foldingSteps[foldStepIndex];
  const foldAngle = activeStep?.angle ?? 0;
  const settlementKey = `${foldStepIndex}:${foldAngle}`;
  const activeSettlement =
    settlement && settlement.model === model && settlement.cacheKey === settlementKey
      ? settlement.data
      : null;

  useEffect(() => {
    const client = settlementClientRef.current;
    if (!client) return;
    if (!model) {
      client.cancel();
      setSettlement(null);
      return;
    }
    if (foldPlayback.positions) {
      client.cancel();
      setSettlement(null);
      onFoldDiagnostics({
        status: "settled",
        maxEdgeError: foldPlayback.solverMaxEdgeError,
        maxAngleErrorDeg: foldPlayback.solverMaxAngleErrorDeg,
        converged: foldPlayback.solverIsSolved,
      });
      return;
    }
    const cacheKey = settlementKey;
    let cancelled = false;
    setSettlement(null);
    onFoldDiagnostics({ status: "settling" });
    void client.solve(model, { foldStepIndex, foldAngle }).then((next) => {
      if (cancelled) return;
      setSettlement({ model, cacheKey, data: next });
      onFoldDiagnostics({
        status: "settled",
        maxEdgeError: next.maxEdgeError,
        maxAngleErrorDeg: next.maxAngleErrorDeg,
        converged: next.converged,
      });
    }).catch((error: unknown) => {
      if (cancelled || error instanceof SolveSuperseded) return;
      setSettlement(null);
      onFoldDiagnostics({
        status: "error",
        message: error instanceof Error
          ? error.message
          : "The settled fold solver failed.",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    foldAngle,
    foldPlayback.positions,
    foldPlayback.solverIsSolved,
    foldPlayback.solverMaxAngleErrorDeg,
    foldPlayback.solverMaxEdgeError,
    foldStepIndex,
    model,
    onFoldDiagnostics,
    settlementKey,
  ]);

  useEffect(() => {
    if (!viewport) return;
    const definition = materials[project.material];
    let cancelled = false;
    setMaterialTexture(null);
    const texture = new TextureLoader().load(definition.texture, () => {
      if (!cancelled) {
        setMaterialTexture(texture);
        viewport.invalidate();
      }
    });
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
    return () => {
      cancelled = true;
      texture.dispose();
    };
  }, [project.material, viewport]);

  const artworkSources = artworkImageSources(project);
  useEffect(() => {
    if (!viewport || !artworkSources.front) {
      setFrontArtworkTexture(null);
      return;
    }
    let cancelled = false;
    setFrontArtworkTexture(null);
    const texture = new TextureLoader().load(artworkSources.front, () => {
      if (!cancelled) {
        setFrontArtworkTexture(texture);
        viewport.invalidate();
      }
    });
    configureArtworkTexture(texture);
    return () => {
      cancelled = true;
      texture.dispose();
    };
  }, [artworkSources.front, viewport]);

  useEffect(() => {
    if (!viewport || !artworkSources.back) {
      setBackArtworkTexture(null);
      return;
    }
    let cancelled = false;
    setBackArtworkTexture(null);
    const texture = new TextureLoader().load(artworkSources.back, () => {
      if (!cancelled) {
        setBackArtworkTexture(texture);
        viewport.invalidate();
      }
    });
    configureArtworkTexture(texture);
    return () => {
      cancelled = true;
      texture.dispose();
    };
  }, [artworkSources.back, viewport]);

  useEffect(() => {
    if (!viewport) return;
    const showSceneHelpers = project.showHelpers && project.viewMode === "3d";
    viewport.lighting.setGround(showSceneHelpers
      ? { grid: true, shadowCatcher: true, size: 8 }
      : null);
    if (!showSceneHelpers) return;
    const axes = new AxesHelper(0.75);
    axes.position.set(-2, 0.002, -2);
    viewport.scene.add(axes);
    viewport.invalidate();
    return () => {
      viewport.scene.remove(axes);
      axes.dispose();
      viewport.invalidate();
    };
  }, [project.showHelpers, project.viewMode, viewport]);

  useEffect(() => {
    if (!viewport) return;
    viewport.lighting.setPreset(
      project.renderMode === "technical" ? "technical" : "studio",
    );
    viewport.post.setEnabled(project.renderMode === "solid" && project.viewMode === "3d");
  }, [project.renderMode, project.viewMode, viewport]);

  useEffect(() => {
    if (!viewport) return;
    viewport.camera.setKind(
      project.viewMode === "2d" ? "orthographic" : project.projection,
    );
    fitToView();
  }, [fitToView, project.projection, project.viewMode, viewport]);

  useEffect(() => {
    if (!viewport) return;
    viewport.camera.setView(project.viewMode === "2d" ? "top" : project.cameraPreset);
    fitToView();
  }, [fitToView, project.cameraPreset, project.viewMode, viewport]);

  useEffect(() => {
    if (!viewport) return;
    const offHover = viewport.picking.onHover((hit: PickHit | null) => {
      const data = sceneDataRef.current;
      if (!data || hit?.id !== "fold-edges") {
        onHoverFoldEdgeRef.current(null);
        return;
      }
      const edgeIndex = sourceEdgeIndexFromPickSegment(
        data.segmentEdgeIndex,
        hit.edgeIndex,
      );
      onHoverFoldEdgeRef.current(
        edgeIndex !== null && model && isSelectableCrease(model, edgeIndex)
          ? edgeIndex
          : null,
      );
    });
    const offPick = viewport.picking.onPick((hit: PickHit | null) => {
      const data = sceneDataRef.current;
      if (data && hit?.id === "fold-edges") {
        const edgeIndex = sourceEdgeIndexFromPickSegment(
          data.segmentEdgeIndex,
          hit.edgeIndex,
        );
        if (edgeIndex !== null && model && isSelectableCrease(model, edgeIndex)) {
          onSelectFoldEdgeRef.current(edgeIndex);
          return;
        }
      }
      const triangleIndex = hit?.faceIndex;
      if (!data || hit?.id !== "fold-shell" || triangleIndex === undefined) {
        onSelectFaceRef.current(null);
        onSelectFoldEdgeRef.current(null);
        return;
      }
      const sourceFace = data.faceIndexByTriangle[triangleIndex] ?? -1;
      onSelectFaceRef.current(sourceFace >= 0 ? sourceFace : null);
      onSelectFoldEdgeRef.current(null);
    });
    return () => {
      offHover();
      offPick();
    };
  }, [model, viewport]);

  useEffect(() => {
    if (!viewport || !model) {
      onSceneObject(null);
      return;
    }
    const data = buildFoldScene({
      model,
      projection: project.viewMode === "2d" ? "flat-2d" : "folded-3d",
      foldStepIndex,
      foldAngle,
      thicknessMm: project.thicknessMm,
      panelColorMode: frontArtworkTexture ? "artwork" : "material",
      edgeColorMode: project.renderMode === "technical" ? "black" : "mountain-valley",
      selectedFaceIndex,
      foldPositions: foldPlayback.positions ?? activeSettlement?.positions,
      foldMaxEdgeError: foldPlayback.positions
        ? foldPlayback.solverMaxEdgeError
        : activeSettlement?.maxEdgeError,
      foldMaxAngleErrorDeg: foldPlayback.positions
        ? foldPlayback.solverMaxAngleErrorDeg
        : activeSettlement?.maxAngleErrorDeg,
    });
    sceneDataRef.current = data;

    const materialDefinition = materials[project.material];
    const technical = project.renderMode === "technical";
    // Keep the legacy handedness split exactly: flat-2D mirrors the front atlas,
    // folded-3D does not; the BackSide rasterization supplies the reverse-face
    // flip, so its texture is never pre-mirrored.
    const placedFrontArtworkTexture = frontArtworkTexture
      ? configureArtworkTexture(frontArtworkTexture.clone())
      : null;
    const rawBackArtworkTexture = backArtworkTexture ?? frontArtworkTexture;
    const placedBackArtworkTexture = rawBackArtworkTexture
      ? configureArtworkTexture(rawBackArtworkTexture.clone())
      : null;
    if (placedFrontArtworkTexture) {
      applyArtworkPlacement(
        placedFrontArtworkTexture,
        project.artwork,
        project.viewMode === "2d",
      );
    }
    if (placedBackArtworkTexture) {
      applyArtworkPlacement(placedBackArtworkTexture, project.artwork, false);
    }
    const frontMaterial = new MeshStandardMaterial({
      color: new Color(
        technical
          ? "#f1f1f1"
          : placedFrontArtworkTexture
            ? project.artworkColor
            : materialTexture ? "#ffffff" : materialDefinition.color,
      ),
      map: technical ? null : placedFrontArtworkTexture ?? materialTexture,
      roughness: technical ? 0.96 : materialDefinition.roughness,
      metalness: technical ? 0 : materialDefinition.metalness,
      vertexColors: !technical,
      wireframe: technical,
      side: technical || project.viewMode === "2d" ? DoubleSide : FrontSide,
    });
    const backMaterial = frontMaterial.clone();
    backMaterial.map = technical
      ? null
      : project.viewMode === "2d"
        ? placedFrontArtworkTexture ?? materialTexture
        : placedBackArtworkTexture ?? materialTexture;
    if (!technical) {
      if (!placedBackArtworkTexture) backMaterial.color.offsetHSL(0, -0.05, -0.08);
      backMaterial.side = project.viewMode === "2d" ? DoubleSide : BackSide;
    }
    const edgeMaterial = new MeshStandardMaterial({
      color: technical ? "#f1f1f1" : materialTexture ? "#ffffff" : "#87643e",
      map: technical ? null : materialTexture,
      roughness: technical ? 0.96 : 0.92,
      metalness: 0,
      wireframe: technical,
      side: technical ? DoubleSide : undefined,
    });
    const mesh = new Mesh(data.geometry, [frontMaterial, backMaterial, edgeMaterial]);
    mesh.castShadow = project.viewMode === "3d";
    mesh.receiveShadow = true;

    const solidMaterial = new LineBasicMaterial({ vertexColors: true });
    const dashedMaterial = new LineDashedMaterial({
      vertexColors: true,
      dashSize: 0.055,
      gapSize: 0.035,
    });
    const solidLines = new LineSegments(data.solidEdgeGeometry, solidMaterial);
    const dashedLines = new LineSegments(data.dashedEdgeGeometry, dashedMaterial);
    dashedLines.computeLineDistances();
    const edgePickMaterial = new LineBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false,
    });
    const edgePickLines = new LineSegments(data.edgePickGeometry, edgePickMaterial);
    edgePickLines.name = "Fold crease pick targets";
    const selectedLineMaterial = new LineBasicMaterial({
      color: SELECTED_EDGE_COLOR,
      depthTest: false,
    });
    const hoverLineMaterial = new LineBasicMaterial({
      color: HOVER_EDGE_COLOR,
      depthTest: false,
    });
    const selectedLine = new LineSegments(new BufferGeometry(), selectedLineMaterial);
    const hoverLine = new LineSegments(new BufferGeometry(), hoverLineMaterial);
    selectedLine.renderOrder = 19;
    hoverLine.renderOrder = 20;
    replaceOverlayGeometry(
      selectedLine,
      selectedFoldEdgeIndex === null
        ? undefined
        : data.positionsByEdge.get(selectedFoldEdgeIndex),
    );
    replaceOverlayGeometry(
      hoverLine,
      hoveredFoldEdgeIndex === null
        ? undefined
        : data.positionsByEdge.get(hoveredFoldEdgeIndex),
    );
    selectedLineRef.current = selectedLine;
    hoverLineRef.current = hoverLine;

    const group = new Group();
    group.name = "PackCAD folded package";
    group.add(
      mesh,
      solidLines,
      dashedLines,
      edgePickLines,
      selectedLine,
      hoverLine,
    );
    viewport.scene.add(group);
    sceneObjectRef.current = group;
    viewport.picking.register(mesh, "fold-shell", "face", ["face"]);
    viewport.picking.register(edgePickLines, "fold-edges", "crease", ["edge"]);
    const autoFit = autoFitRef.current;
    if (!autoFit || autoFit.model !== model || autoFit.viewMode !== project.viewMode) {
      autoFitRef.current = { model, viewMode: project.viewMode };
      viewport.camera.fit(
        new Box3().setFromObject(group),
        project.viewMode === "2d" ? 1.08 : 1.35,
      );
    }
    viewport.invalidate();
    onSceneObject(group);

    return () => {
      onSceneObject(null);
      if (sceneObjectRef.current === group) sceneObjectRef.current = null;
      if (selectedLineRef.current === selectedLine) selectedLineRef.current = null;
      if (hoverLineRef.current === hoverLine) hoverLineRef.current = null;
      viewport.picking.unregister(mesh);
      viewport.picking.unregister(edgePickLines);
      viewport.scene.remove(group);
      frontMaterial.dispose();
      backMaterial.dispose();
      edgeMaterial.dispose();
      placedFrontArtworkTexture?.dispose();
      placedBackArtworkTexture?.dispose();
      solidMaterial.dispose();
      dashedMaterial.dispose();
      edgePickMaterial.dispose();
      selectedLineMaterial.dispose();
      hoverLineMaterial.dispose();
      selectedLine.geometry.dispose();
      hoverLine.geometry.dispose();
      disposeSceneData(data);
      sceneDataRef.current = null;
      viewport.invalidate();
    };
  }, [
    activeSettlement,
    backArtworkTexture,
    foldAngle,
    foldPlayback.positions,
    foldPlayback.solverMaxAngleErrorDeg,
    foldPlayback.solverMaxEdgeError,
    foldStepIndex,
    frontArtworkTexture,
    materialTexture,
    model,
    onSceneObject,
    project.material,
    project.artwork,
    project.artworkColor,
    project.renderMode,
    project.thicknessMm,
    project.viewMode,
    selectedFaceIndex,
    viewport,
  ]);

  useEffect(() => {
    const data = sceneDataRef.current;
    const line = selectedLineRef.current;
    if (!data || !line) return;
    replaceOverlayGeometry(
      line,
      selectedFoldEdgeIndex === null
        ? undefined
        : data.positionsByEdge.get(selectedFoldEdgeIndex),
    );
    viewport?.invalidate();
  }, [selectedFoldEdgeIndex, viewport]);

  useEffect(() => {
    const data = sceneDataRef.current;
    const line = hoverLineRef.current;
    if (!data || !line) return;
    replaceOverlayGeometry(
      line,
      hoveredFoldEdgeIndex === null
        ? undefined
        : data.positionsByEdge.get(hoveredFoldEdgeIndex),
    );
    viewport?.invalidate();
  }, [hoveredFoldEdgeIndex, viewport]);

  return (
    <section className="viewport-pane" aria-label="Package viewport">
      <ViewportCanvas
        className="viewport-canvas"
        options={{
          projection: project.viewMode === "2d" ? "2d" : "3d",
          postProcessing: project.viewMode === "3d",
        }}
        onReady={handleReady}
      />
      <div className="view-controls" aria-label="View controls">
        <select
          aria-label="Render mode"
          value={project.renderMode}
          onChange={(event) => onSetRenderMode(event.currentTarget.value as RenderMode)}
        >
          <option value="solid">Solid</option>
          <option value="technical">Technical</option>
        </select>
        <div className="view-control-group" aria-label="Camera preset">
          {(["isometric", "front", "top"] as const).map((preset) => (
            <button
              type="button"
              className={project.cameraPreset === preset ? "active" : ""}
              onClick={() => onSetCamera(preset)}
              title={`${preset} camera`}
              key={preset}
            >
              {preset === "isometric" ? "Iso" : preset === "front" ? "Front" : "Top"}
            </button>
          ))}
        </div>
        <div className="view-control-group" aria-label="Camera projection">
          {(["orthographic", "perspective"] as const).map((kind) => (
            <button
              type="button"
              className={
                (project.viewMode === "2d" ? "orthographic" : project.projection) === kind
                  ? "active"
                  : ""
              }
              onClick={() => onSetProjection(kind)}
              disabled={project.viewMode === "2d"}
              title={`${kind} camera`}
              key={kind}
            >
              {kind === "orthographic" ? "Ortho" : "Persp"}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={project.showHelpers ? "active" : ""}
          onClick={() => onSetHelpers(!project.showHelpers)}
          aria-pressed={project.showHelpers}
        >
          Helpers
        </button>
        <button type="button" onClick={fitToView}>Fit</button>
      </div>
      <div className="viewport-hint">
        {project.viewMode === "3d"
          ? "Orbit · scroll to zoom · click a face or crease"
          : "Pan · scroll to zoom · click a face or crease"}
      </div>
    </section>
  );
}
