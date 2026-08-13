import {
  createCurvedBoxProject,
  createMailerBoxProject,
  createMilkCartonProject,
  createPillowBoxProject,
  createVhsSlipcoverProject,
  solveFoldTimeline,
} from "@packcad/fold-solver";
import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it, vi } from "vitest";
import {
  buildFoldScene,
  facePointWeights,
  SOURCE_THICKNESS_DISPLAY_SCALE,
  updateFoldScenePositions,
  type FoldSceneData,
} from "./foldSceneBuilder";

function disposeScene(scene: FoldSceneData): void {
  scene.geometry.dispose();
  scene.lockedTintGeometry?.dispose();
  scene.lockedIconGeometry?.dispose();
  scene.selectedTintGeometry?.dispose();
  scene.solidEdgeGeometry.dispose();
  scene.interiorEdgeGeometry.dispose();
  scene.occludedEdgeGeometry.dispose();
  scene.creaseEdgeGeometry.dispose();
  scene.dashedEdgeGeometry.dispose();
  scene.edgePickGeometry.dispose();
}

function frontTrianglePointAndNormal(scene: FoldSceneData, faceIndex: number) {
  const positions = scene.geometry.getAttribute("position") as BufferAttribute;
  const indices = scene.geometry.getIndex();
  if (!indices) throw new Error("Folded shell is not indexed");
  const triangle = Array.from(scene.faceIndexByTriangle).indexOf(faceIndex);
  if (triangle < 0) throw new Error(`Missing rendered face ${faceIndex}`);
  const points = [0, 1, 2].map((corner) => {
    const vertex = indices.getX(triangle * 3 + corner);
    return [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)] as const;
  });
  const ab = points[1].map((value, axis) => value - points[0][axis]);
  const ac = points[2].map((value, axis) => value - points[0][axis]);
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal);
  return {
    point: points[0],
    normal: normal.map((value) => value / length),
  };
}

function signedFaceSeparation(scene: FoldSceneData, outerFace: number, innerFace: number): number {
  const outer = frontTrianglePointAndNormal(scene, outerFace);
  const inner = frontTrianglePointAndNormal(scene, innerFace);
  return inner.point.reduce(
    (sum, value, axis) => sum + (value - outer.point[axis]) * outer.normal[axis],
    0,
  );
}

describe("fold scene frame updates", () => {
  it("insets completed VHS interior flaps without overriding edge visibility", () => {
    const project = createVhsSlipcoverProject();
    const model = project.foldModel;
    if (!model) throw new Error("VHS fixture did not produce a fold model");
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: model.keyframes.length,
      foldAngle: 90,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    expect(scene.occludedEdgeGeometry.getAttribute("position").count).toBe(0);
    expect(scene.interiorEdgeGeometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(model.interiorFaceIndices).toEqual([4, 6, 7, 8]);
    expect(scene.meta.interiorLayerFaceCount).toBe(4);
    expect(scene.meta.lockedFaceCount).toBe(
      model.keyframes.at(-1)?.fixedFaceIndices.length ?? 0,
    );
    expect(signedFaceSeparation(scene, 0, 4)).toBeLessThan(0);
    expect(signedFaceSeparation(scene, 3, 6)).toBeLessThan(-scene.meta.visualThickness * 0.9);
    disposeScene(scene);
  });

  it("keeps the VHS glue seam and closure ears inside before the tuck stage", () => {
    const project = createVhsSlipcoverProject();
    const model = project.foldModel;
    if (!model) throw new Error("VHS fixture did not produce a fold model");
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 4,
      foldAngle: 90,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    expect(scene.meta.interiorLayerFaceCount).toBe(3);
    expect(scene.occludedEdgeGeometry.getAttribute("position").count).toBe(0);

    for (const earFace of [7, 8]) {
      expect(signedFaceSeparation(scene, 5, earFace)).toBeLessThan(
        -scene.meta.visualThickness * 0.9,
      );
    }
    disposeScene(scene);
  });

  it("renders the source-discretised pillow graph without re-smoothing flat curves", () => {
    const project = createPillowBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("PillowBox fixture did not produce a fold model");
    const scene = buildFoldScene({
      model,
      projection: "flat-2d",
      foldStepIndex: 0,
      foldAngle: 0,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    expect(scene.segmentEdgeIndex.length).toBe(model.edgesVertices.length);
    expect(new Set(scene.segmentEdgeIndex).size).toBe(model.edgesVertices.length);
    disposeScene(scene);
  });

  it("anchors restored pillow-box curves to their owning boundary triangles", () => {
    const model = createPillowBoxProject().foldModel;
    if (!model) throw new Error("PillowBox fixture did not produce a fold model");
    let checkedCurves = 0;

    model.edgeControlPoints?.forEach((controls, edgeIndex) => {
      const faces = model.edgeFaces[edgeIndex] ?? [];
      if (controls.length === 0 || faces.length !== 1) return;
      const [va, vb] = model.edgesVertices[edgeIndex];
      const start = model.verticesCoords[va];
      const end = model.verticesCoords[vb];
      const midpoint: [number, number] = [
        (start[0] + end[0]) / 2,
        (start[1] + end[1]) / 2,
      ];
      const weights = facePointWeights(
        model,
        faces[0],
        midpoint,
        [va, vb],
      );

      expect(weights.vertexIndices).toContain(va);
      expect(weights.vertexIndices).toContain(vb);
      checkedCurves += 1;
    });

    expect(checkedCurves).toBeGreaterThan(0);
  });

  it("ignores stale playback positions while switching between source projects", () => {
    const milkModel = createMilkCartonProject().foldModel;
    const curvedProject = createCurvedBoxProject();
    const curvedModel = curvedProject.foldModel;
    if (!milkModel || !curvedModel) throw new Error("Source fixtures did not produce fold models");
    const staleMilkPositions = milkModel.verticesCoords.map(([x, y]) => [x, y, 0] as [number, number, number]);

    const scene = buildFoldScene({
      model: curvedModel,
      projection: "folded-3d",
      foldStepIndex: curvedModel.keyframes.length,
      foldAngle: 35,
      thicknessMm: curvedProject.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
      foldPositions: staleMilkPositions,
    });

    expect(() => updateFoldScenePositions(scene, {
      foldStepIndex: curvedModel.keyframes.length,
      foldAngle: 35,
      foldPositions: staleMilkPositions,
    })).not.toThrow();
    expect(scene.geometry.getAttribute("position").count).toBeGreaterThan(0);
    disposeScene(scene);
  });

  it("uses the source-calibrated Mailer Box shell while excluding selection from locked tint", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const selectedFaceIndex = model.keyframes[0]?.fixedFaceIndices[0];
    if (selectedFaceIndex === undefined) {
      throw new Error("MailerBox fixture is missing its fixed bottom panel");
    }
    const unselected = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 0,
      foldAngle: 0,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });
    const selected = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 0,
      foldAngle: 0,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
      selectedFaceIndex,
    });

    expect(selected.meta.visualThickness).toBeCloseTo(
      4.5 * selected.frameScale * SOURCE_THICKNESS_DISPLAY_SCALE,
      10,
    );
    expect(selected.selectedTintGeometry).not.toBeNull();
    expect(selected.lockedTintGeometry?.getAttribute("position").count ?? 0)
      .toBeLessThan(unselected.lockedTintGeometry?.getAttribute("position").count ?? 0);
    expect(selected.lockedIconGeometry?.getAttribute("position").count ?? 0)
      .toBe(selected.meta.lockedFaceCount * 2);
    expect(selected.solidEdgeGeometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(selected.segmentEdgeIndex.length).toBeGreaterThan(model.edgesVertices.length);
    expect(selected.creaseEdgeGeometry.getAttribute("position").count).toBeGreaterThan(0);

    disposeScene(unselected);
    disposeScene(selected);
  });

  it("wraps every fold hinge with a finite bend-radius arc", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 5,
      foldAngle: 90,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    // Ten arc segments per hinge per non-degenerate sheet offset (this fixture
    // extrudes inward only, so exactly one offset per hinge), six indices each.
    expect(scene.meta.interiorFoldHingeCount).toBeGreaterThan(0);
    expect(scene.meta.foldHingeBendIndexCount).toBe(
      scene.meta.interiorFoldHingeCount * 10 * 6,
    );
    // The 180-degree K4 fold-over rails exercise the antipodal-normal branch;
    // every generated position must stay finite (the old miter bisector was
    // numerically unstable there and left the rail open).
    const positions = scene.geometry.getAttribute("position").array as Float32Array;
    let finite = true;
    for (let index = 0; index < positions.length; index += 1) {
      if (!Number.isFinite(positions[index])) { finite = false; break; }
    }
    expect(finite).toBe(true);
    disposeScene(scene);
  });

  it("leaves double-wall end slots open at fully folded K5 corners", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex: 5,
      foldAngle: 90,
      thicknessMm: project.thicknessMm,
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    // The source renders each board's own cut band and lets the slot between
    // the double walls fall dark; no bridge-cap geometry closes the seam.
    expect(scene.meta.closedSeamEdgeCount).toBe(0);
    expect(scene.meta.closedSeamCapIndexCount).toBe(0);
    const capGroups = scene.geometry.groups.filter((group) => group.materialIndex === 3);
    expect(capGroups).toHaveLength(1);
    expect(capGroups[0]?.count).toBe(scene.meta.foldHingeCapIndexCount);

    disposeScene(scene);
  });

  it("reuses one structural scene while mutating frame positions in place", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const foldStepIndex = 1;
    let structuralBuildCount = 0;
    const buildStructuralScene = (): FoldSceneData => {
      structuralBuildCount += 1;
      return buildFoldScene({
        model,
        projection: "folded-3d",
        foldStepIndex,
        foldAngle: 0,
        thicknessMm: project.thicknessMm,
        panelColorMode: "artwork",
        edgeColorMode: "mountain-valley",
      });
    };
    const scene = buildStructuralScene();
    const geometry = scene.geometry;
    const positionAttribute = geometry.getAttribute("position");
    const positionArray = positionAttribute.array as Float32Array;
    const initialPositions = positionArray.slice();
    const solidGeometry = scene.solidEdgeGeometry;
    const creaseGeometry = scene.creaseEdgeGeometry;
    const dashedGeometry = scene.dashedEdgeGeometry;
    const pickGeometry = scene.edgePickGeometry;
    const pickArray = (
      pickGeometry.getAttribute("position").array as Float32Array
    );
    const pickAttribute = pickGeometry.getAttribute("position");
    if (
      !(positionAttribute instanceof BufferAttribute) ||
      !(pickAttribute instanceof BufferAttribute)
    ) {
      throw new Error("Fold scene positions must use buffer attributes");
    }
    const initialPickPositions = pickArray.slice();
    const setAttribute = vi.spyOn(BufferGeometry.prototype, "setAttribute");

    for (const foldAngle of [15, 35, 65, 90]) {
      const frame = solveFoldTimeline(model, foldStepIndex, foldAngle);
      updateFoldScenePositions(scene, {
        foldStepIndex,
        foldAngle,
        foldPositions: frame.positions,
        foldMaxEdgeError: frame.maxEdgeError,
        foldMaxAngleErrorDeg: frame.maxAngleErrorDeg,
      });
    }

    expect(structuralBuildCount).toBe(1);
    expect(scene.geometry).toBe(geometry);
    expect(scene.geometry.getAttribute("position")).toBe(positionAttribute);
    expect(scene.geometry.getAttribute("position").array).toBe(positionArray);
    expect(scene.solidEdgeGeometry).toBe(solidGeometry);
    expect(scene.creaseEdgeGeometry).toBe(creaseGeometry);
    expect(scene.dashedEdgeGeometry).toBe(dashedGeometry);
    expect(scene.edgePickGeometry).toBe(pickGeometry);
    expect(pickGeometry.getAttribute("position").array).toBe(pickArray);
    expect(Array.from(positionArray)).not.toEqual(Array.from(initialPositions));
    expect(Array.from(pickArray)).not.toEqual(Array.from(initialPickPositions));
    expect(positionAttribute.version).toBeGreaterThan(0);
    expect(pickAttribute.version).toBeGreaterThan(0);
    expect(setAttribute).not.toHaveBeenCalled();

    setAttribute.mockRestore();
    disposeScene(scene);
  });

  it("matches a fresh thickness-shell build at every sampled playback angle", () => {
    const project = createMailerBoxProject();
    const model = project.foldModel;
    if (!model) throw new Error("MailerBox fixture did not produce a fold model");
    const foldStepIndex = 1;
    const scene = buildFoldScene({
      model,
      projection: "folded-3d",
      foldStepIndex,
      foldAngle: 0,
      thicknessMm: project.thicknessMm,
      thicknessOffsetDirection: "THICKNESS_OFFSET_DIRECTION_BACK",
      panelColorMode: "artwork",
      edgeColorMode: "mountain-valley",
    });

    const maximumDelta = (left: Float32Array, right: Float32Array): number => {
      expect(left.length).toBe(right.length);
      let maximum = 0;
      for (let index = 0; index < left.length; index += 1) {
        maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
      }
      return maximum;
    };

    for (const foldAngle of [0, 30, 60, 90]) {
      const frame = solveFoldTimeline(model, foldStepIndex, foldAngle);
      updateFoldScenePositions(scene, {
        foldStepIndex,
        foldAngle,
        foldPositions: frame.positions,
        foldMaxEdgeError: frame.maxEdgeError,
        foldMaxAngleErrorDeg: frame.maxAngleErrorDeg,
      });
      const fresh = buildFoldScene({
        model,
        projection: "folded-3d",
        foldStepIndex,
        foldAngle,
        thicknessMm: project.thicknessMm,
        thicknessOffsetDirection: "THICKNESS_OFFSET_DIRECTION_BACK",
        panelColorMode: "artwork",
        edgeColorMode: "mountain-valley",
        foldPositions: frame.positions,
        foldMaxEdgeError: frame.maxEdgeError,
        foldMaxAngleErrorDeg: frame.maxAngleErrorDeg,
      });

      expect(maximumDelta(
        scene.geometry.getAttribute("position").array as Float32Array,
        fresh.geometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);
      expect(maximumDelta(
        scene.solidEdgeGeometry.getAttribute("position").array as Float32Array,
        fresh.solidEdgeGeometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);
      expect(maximumDelta(
        scene.creaseEdgeGeometry.getAttribute("position").array as Float32Array,
        fresh.creaseEdgeGeometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);
      expect(maximumDelta(
        scene.dashedEdgeGeometry.getAttribute("position").array as Float32Array,
        fresh.dashedEdgeGeometry.getAttribute("position").array as Float32Array,
      )).toBeLessThan(1e-6);

      disposeScene(fresh);
    }

    disposeScene(scene);
  });
});
