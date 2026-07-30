import {
  AxesHelper,
  Box3,
  BufferGeometry,
  ClampToEdgeWrapping,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  NoToneMapping,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Object3D,
  type Texture,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { ViewportCanvas } from "@atelier/react";
import type { PickHit, Viewport } from "@atelier/viewport";
import type {
  FoldingPlayerState,
  ThicknessOffsetDirection,
} from "@packcad/fold-solver";
import {
  materialCatalog,
  materials,
  type PackagingProject,
  type ViewMode,
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
import {
  createFoldSceneMaterials,
  FOLD_SCENE_POST_PROCESSING,
} from "../render/foldSceneMaterials";
import type {
  CachedFoldSettlement,
} from "../render/foldSettlement";
import type {
  EdgeColorMode,
  PanelColorMode,
} from "../render/foldViewSettings";

interface ViewportPaneProps {
  project: PackagingProject;
  viewMode: ViewMode;
  foldPlayback: FoldingPlayerState;
  settlement: CachedFoldSettlement | null;
  selectedFaceIndex: number | null;
  selectedFoldEdgeIndex: number | null;
  hoveredFoldEdgeIndex: number | null;
  onSelectFace: (faceIndex: number | null) => void;
  onSelectFoldEdge: (edgeIndex: number | null) => void;
  onHoverFoldEdge: (edgeIndex: number | null) => void;
  onSceneObject?: (object: Object3D | null) => void;
  panelColorMode?: PanelColorMode;
  edgeColorMode?: EdgeColorMode;
  showGroundPlane?: boolean;
  showOrigin?: boolean;
  showShadow?: boolean;
  backgroundColor?: string;
  compact?: boolean;
  interactive?: boolean;
  fitNonce?: number;
  thicknessOffsetDirection?: ThicknessOffsetDirection;
  fluteAngle?: number;
}

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

function createFatEdges(
  source: BufferGeometry,
  viewport: Viewport,
  options: {
    dashed?: boolean;
    linewidth: number;
    depthTest: boolean;
  },
): {
  line: LineSegments2;
  geometry: LineSegmentsGeometry;
  material: LineMaterial;
} {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(
    source.getAttribute("position").array as Float32Array,
  );
  geometry.setColors(
    source.getAttribute("color").array as Float32Array,
  );
  const material = new LineMaterial({
    vertexColors: true,
    linewidth: options.linewidth,
    worldUnits: false,
    dashed: options.dashed ?? false,
    dashSize: 0.05,
    gapSize: 0.03,
    depthTest: options.depthTest,
    depthWrite: false,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.resolution.set(
    Math.max(1, viewport.renderer.domElement.clientWidth),
    Math.max(1, viewport.renderer.domElement.clientHeight),
  );
  const line = new LineSegments2(geometry, material);
  if (options.dashed) line.computeLineDistances();
  line.renderOrder = 3;
  return { line, geometry, material };
}

export function ViewportPane({
  project,
  viewMode,
  foldPlayback,
  settlement,
  selectedFaceIndex,
  selectedFoldEdgeIndex,
  hoveredFoldEdgeIndex,
  onSelectFace,
  onSelectFoldEdge,
  onHoverFoldEdge,
  onSceneObject,
  panelColorMode = "artwork",
  edgeColorMode = "mountain-valley",
  showGroundPlane = project.showHelpers,
  showOrigin = project.showHelpers,
  showShadow = true,
  backgroundColor = viewMode === "2d" ? "#f2f2f3" : "#ffffff",
  compact = false,
  interactive = true,
  fitNonce = 0,
  thicknessOffsetDirection,
  fluteAngle = 0,
}: ViewportPaneProps) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
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
  const onSelectFaceRef = useRef(onSelectFace);
  onSelectFaceRef.current = onSelectFace;
  const onSelectFoldEdgeRef = useRef(onSelectFoldEdge);
  onSelectFoldEdgeRef.current = onSelectFoldEdge;
  const onHoverFoldEdgeRef = useRef(onHoverFoldEdge);
  onHoverFoldEdgeRef.current = onHoverFoldEdge;

  const handleReady = useCallback((readyViewport: Viewport): void => {
    readyViewport.renderer.toneMapping = NoToneMapping;
    readyViewport.renderer.toneMappingExposure = 1;
    setViewport(readyViewport);
  }, []);

  const fitToView = useCallback((): void => {
    if (!viewport || !sceneObjectRef.current) return;
    viewport.camera.fit(
      new Box3().setFromObject(sceneObjectRef.current),
      viewMode === "2d" ? 1.08 : 1.35,
    );
    viewport.invalidate();
  }, [viewMode, viewport]);

  useEffect(() => {
    if (fitNonce > 0) fitToView();
  }, [fitNonce, fitToView]);

  const model = project.foldModel;
  const foldStepIndex = Math.max(
    0,
    project.foldingSteps.findIndex((step) => step.id === project.activeStepId),
  );
  const activeStep = project.foldingSteps[foldStepIndex];
  const foldAngle = activeStep?.angle ?? 0;

  useEffect(() => {
    if (!viewport) return;
    const specification = materialCatalog[project.materialSpec];
    const definition = specification?.group === "corrugated"
      ? materials.flute
      : materials[project.material];
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
    texture.center.set(0.5, 0.5);
    texture.rotation = (fluteAngle * Math.PI) / 180;
    texture.repeat.set(
      Math.max(1, (specification?.fluteFrequencyPerIn ?? 0) / 7.5),
      1,
    );
    texture.needsUpdate = true;
    return () => {
      cancelled = true;
      texture.dispose();
    };
  }, [fluteAngle, project.material, project.materialSpec, viewport]);

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
    const showSceneHelpers = showGroundPlane && viewMode === "3d";
    viewport.lighting.setGround(showSceneHelpers
      ? {
          grid: true,
          shadowCatcher: showShadow,
          size: 8,
        }
      : null);
    const helpers: Array<AxesHelper | GridHelper> = [];
    if (showGroundPlane && viewMode === "2d") {
      const grid = new GridHelper(8, 40, "#d7d7d7", "#ececec");
      grid.position.y = -0.01;
      viewport.scene.add(grid);
      helpers.push(grid);
    }
    if (showOrigin) {
      const axes = new AxesHelper(0.75);
      axes.position.set(-2, 0.002, -2);
      viewport.scene.add(axes);
      helpers.push(axes);
    }
    if (helpers.length === 0) return;
    viewport.invalidate();
    return () => {
      for (const helper of helpers) {
        viewport.scene.remove(helper);
        helper.dispose();
      }
      viewport.invalidate();
    };
  }, [showGroundPlane, showOrigin, showShadow, viewMode, viewport]);

  useEffect(() => {
    if (!viewport) return;
    viewport.lighting.setPreset(
      project.renderMode === "technical"
        ? "technical"
        : viewMode === "2d" ? "flat" : "studio",
    );
    viewport.lighting.setBackground(backgroundColor);
    viewport.lighting.setShadows(showShadow && viewMode === "3d");
    viewport.post.setEnabled(FOLD_SCENE_POST_PROCESSING);
    if (project.renderMode === "solid" && viewMode === "3d") {
      void viewport.lighting.setEnvironment("room", 0.55);
    } else {
      viewport.lighting.clearEnvironment();
    }
  }, [
    backgroundColor,
    project.renderMode,
    showShadow,
    viewMode,
    viewport,
  ]);

  useEffect(() => {
    if (!viewport) return;
    viewport.camera.setKind(
      viewMode === "2d" ? "orthographic" : project.projection,
    );
    fitToView();
  }, [fitToView, project.projection, viewMode, viewport]);

  useEffect(() => {
    if (!viewport) return;
    viewport.camera.setView(viewMode === "2d" ? "top" : project.cameraPreset);
    viewport.camera.setInputMap(interactive
      ? {}
      : {
          left: "none",
          middle: "none",
          right: "none",
          modified: { left: "none", right: "none" },
        });
    fitToView();
  }, [fitToView, interactive, project.cameraPreset, viewMode, viewport]);

  useEffect(() => {
    if (!viewport || !interactive) return;
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
  }, [interactive, model, viewport]);

  useEffect(() => {
    if (!viewport || !model) {
      onSceneObject?.(null);
      return;
    }
    const data = buildFoldScene({
      model,
      projection: viewMode === "2d" ? "flat-2d" : "folded-3d",
      foldStepIndex,
      foldAngle,
      thicknessMm: project.thicknessMm,
      thicknessOffsetDirection,
      panelColorMode,
      edgeColorMode,
      selectedFaceIndex,
      foldPositions: foldPlayback.positions ?? settlement?.positions,
      foldMaxEdgeError: foldPlayback.positions
        ? foldPlayback.solverMaxEdgeError
        : settlement?.maxEdgeError,
      foldMaxAngleErrorDeg: foldPlayback.positions
        ? foldPlayback.solverMaxAngleErrorDeg
        : settlement?.maxAngleErrorDeg,
    });
    sceneDataRef.current = data;

    const materialDefinition = materials[project.material];
    const technical = project.renderMode === "technical";
    const showArtwork = panelColorMode === "artwork";
    const useFaceColors = panelColorMode === "multicolor";
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
        viewMode === "2d",
      );
    }
    if (placedBackArtworkTexture) {
      applyArtworkPlacement(placedBackArtworkTexture, project.artwork, false);
    }
    const [frontMaterial, backMaterial, edgeMaterial] = createFoldSceneMaterials({
      viewMode,
      technical,
      showArtwork,
      useFaceColors,
      frontArtworkTexture: placedFrontArtworkTexture,
      backArtworkTexture: placedBackArtworkTexture,
      edgeTexture: materialTexture,
      edgeFallbackColor: materialDefinition.color,
    });
    const mesh = new Mesh(data.geometry, [frontMaterial, backMaterial, edgeMaterial]);
    mesh.castShadow = showShadow && viewMode === "3d";
    mesh.receiveShadow = true;

    const solidEdges = createFatEdges(data.solidEdgeGeometry, viewport, {
      linewidth: 1.9,
      depthTest: viewMode !== "2d",
    });
    const dashedEdges = createFatEdges(data.dashedEdgeGeometry, viewport, {
      dashed: true,
      linewidth: 1.7,
      depthTest: viewMode !== "2d",
    });
    const updateDashScale = (): void => {
      if (viewMode !== "2d") return;
      const zoom = viewport.camera.getState().zoom;
      const scale = 100 / Math.max(zoom, 0.0001);
      dashedEdges.material.dashSize = 0.05 * scale;
      dashedEdges.material.gapSize = 0.03 * scale;
    };
    updateDashScale();
    const offCameraChange = viewport.camera.onChange(() => {
      updateDashScale();
      viewport.invalidate();
    });
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
      solidEdges.line,
      dashedEdges.line,
      edgePickLines,
      selectedLine,
      hoverLine,
    );
    viewport.scene.add(group);
    sceneObjectRef.current = group;
    if (interactive) {
      viewport.picking.register(mesh, "fold-shell", "face", ["face"]);
      viewport.picking.register(edgePickLines, "fold-edges", "crease", ["edge"]);
    }
    const autoFit = autoFitRef.current;
    if (!autoFit || autoFit.model !== model || autoFit.viewMode !== viewMode) {
      autoFitRef.current = { model, viewMode };
      viewport.camera.fit(
        new Box3().setFromObject(group),
        viewMode === "2d" ? 1.08 : compact ? 1.55 : 1.35,
      );
    }
    viewport.invalidate();
    onSceneObject?.(group);

    return () => {
      onSceneObject?.(null);
      if (sceneObjectRef.current === group) sceneObjectRef.current = null;
      if (selectedLineRef.current === selectedLine) selectedLineRef.current = null;
      if (hoverLineRef.current === hoverLine) hoverLineRef.current = null;
      if (interactive) {
        viewport.picking.unregister(mesh);
        viewport.picking.unregister(edgePickLines);
      }
      offCameraChange();
      viewport.scene.remove(group);
      frontMaterial.dispose();
      backMaterial.dispose();
      edgeMaterial.dispose();
      placedFrontArtworkTexture?.dispose();
      placedBackArtworkTexture?.dispose();
      solidEdges.geometry.dispose();
      solidEdges.material.dispose();
      dashedEdges.geometry.dispose();
      dashedEdges.material.dispose();
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
    backArtworkTexture,
    compact,
    edgeColorMode,
    foldAngle,
    foldPlayback.positions,
    foldPlayback.solverMaxAngleErrorDeg,
    foldPlayback.solverMaxEdgeError,
    foldStepIndex,
    frontArtworkTexture,
    interactive,
    materialTexture,
    model,
    onSceneObject,
    panelColorMode,
    project.material,
    project.artwork,
    project.renderMode,
    project.thicknessMm,
    selectedFaceIndex,
    settlement,
    showShadow,
    thicknessOffsetDirection,
    viewMode,
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
    <section
      className={compact ? "viewport-pane compact" : "viewport-pane"}
      aria-label={`${viewMode.toUpperCase()} package viewport`}
      data-view-mode={viewMode}
    >
      <ViewportCanvas
        className="viewport-canvas"
        options={{
          projection: viewMode === "2d" ? "2d" : "3d",
          postProcessing: FOLD_SCENE_POST_PROCESSING,
        }}
        onReady={handleReady}
      />
    </section>
  );
}
