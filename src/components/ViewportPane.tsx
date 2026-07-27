import {
  Box3,
  Color,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import { ViewportCanvas } from "@atelier/react";
import type { PickHit, Viewport } from "@atelier/viewport";
import type { PackagingProject } from "@packcad/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildFoldScene, type FoldSceneData } from "../render/foldSceneBuilder";
import type {
  CachedFoldSettlement,
  FoldDiagnostics,
  FoldSettlementRequest,
  FoldSettlementResponse,
} from "../render/foldSettlement";

interface ViewportPaneProps {
  project: PackagingProject;
  selectedFaceIndex: number | null;
  onSelectFace: (faceIndex: number | null) => void;
  onSceneObject: (object: Object3D | null) => void;
  onFoldDiagnostics: (diagnostics: FoldDiagnostics) => void;
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

export function ViewportPane({
  project,
  selectedFaceIndex,
  onSelectFace,
  onSceneObject,
  onFoldDiagnostics,
}: ViewportPaneProps) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [settlement, setSettlement] = useState<ActiveSettlement | null>(null);
  const sceneDataRef = useRef<FoldSceneData | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(new Map<number, {
    model: NonNullable<PackagingProject["foldModel"]>;
    cacheKey: string;
  }>());
  const cacheRef = useRef(
    new WeakMap<NonNullable<PackagingProject["foldModel"]>, Map<string, CachedFoldSettlement>>(),
  );
  const onSelectFaceRef = useRef(onSelectFace);
  onSelectFaceRef.current = onSelectFace;

  const handleReady = useCallback((readyViewport: Viewport): void => {
    setViewport(readyViewport);
  }, []);

  useEffect(() => {
    const worker = new Worker(
      new URL("../render/foldSettleWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<FoldSettlementResponse>): void => {
      const response = event.data;
      const pending = pendingRef.current.get(response.requestId);
      pendingRef.current.delete(response.requestId);
      if (!pending || response.requestId !== requestIdRef.current) return;
      if (!response.ok) {
        setSettlement(null);
        onFoldDiagnostics({ status: "error", message: response.message });
        return;
      }
      const next: CachedFoldSettlement = {
        positions: response.positions,
        maxEdgeError: response.maxEdgeError,
        maxAngleErrorDeg: response.maxAngleErrorDeg,
        converged: response.converged,
      };
      const modelCache = cacheRef.current.get(pending.model) ?? new Map();
      modelCache.set(pending.cacheKey, next);
      cacheRef.current.set(pending.model, modelCache);
      setSettlement({
        model: pending.model,
        cacheKey: pending.cacheKey,
        data: next,
      });
      onFoldDiagnostics({
        status: "settled",
        maxEdgeError: next.maxEdgeError,
        maxAngleErrorDeg: next.maxAngleErrorDeg,
        converged: next.converged,
      });
    };
    worker.onerror = (): void => {
      setSettlement(null);
      onFoldDiagnostics({
        status: "error",
        message: "The settled fold solver failed.",
      });
    };
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, [onFoldDiagnostics]);

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
    if (!model) {
      setSettlement(null);
      return;
    }
    const cacheKey = settlementKey;
    const cached = cacheRef.current.get(model)?.get(cacheKey);
    if (cached) {
      setSettlement({ model, cacheKey, data: cached });
      onFoldDiagnostics({
        status: "settled",
        maxEdgeError: cached.maxEdgeError,
        maxAngleErrorDeg: cached.maxAngleErrorDeg,
        converged: cached.converged,
      });
      return;
    }

    setSettlement(null);
    onFoldDiagnostics({ status: "settling" });
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      const request: FoldSettlementRequest = {
        requestId,
        model,
        foldStepIndex,
        foldAngle,
      };
      pendingRef.current.set(requestId, { model, cacheKey });
      workerRef.current?.postMessage(request);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [foldAngle, foldStepIndex, model, onFoldDiagnostics, settlementKey]);

  useEffect(() => {
    if (!viewport) return;
    return viewport.picking.onPick((hit: PickHit | null) => {
      const data = sceneDataRef.current;
      const triangleIndex = hit?.faceIndex;
      if (!data || triangleIndex === undefined) {
        onSelectFaceRef.current(null);
        return;
      }
      const sourceFace = data.faceIndexByTriangle[triangleIndex] ?? -1;
      onSelectFaceRef.current(sourceFace >= 0 ? sourceFace : null);
    });
  }, [viewport]);

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
      panelColorMode: "material",
      edgeColorMode: "mountain-valley",
      selectedFaceIndex,
      foldPositions: activeSettlement?.positions,
      foldMaxEdgeError: activeSettlement?.maxEdgeError,
      foldMaxAngleErrorDeg: activeSettlement?.maxAngleErrorDeg,
    });
    sceneDataRef.current = data;

    const material = project.material;
    const baseColor =
      material === "chipboard" ? "#c8b394"
        : material === "corrugated" ? "#b98f5a"
          : material === "flute" ? "#d0a66b"
            : "#bc8d55";
    const frontMaterial = new MeshStandardMaterial({
      color: new Color(baseColor),
      roughness: 0.82,
      metalness: 0.01,
      vertexColors: true,
    });
    const backMaterial = frontMaterial.clone();
    backMaterial.color.offsetHSL(0, -0.05, -0.08);
    const edgeMaterial = new MeshStandardMaterial({
      color: "#87643e",
      roughness: 0.92,
      metalness: 0,
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

    const group = new Group();
    group.name = "PackCAD folded package";
    group.add(mesh, solidLines, dashedLines);
    viewport.scene.add(group);
    viewport.picking.register(mesh, "fold-shell", "face", ["face"]);
    viewport.camera.setView(project.viewMode === "2d" ? "top" : project.cameraPreset);
    viewport.camera.fit(
      new Box3().setFromObject(group),
      project.viewMode === "2d" ? 1.08 : 1.35,
    );
    viewport.invalidate();
    onSceneObject(group);

    return () => {
      onSceneObject(null);
      viewport.picking.unregister(mesh);
      viewport.scene.remove(group);
      frontMaterial.dispose();
      backMaterial.dispose();
      edgeMaterial.dispose();
      solidMaterial.dispose();
      dashedMaterial.dispose();
      disposeSceneData(data);
      sceneDataRef.current = null;
      viewport.invalidate();
    };
  }, [activeSettlement, foldAngle, foldStepIndex, model, onSceneObject, project, selectedFaceIndex, viewport]);

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
      <div className="viewport-hint">
        {project.viewMode === "3d" ? "Orbit · scroll to zoom · click a face" : "Pan · scroll to zoom · click a face"}
      </div>
    </section>
  );
}
