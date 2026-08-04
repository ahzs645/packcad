import {
  AmbientLight,
  AxesHelper,
  BasicShadowMap,
  Box3,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  GreaterDepth,
  GridHelper,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  ShadowMaterial,
  TextureLoader,
  Vector3,
  type ColorRepresentation,
  type DepthModes,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { artworkImageSources } from "../model/artworkPlacement";
import {
  isSelectableCrease,
  sourceEdgeIndexFromPickSegment,
} from "../render/foldLineInteraction";
import {
  buildFoldScene,
  updateFoldScenePositions,
  type FoldSceneData,
  type FoldScenePositionInput,
} from "../render/foldSceneBuilder";
import {
  HOVER_EDGE_COLOR,
  LOCKED_FACE_TINT,
  LOCKED_FACE_TINT_OPACITY,
  SELECTED_EDGE_COLOR,
  SELECTED_FACE_TINT,
  SELECTED_FACE_TINT_OPACITY,
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
import {
  beginSettledFoldStepAutoFit,
  foldStepFitPadding,
  foldStepFrame,
  hasFoldPositionsForModel,
  isSameFoldStepFrame,
  updateSettledFoldStepAutoFit,
  type FoldStepFrame,
  type SettledFoldStepAutoFit,
} from "../render/foldStepAutoFit";
import { sourceIsometricCameraState } from "../render/sourceCamera";
import { materialTextureRepeat } from "../render/materialTexture";

const SOURCE_3D_CUT_LINE_WIDTH = 1.5;
const SOURCE_3D_CREASE_LINE_WIDTH = 1;
const SOURCE_2D_CUT_LINE_WIDTH = 2;
const SOURCE_2D_CREASE_LINE_WIDTH = 2;
const SOURCE_OCCLUDED_EDGE_OPACITY = 0.1;

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
  data.lockedIconGeometry?.dispose();
  data.selectedTintGeometry?.dispose();
  data.solidEdgeGeometry.dispose();
  data.creaseEdgeGeometry.dispose();
  data.dashedEdgeGeometry.dispose();
  data.edgePickGeometry.dispose();
}

function createLockedPanelTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return new CanvasTexture(canvas);
  context.clearRect(0, 0, 64, 64);
  context.strokeStyle = "#173f73";
  context.fillStyle = "rgba(23,63,115,0.12)";
  context.lineWidth = 6;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.arc(32, 26, 13, Math.PI, 0);
  context.stroke();
  context.beginPath();
  context.roundRect(14, 26, 36, 28, 5);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(32, 36);
  context.lineTo(32, 44);
  context.stroke();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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

function createFatEdges(
  source: BufferGeometry,
  viewport: Viewport,
  options: {
    color?: ColorRepresentation;
    dashed?: boolean;
    depthFunc?: DepthModes;
    linewidth: number;
    depthTest: boolean;
    opacity?: number;
    renderOrder?: number;
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
  const colorAttribute = source.getAttribute("color");
  if (colorAttribute) {
    geometry.setColors(colorAttribute.array as Float32Array);
  }
  const material = new LineMaterial({
    color: options.color ?? 0xffffff,
    vertexColors: Boolean(colorAttribute),
    linewidth: options.linewidth,
    worldUnits: false,
    dashed: options.dashed ?? false,
    dashSize: 0.05,
    gapSize: 0.03,
    depthTest: options.depthTest,
    depthWrite: false,
    transparent: true,
    opacity: options.opacity ?? 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (options.depthFunc !== undefined) material.depthFunc = options.depthFunc;
  material.resolution.set(
    Math.max(1, viewport.renderer.domElement.clientWidth),
    Math.max(1, viewport.renderer.domElement.clientHeight),
  );
  const line = new LineSegments2(geometry, material);
  if (options.dashed) line.computeLineDistances();
  line.renderOrder = options.renderOrder ?? 3;
  return { line, geometry, material };
}

type FatEdges = ReturnType<typeof createFatEdges>;

function updateFatEdgePositionArray(
  fatEdges: FatEdges | null,
  positions: Float32Array | undefined,
): void {
  if (!fatEdges) return;
  const nextPositions = positions ?? new Float32Array();
  const instanceStart = fatEdges.geometry.getAttribute("instanceStart");
  const instanceEnd = fatEdges.geometry.getAttribute("instanceEnd");
  const segmentCount = nextPositions.length / 6;
  if (
    !instanceStart ||
    !instanceEnd ||
    instanceStart.count !== segmentCount ||
    instanceEnd.count !== segmentCount
  ) {
    fatEdges.geometry.setPositions(nextPositions);
  } else {
    for (let index = 0; index < segmentCount; index += 1) {
      const offset = index * 6;
      instanceStart.setXYZ(
        index,
        nextPositions[offset],
        nextPositions[offset + 1],
        nextPositions[offset + 2],
      );
      instanceEnd.setXYZ(
        index,
        nextPositions[offset + 3],
        nextPositions[offset + 4],
        nextPositions[offset + 5],
      );
    }
    instanceStart.needsUpdate = true;
    instanceEnd.needsUpdate = true;
    fatEdges.geometry.computeBoundingBox();
    fatEdges.geometry.computeBoundingSphere();
  }
  if (fatEdges.material.dashed) fatEdges.line.computeLineDistances();
}

function updateFatEdgePositions(
  fatEdges: FatEdges | null,
  source: BufferGeometry,
): void {
  updateFatEdgePositionArray(
    fatEdges,
    source.getAttribute("position").array as Float32Array,
  );
}

function createEdgePositionSource(
  positions: Float32Array | undefined,
): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(positions ?? new Float32Array(), 3),
  );
  return geometry;
}

function updateFatEdgeResolution(
  fatEdges: FatEdges | null,
  viewport: Viewport,
): void {
  if (!fatEdges) return;
  fatEdges.material.resolution.set(
    Math.max(1, viewport.renderer.domElement.clientWidth),
    Math.max(1, viewport.renderer.domElement.clientHeight),
  );
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
  backgroundColor = viewMode === "2d" ? "#f2f2f3" : "#f7f7f7",
  compact = false,
  interactive = true,
  fitNonce = 0,
  thicknessOffsetDirection,
  fluteAngle = 0,
}: ViewportPaneProps) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [faceMaterialTexture, setFaceMaterialTexture] = useState<Texture | null>(null);
  const [materialTexture, setMaterialTexture] = useState<Texture | null>(null);
  const [frontArtworkTexture, setFrontArtworkTexture] = useState<Texture | null>(null);
  const [backArtworkTexture, setBackArtworkTexture] = useState<Texture | null>(null);
  const sceneDataRef = useRef<FoldSceneData | null>(null);
  const sceneObjectRef = useRef<Object3D | null>(null);
  const hoverLineRef = useRef<FatEdges | null>(null);
  const selectedLineRef = useRef<FatEdges | null>(null);
  const solidEdgesRef = useRef<FatEdges | null>(null);
  const creaseEdgesRef = useRef<FatEdges | null>(null);
  const dashedEdgesRef = useRef<FatEdges | null>(null);
  const occludedSolidEdgesRef = useRef<FatEdges | null>(null);
  const autoFitRef = useRef<FoldStepFrame | null>(null);
  const settledAutoFitRef = useRef<SettledFoldStepAutoFit | null>(null);
  const onSelectFaceRef = useRef(onSelectFace);
  onSelectFaceRef.current = onSelectFace;
  const onSelectFoldEdgeRef = useRef(onSelectFoldEdge);
  onSelectFoldEdgeRef.current = onSelectFoldEdge;
  const onHoverFoldEdgeRef = useRef(onHoverFoldEdge);
  onHoverFoldEdgeRef.current = onHoverFoldEdge;
  const selectedFoldEdgeIndexRef = useRef(selectedFoldEdgeIndex);
  selectedFoldEdgeIndexRef.current = selectedFoldEdgeIndex;
  const hoveredFoldEdgeIndexRef = useRef(hoveredFoldEdgeIndex);
  hoveredFoldEdgeIndexRef.current = hoveredFoldEdgeIndex;

  const handleReady = useCallback((readyViewport: Viewport): void => {
    readyViewport.renderer.toneMapping = NoToneMapping;
    readyViewport.renderer.toneMappingExposure = 1;
    readyViewport.renderer.shadowMap.type = BasicShadowMap;
    setViewport(readyViewport);
  }, []);

  const fitToView = useCallback((): void => {
    if (!viewport || !sceneObjectRef.current) return;
    viewport.camera.fit(
      new Box3().setFromObject(sceneObjectRef.current),
      foldStepFitPadding(viewMode, compact),
    );
    viewport.invalidate();
  }, [compact, viewMode, viewport]);

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
  const foldPositionInputRef = useRef<FoldScenePositionInput>({
    foldStepIndex,
    foldAngle,
  });
  foldPositionInputRef.current = {
    foldStepIndex,
    foldAngle,
    foldPositions: foldPlayback.positions ?? settlement?.positions,
    foldMaxEdgeError: foldPlayback.positions
      ? foldPlayback.solverMaxEdgeError
      : settlement?.maxEdgeError,
    foldMaxAngleErrorDeg: foldPlayback.positions
      ? foldPlayback.solverMaxAngleErrorDeg
      : settlement?.maxAngleErrorDeg,
  };

  useEffect(() => {
    if (!viewport) return;
    const specification = materialCatalog[project.materialSpec];
    // A FLUTE subtype describes the exposed cut edge, not the printable face.
    // The old renderer used the wavy sideband JPEG on both, creating the broad
    // dark streaks visible across every interior panel.
    const definition = specification?.group === "corrugated"
      || project.material === "flute"
      ? materials.corrugated
      : materials[project.material];
    let cancelled = false;
    setFaceMaterialTexture(null);
    const texture = new TextureLoader().load(definition.texture, () => {
      if (!cancelled) {
        setFaceMaterialTexture(texture);
        viewport.invalidate();
      }
    });
    configureArtworkTexture(texture);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    const isCorrugated = specification?.group === "corrugated"
      || project.material === "corrugated"
      || project.material === "flute";
    const repeat = materialTextureRepeat(model, {
      corrugated: isCorrugated,
      fluteFrequencyPerIn: specification?.fluteFrequencyPerIn,
    });
    // The source tiles around the physical centre of the FOLD UV panel. With a
    // centred Three texture this is equivalent to offset = .5 - repeat / 2.
    texture.center.set(0.5, 0.5);
    texture.rotation = (fluteAngle * Math.PI) / 180;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.needsUpdate = true;
    return () => {
      cancelled = true;
      texture.dispose();
    };
  }, [fluteAngle, model, project.material, project.materialSpec, viewport]);

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

  const placedFrontArtworkTexture = useMemo(() => {
    const source = frontArtworkTexture;
    if (!source) return null;
    const texture = configureArtworkTexture(source.clone());
    // The dieline view no longer mirrors its geometry (3D transforms are kept out
    // of it), so its artwork uses the same handedness as the folded view.
    applyArtworkPlacement(texture, project.artwork, false);
    return texture;
  }, [frontArtworkTexture, project.artwork, viewMode]);
  const placedBackArtworkTexture = useMemo(() => {
    const source = backArtworkTexture
      ?? frontArtworkTexture;
    if (!source) return null;
    const texture = configureArtworkTexture(source.clone());
    applyArtworkPlacement(
      texture,
      project.artwork,
      viewMode !== "2d" && Boolean(backArtworkTexture || frontArtworkTexture),
    );
    return texture;
  }, [backArtworkTexture, frontArtworkTexture, project.artwork, viewMode]);
  useEffect(
    () => () => {
      placedFrontArtworkTexture?.dispose();
      placedBackArtworkTexture?.dispose();
    },
    [placedBackArtworkTexture, placedFrontArtworkTexture],
  );

  const foldSceneMaterials = useMemo(() => {
    const materialDefinition = materials[project.material];
    return createFoldSceneMaterials({
      viewMode,
      technical: project.renderMode === "technical",
      showArtwork: panelColorMode === "artwork",
      useFaceColors: panelColorMode === "multicolor",
      faceTexture: faceMaterialTexture,
      frontArtworkTexture: placedFrontArtworkTexture,
      backArtworkTexture: placedBackArtworkTexture,
      edgeTexture: materialTexture,
      edgeFallbackColor: materialDefinition.color,
    });
  }, [
    faceMaterialTexture,
    materialTexture,
    panelColorMode,
    placedBackArtworkTexture,
    placedFrontArtworkTexture,
    project.material,
    project.renderMode,
    viewMode,
  ]);
  useEffect(
    () => () => {
      for (const material of foldSceneMaterials.base) material.dispose();
      for (const material of foldSceneMaterials.artwork ?? []) material.dispose();
    },
    [foldSceneMaterials],
  );

  useEffect(() => {
    if (!viewport) return;
    const showSceneHelpers = showGroundPlane && viewMode === "3d";
    viewport.lighting.setGround(showSceneHelpers
      ? {
          grid: false,
          shadowCatcher: showShadow,
          size: 12,
        }
      : null);
    const helpers: Array<AxesHelper | GridHelper> = [];
    if (showGroundPlane) {
      const grid = new GridHelper(
        viewMode === "3d" ? 12 : 8,
        viewMode === "3d" ? 120 : 80,
        "#c9cdd2",
        "#d8dce0",
      );
      grid.position.y = -0.01;
      grid.renderOrder = -2;
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
        material.transparent = true;
        material.opacity = viewMode === "3d" ? 0.82 : 0.58;
        material.depthWrite = false;
        material.toneMapped = false;
      }
      viewport.scene.add(grid);
      helpers.push(grid);
    }
    viewport.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const sceneMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of sceneMaterials) {
        if (material instanceof ShadowMaterial) material.opacity = 0.055;
      }
    });
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
    viewport.lighting.setBackground(backgroundColor);
    viewport.lighting.setShadows(showShadow && viewMode === "3d");
    viewport.post.setEnabled(FOLD_SCENE_POST_PROCESSING);
    viewport.lighting.clearEnvironment();
    if (project.renderMode === "technical") {
      viewport.lighting.setPreset("technical");
      return;
    }
    viewport.lighting.setPreset("none");
    if (viewMode === "2d") return;

    // The reference keeps a neutral white rig attached to the orbit camera.
    // Fixed warm/cool lights plus an environment map altered both the mean
    // chipboard lightness and the apparent fibre contrast as the model moved.
    const sourceLights = new Group();
    const ambient = new AmbientLight("#ffffff", 1.5);
    const key = new DirectionalLight("#ffffff", 2);
    const fill = new DirectionalLight("#ffffff", 0.6);
    const rim = new DirectionalLight("#ffffff", 0.8);
    key.castShadow = showShadow;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = 0.0001;
    key.shadow.normalBias = 0.0001;
    sourceLights.add(ambient, key, fill, rim, key.target, fill.target, rim.target);
    viewport.scene.add(sourceLights);

    const updateSourceLights = (): void => {
      const camera = viewport.camera.camera;
      const target = viewport.camera.controls.target;
      camera.updateMatrixWorld(true);
      const distance = Math.max(camera.position.distanceTo(target), 0.001);
      const forward = target.clone().sub(camera.position).normalize();
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      key.position.copy(camera.position)
        .addScaledVector(forward, 0.75 * distance)
        .addScaledVector(right, 0.4 * distance)
        .addScaledVector(up, 0.35 * distance);
      fill.position.copy(camera.position)
        .addScaledVector(forward, 0.75 * distance)
        .addScaledVector(right, -0.9 * distance)
        .addScaledVector(up, 0.1 * distance);
      rim.position.copy(target)
        .addScaledVector(forward, 1.2 * distance)
        .addScaledVector(up, 0.6 * distance);
      key.target.position.copy(target);
      fill.target.position.copy(target);
      rim.target.position.copy(target);
      viewport.invalidate();
    };
    updateSourceLights();
    const offCameraChange = viewport.camera.onChange(updateSourceLights);
    return () => {
      offCameraChange();
      viewport.scene.remove(sourceLights);
      viewport.invalidate();
    };
  }, [
    backgroundColor,
    project.renderMode,
    showShadow,
    viewMode,
    viewport,
  ]);

  useEffect(() => {
    const data = sceneDataRef.current;
    if (!data || !model || !viewport || viewMode === "2d") return;
    updateFoldScenePositions(data, foldPositionInputRef.current);
    updateFatEdgePositions(solidEdgesRef.current, data.solidEdgeGeometry);
    updateFatEdgePositions(creaseEdgesRef.current, data.creaseEdgeGeometry);
    updateFatEdgePositions(dashedEdgesRef.current, data.dashedEdgeGeometry);
    updateFatEdgePositions(
      occludedSolidEdgesRef.current,
      data.solidEdgeGeometry,
    );
    updateFatEdgePositionArray(
      selectedLineRef.current,
      selectedFoldEdgeIndexRef.current === null
        ? undefined
        : data.positionsByEdge.get(selectedFoldEdgeIndexRef.current),
    );
    updateFatEdgePositionArray(
      hoverLineRef.current,
      hoveredFoldEdgeIndexRef.current === null
        ? undefined
        : data.positionsByEdge.get(hoveredFoldEdgeIndexRef.current),
    );
    viewport.invalidate();
    // A direct keyframe click creates a paused player with no positions while
    // the settlement worker catches up. Fit its fallback scene immediately,
    // then reframe exactly once when the final positions arrive. Playback is
    // allowed to move freely and receives one fit only after it stops.
    const frame = foldStepFrame(model, viewMode, foldStepIndex);
    const settledAutoFit = settledAutoFitRef.current;
    if (settledAutoFit) {
      const result = updateSettledFoldStepAutoFit(
        settledAutoFit,
        frame,
        foldPlayback.playing,
        hasFoldPositionsForModel(
          model,
          foldPlayback.positions,
          settlement?.positions,
        ),
      );
      settledAutoFitRef.current = result.state;
      if (result.fit) fitToView();
    }
  }, [
    fitToView,
    foldAngle,
    foldPlayback.playing,
    foldPlayback.positions,
    foldPlayback.solverMaxAngleErrorDeg,
    foldPlayback.solverMaxEdgeError,
    settlement?.maxAngleErrorDeg,
    settlement?.maxEdgeError,
    settlement?.positions,
    foldStepIndex,
    model,
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
    if (viewMode === "2d") {
      viewport.camera.setView("top");
    } else if (project.cameraPreset === "isometric") {
      viewport.camera.setState(
        sourceIsometricCameraState(viewport.camera.getState()),
      );
    } else {
      viewport.camera.setView(project.cameraPreset);
    }
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
    const positionInput = foldPositionInputRef.current;
    const data = buildFoldScene({
      model,
      projection: viewMode === "2d" ? "flat-2d" : "folded-3d",
      foldStepIndex,
      foldAngle: positionInput.foldAngle,
      thicknessMm: project.thicknessMm,
      thicknessOffsetDirection,
      panelColorMode,
      edgeColorMode,
      selectedFaceIndex,
      foldPositions: positionInput.foldPositions,
      foldMaxEdgeError: positionInput.foldMaxEdgeError,
      foldMaxAngleErrorDeg: positionInput.foldMaxAngleErrorDeg,
    });
    sceneDataRef.current = data;

    const mesh = new Mesh(data.geometry, foldSceneMaterials.base);
    mesh.castShadow = showShadow && viewMode === "3d";
    mesh.receiveShadow = true;
    const artworkMesh = foldSceneMaterials.artwork
      ? new Mesh(data.geometry, foldSceneMaterials.artwork)
      : null;
    if (artworkMesh) {
      artworkMesh.name = "PackCAD print artwork";
      artworkMesh.renderOrder = 1;
    }

    const cutLineWidth = viewMode === "2d"
      ? SOURCE_2D_CUT_LINE_WIDTH
      : SOURCE_3D_CUT_LINE_WIDTH;
    const creaseLineWidth = viewMode === "2d"
      ? SOURCE_2D_CREASE_LINE_WIDTH
      : SOURCE_3D_CREASE_LINE_WIDTH;
    const solidEdges = createFatEdges(data.solidEdgeGeometry, viewport, {
      linewidth: cutLineWidth,
      depthTest: viewMode !== "2d",
    });
    const creaseEdges = createFatEdges(data.creaseEdgeGeometry, viewport, {
      linewidth: creaseLineWidth,
      depthTest: viewMode !== "2d",
    });
    const dashedEdges = createFatEdges(data.dashedEdgeGeometry, viewport, {
      dashed: true,
      linewidth: creaseLineWidth,
      depthTest: viewMode !== "2d",
    });
    // X-ray only true cut boundaries. Replaying hidden crease geometry through
    // a fully folded panel creates ghost diagonals and doubled seams that move
    // with perspective, even though those creases are internal construction.
    const occludedSolidEdges = viewMode === "3d" && project.renderMode === "technical"
      ? createFatEdges(data.solidEdgeGeometry, viewport, {
          linewidth: Math.min(cutLineWidth, 1),
          depthTest: true,
          depthFunc: GreaterDepth,
          opacity: SOURCE_OCCLUDED_EDGE_OPACITY,
          renderOrder: 2,
        })
      : null;
    solidEdgesRef.current = solidEdges;
    creaseEdgesRef.current = creaseEdges;
    dashedEdgesRef.current = dashedEdges;
    occludedSolidEdgesRef.current = occludedSolidEdges;
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
    const selectedEdgeSource = createEdgePositionSource(
      selectedFoldEdgeIndex === null
        ? undefined
        : data.positionsByEdge.get(selectedFoldEdgeIndex),
    );
    const hoverEdgeSource = createEdgePositionSource(
      hoveredFoldEdgeIndex === null
        ? undefined
        : data.positionsByEdge.get(hoveredFoldEdgeIndex),
    );
    const selectedLine = createFatEdges(selectedEdgeSource, viewport, {
      color: viewMode === "2d" ? "#155dfc" : SELECTED_EDGE_COLOR,
      linewidth: viewMode === "2d" ? 7 : 2.2,
      depthTest: false,
      renderOrder: 19,
    });
    const hoverLine = createFatEdges(hoverEdgeSource, viewport, {
      color: viewMode === "2d" ? "#2b7fff" : HOVER_EDGE_COLOR,
      linewidth: viewMode === "2d" ? 10 : 2,
      depthTest: false,
      renderOrder: 20,
    });
    selectedLineRef.current = selectedLine;
    hoverLineRef.current = hoverLine;

    const lockedTintMaterial = new MeshBasicMaterial({
      color: LOCKED_FACE_TINT,
      transparent: true,
      opacity: LOCKED_FACE_TINT_OPACITY,
      depthWrite: false,
      depthTest: viewMode !== "2d",
      side: DoubleSide,
    });
    const selectedTintMaterial = new MeshBasicMaterial({
      color: SELECTED_FACE_TINT,
      transparent: true,
      opacity: SELECTED_FACE_TINT_OPACITY,
      depthWrite: false,
      depthTest: viewMode !== "2d",
      side: DoubleSide,
    });
    const lockedTintMesh = LOCKED_FACE_TINT_OPACITY > 0 && data.lockedTintGeometry
      ? new Mesh(data.lockedTintGeometry, lockedTintMaterial)
      : null;
    const lockedIconTexture = createLockedPanelTexture();
    const lockedIconMaterial = new PointsMaterial({
      map: lockedIconTexture,
      color: "#ffffff",
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
      depthTest: true,
      size: 18,
      sizeAttenuation: false,
    });
    const lockedIconPoints = viewMode === "3d" && data.lockedIconGeometry
      ? new Points(data.lockedIconGeometry, lockedIconMaterial)
      : null;
    const selectedTintMesh = data.selectedTintGeometry
      ? new Mesh(data.selectedTintGeometry, selectedTintMaterial)
      : null;
    if (lockedTintMesh) lockedTintMesh.renderOrder = 1;
    if (lockedIconPoints) lockedIconPoints.renderOrder = 18;
    if (selectedTintMesh) selectedTintMesh.renderOrder = 2;

    const group = new Group();
    group.name = "PackCAD folded package";
    group.add(mesh);
    if (artworkMesh) group.add(artworkMesh);
    if (lockedTintMesh) group.add(lockedTintMesh);
    if (lockedIconPoints) group.add(lockedIconPoints);
    if (selectedTintMesh) group.add(selectedTintMesh);
    if (occludedSolidEdges) group.add(occludedSolidEdges.line);
    group.add(
      solidEdges.line,
      creaseEdges.line,
      dashedEdges.line,
      edgePickLines,
      selectedLine.line,
      hoverLine.line,
    );
    const fatEdgeLayers = [
      solidEdges,
      creaseEdges,
      dashedEdges,
      occludedSolidEdges,
      selectedLine,
      hoverLine,
    ];
    const syncLineResolution = (): void => {
      for (const layer of fatEdgeLayers) {
        updateFatEdgeResolution(layer, viewport);
      }
      viewport.invalidate();
    };
    syncLineResolution();
    let compactFitFrame = 0;
    const handleResize = (): void => {
      syncLineResolution();
      if (!compact) return;
      const view = viewport.renderer.domElement.ownerDocument.defaultView;
      if (!view) return;
      if (compactFitFrame !== 0) view.cancelAnimationFrame(compactFitFrame);
      compactFitFrame = view.requestAnimationFrame(() => {
        compactFitFrame = 0;
        // Atelier's own observer updates the projection independently. Resize
        // first so this compact-only fit always uses the final inset aspect.
        viewport.resize();
        viewport.camera.fit(
          new Box3().setFromObject(group),
          foldStepFitPadding(viewMode, compact),
        );
        viewport.invalidate();
      });
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(viewport.renderer.domElement.parentElement
      ?? viewport.renderer.domElement);
    viewport.scene.add(group);
    sceneObjectRef.current = group;
    if (interactive) {
      viewport.picking.register(mesh, "fold-shell", "face", ["face"]);
      viewport.picking.register(edgePickLines, "fold-edges", "crease", ["edge"]);
    }
    const frame = foldStepFrame(model, viewMode, foldStepIndex);
    if (!isSameFoldStepFrame(autoFitRef.current, frame)) {
      autoFitRef.current = frame;
      settledAutoFitRef.current = beginSettledFoldStepAutoFit(
        frame,
        foldPlayback.playing,
        hasFoldPositionsForModel(model, positionInput.foldPositions),
      );
      if (!foldPlayback.playing) {
        viewport.camera.fit(
          new Box3().setFromObject(group),
          foldStepFitPadding(viewMode, compact),
        );
      }
    }
    viewport.invalidate();
    onSceneObject?.(group);

    return () => {
      onSceneObject?.(null);
      if (sceneObjectRef.current === group) sceneObjectRef.current = null;
      if (selectedLineRef.current === selectedLine) selectedLineRef.current = null;
      if (hoverLineRef.current === hoverLine) hoverLineRef.current = null;
      if (solidEdgesRef.current === solidEdges) solidEdgesRef.current = null;
      if (creaseEdgesRef.current === creaseEdges) creaseEdgesRef.current = null;
      if (dashedEdgesRef.current === dashedEdges) dashedEdgesRef.current = null;
      if (occludedSolidEdgesRef.current === occludedSolidEdges) {
        occludedSolidEdgesRef.current = null;
      }
      if (interactive) {
        viewport.picking.unregister(mesh);
        viewport.picking.unregister(edgePickLines);
      }
      offCameraChange();
      resizeObserver.disconnect();
      if (compactFitFrame !== 0) {
        viewport.renderer.domElement.ownerDocument.defaultView
          ?.cancelAnimationFrame(compactFitFrame);
      }
      viewport.scene.remove(group);
      solidEdges.geometry.dispose();
      solidEdges.material.dispose();
      creaseEdges.geometry.dispose();
      creaseEdges.material.dispose();
      dashedEdges.geometry.dispose();
      dashedEdges.material.dispose();
      occludedSolidEdges?.geometry.dispose();
      occludedSolidEdges?.material.dispose();
      edgePickMaterial.dispose();
      selectedLine.geometry.dispose();
      selectedLine.material.dispose();
      hoverLine.geometry.dispose();
      hoverLine.material.dispose();
      selectedEdgeSource.dispose();
      hoverEdgeSource.dispose();
      lockedTintMaterial.dispose();
      lockedIconMaterial.dispose();
      lockedIconTexture.dispose();
      selectedTintMaterial.dispose();
      disposeSceneData(data);
      sceneDataRef.current = null;
      viewport.invalidate();
    };
  }, [
    compact,
    edgeColorMode,
    foldStepIndex,
    foldSceneMaterials,
    interactive,
    model,
    onSceneObject,
    panelColorMode,
    project.thicknessMm,
    selectedFaceIndex,
    showShadow,
    thicknessOffsetDirection,
    viewMode,
    viewport,
  ]);

  useEffect(() => {
    const data = sceneDataRef.current;
    const line = selectedLineRef.current;
    if (!data || !line) return;
    updateFatEdgePositionArray(
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
    updateFatEdgePositionArray(
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
