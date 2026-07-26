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

interface ViewportPaneProps {
  project: PackagingProject;
  selectedFaceIndex: number | null;
  onSelectFace: (faceIndex: number | null) => void;
  onSceneObject: (object: Object3D | null) => void;
}

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
}: ViewportPaneProps) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const sceneDataRef = useRef<FoldSceneData | null>(null);
  const onSelectFaceRef = useRef(onSelectFace);
  onSelectFaceRef.current = onSelectFace;

  const handleReady = useCallback((readyViewport: Viewport): void => {
    setViewport(readyViewport);
  }, []);

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
    if (!viewport || !project.foldModel) {
      onSceneObject(null);
      return;
    }
    const model = project.foldModel;
    const foldStepIndex = Math.max(
      0,
      project.foldingSteps.findIndex((step) => step.id === project.activeStepId),
    );
    const activeStep = project.foldingSteps[foldStepIndex];
    const data = buildFoldScene({
      model,
      projection: project.viewMode === "2d" ? "flat-2d" : "folded-3d",
      foldStepIndex,
      foldAngle: activeStep?.angle ?? 0,
      thicknessMm: project.thicknessMm,
      panelColorMode: "material",
      edgeColorMode: "mountain-valley",
      selectedFaceIndex,
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
  }, [onSceneObject, project, selectedFaceIndex, viewport]);

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
