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
import type { FoldModel } from "@packcad/format";
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

function foldbackModel(): FoldModel {
  return {
    verticesCoords: [[0, 0], [10, 0], [10, 10], [0, 10], [20, 0], [20, 10]],
    coordinateUnit: "mm",
    verticesUv: [],
    verticesIDs: ["v0", "v1", "v2", "v3", "v4", "v5"],
    facesIDs: ["body", "foldback"],
    edgesVertices: [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [4, 5], [5, 2]],
    edgesAssignment: ["B", "V", "B", "B", "B", "B", "B"],
    facesVertices: [[0, 1, 2, 3], [1, 4, 5, 2]],
    facesEdges: [[0, 1, 2, 3], [4, 5, 6, 1]],
    edgeFaces: [[0], [0, 1], [0], [0], [1], [1], [1]],
    fixedFaceIndex: 0,
    keyframes: [{
      id: "fold", label: "Fold back", creaseAnglesDeg: { 1: 180 },
      creaseEdgeGroup: { 1: 0 }, fixedFaceIndices: [0], fixedVertexIndices: [],
      enforcePriorConstraints: false,
    }],
    transforms: [],
    thickness: { value: 0.1, direction: "THICKNESS_OFFSET_DIRECTION_BACK", units: "mm", rotationDegrees: 0 },
    rigidTimeline: true,
  };
}

function hingedPanelModel(triangular: boolean, reversed: boolean): FoldModel {
  const verticesCoords = [[0, 0], [10, 0], [10, 10], [0, 10],
    ...(triangular ? [[20, 5]] : [[20, 0], [20, 10]])];
  const facesVertices = [[0, 1, 2, 3], triangular ? [1, 4, 2] : [1, 4, 5, 2]]
    .map((loop) => reversed ? [...loop].reverse() : loop);
  const edgesVertices: [number, number][] = [];
  const edgeFaces: number[][] = [];
  const facesEdges = facesVertices.map((loop, face) => loop.map((a, index) => {
    const b = loop[(index + 1) % loop.length];
    let edge = edgesVertices.findIndex(([u, v]) => (u === a && v === b) || (u === b && v === a));
    if (edge < 0) {
      edge = edgesVertices.length;
      edgesVertices.push([a, b]);
      edgeFaces.push([]);
    }
    edgeFaces[edge].push(face);
    return edge;
  }));
  const hinge = edgeFaces.findIndex((faces) => faces.length === 2);
  return {
    ...foldbackModel(),
    verticesCoords,
    verticesIDs: verticesCoords.map((_, i) => `v${i}`),
    facesIDs: ["body", "inside-tab"],
    facesVertices, facesEdges, edgesVertices, edgeFaces,
    edgesAssignment: edgeFaces.map((faces) => faces.length === 2 ? "V" : "B"),
    faceSurfaceLayers: [null, -1.05],
    keyframes: [{
      id: "fold", label: "Turn tab inside", creaseAnglesDeg: { [hinge]: 90 },
      creaseEdgeGroup: { [hinge]: 0 }, fixedFaceIndices: [0], fixedVertexIndices: [],
      enforcePriorConstraints: false,
    }],
  };
}

describe("triangle and polygon render winding", () => {
  it.each([
    { triangular: true, reversed: false },
    { triangular: true, reversed: true },
    { triangular: false, reversed: false },
    { triangular: false, reversed: true },
  ])("keeps print and inside skins consistent for $triangular triangular / $reversed reversed loops", ({ triangular, reversed }) => {
    const model = hingedPanelModel(triangular, reversed);
    const originalLoops = structuredClone(model.facesVertices);
    const originalVertices = structuredClone(model.verticesCoords);
    const common = {
      model, thicknessMm: 0.1, panelColorMode: "artwork" as const,
      edgeColorMode: "mountain-valley" as const,
    };
    for (const projection of ["flat-2d", "folded-3d"] as const) {
      const flat = buildFoldScene({ ...common, projection, foldStepIndex: 0, foldAngle: 0 });
      const expectedY = projection === "flat-2d" ? -1 : 1;
      expect(frontTrianglePointAndNormal(flat, 0).normal[1]).toBeCloseTo(expectedY, 8);
      expect(frontTrianglePointAndNormal(flat, 1).normal[1]).toBeCloseTo(expectedY, 8);
      disposeScene(flat);
    }

    const input = { ...common, projection: "folded-3d" as const, foldStepIndex: 1, foldAngle: 0 };
    const scene = buildFoldScene(input);
    for (const foldAngle of [0, 22.5, 45, 67.5, 90]) {
      updateFoldScenePositions(scene, { foldStepIndex: 1, foldAngle });
      const fresh = buildFoldScene({ ...input, foldAngle });
      for (const key of ["geometry", "solidEdgeGeometry", "interiorEdgeGeometry", "dashedEdgeGeometry"] as const) {
        const actual = scene[key].getAttribute("position").array;
        const expected = fresh[key].getAttribute("position").array;
        expect(actual.length).toBe(expected.length);
        expect(Array.from(actual).reduce((maximum, value, index) =>
          Math.max(maximum, Math.abs(value - expected[index])), 0)).toBeLessThan(1e-6);
      }
      disposeScene(fresh);
    }

    // A fixed counterclockwise source triangle determines the printed side
    // independently of both input loop winding and render triangulation.
    const ids = triangular ? [1, 4, 2] : [1, 4, 5];
    const [a, b, c] = ids.map((vertex) => scene.timelineSolve.positions[vertex]);
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const foldNormal = [ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(...foldNormal);
    const printedNormal = [foldNormal[0], foldNormal[2], foldNormal[1]].map((value) => value / length);
    const renderedNormal = frontTrianglePointAndNormal(scene, 1).normal;
    expect(renderedNormal.reduce((sum, value, axis) => sum + value * printedNormal[axis], 0)).toBeCloseTo(1, 7);

    const positions = scene.geometry.getAttribute("position") as BufferAttribute;
    const rootFront = scene.positionLayout.meshRecipes.findIndex((recipe) =>
      recipe.kind === "face" && recipe.faceIndex === 0 && recipe.vertexIndex === 1 && recipe.normalOffset === 0);
    expect(rootFront).toBeGreaterThanOrEqual(0);
    const rootPoint = [positions.getX(rootFront), positions.getY(rootFront), positions.getZ(rootFront)];
    const offsets = scene.positionLayout.meshRecipes.flatMap((recipe, index) => {
      if (recipe.kind !== "face" || recipe.faceIndex !== 1 || recipe.vertexIndex !== 1) return [];
      return [[positions.getX(index), positions.getY(index), positions.getZ(index)].reduce(
        (sum, value, axis) => sum + (value - rootPoint[axis]) * printedNormal[axis], 0)];
    });
    expect(offsets).toHaveLength(2);
    expect(Math.min(...offsets)).toBeCloseTo(-2.05 * scene.meta.visualThickness, 6);
    expect(Math.max(...offsets)).toBeCloseTo(-1.05 * scene.meta.visualThickness, 6);
    expect(model.facesVertices).toEqual(originalLoops);
    expect(model.verticesCoords).toEqual(originalVertices);
    disposeScene(scene);
  });
});

describe("fold scene frame updates", () => {
  it("keeps a 180-degree foldback's entire rendered slab behind the exterior sheet", () => {
    const model = foldbackModel();
    const structuralVertices = structuredClone(model.verticesCoords);
    const input = {
      model, projection: "folded-3d" as const, foldStepIndex: 1, foldAngle: 180, thicknessMm: 0.1,
      panelColorMode: "artwork" as const, edgeColorMode: "mountain-valley" as const,
    };
    const baseline = buildFoldScene(input);
    model.faceSurfaceLayers = [null, 2.05];
    const layered = buildFoldScene(input);
    const exterior = frontTrianglePointAndNormal(layered, 0);
    const positions = layered.geometry.getAttribute("position") as BufferAttribute;
    const distances = layered.positionLayout.meshRecipes.flatMap((recipe, index) => {
      if (recipe.kind !== "face" || recipe.faceIndex !== 1) return [];
      return [[positions.getX(index), positions.getY(index), positions.getZ(index)].reduce(
        (sum, value, axis) => sum + (value - exterior.point[axis]) * exterior.normal[axis], 0,
      )];
    });
    expect(Math.min(...distances)).toBeCloseTo(-2.05 * layered.meta.visualThickness, 6);
    expect(Math.max(...distances)).toBeCloseTo(-1.05 * layered.meta.visualThickness, 6);
    expect(Math.max(...distances)).toBeLessThan(-layered.meta.visualThickness);
    expect(signedFaceSeparation(baseline, 0, 1)).toBeCloseTo(0, 6);
    expect(layered.interiorEdgeGeometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(model.verticesCoords).toEqual(structuralVertices);
    expect(layered.timelineSolve.positions).toEqual(baseline.timelineSolve.positions);
    disposeScene(baseline);
    disposeScene(layered);
  });

  it.each([-1.05, 2.05])("updates signed surface layer %s continuously without moving the flat print", (layer) => {
    const model = foldbackModel();
    const common = {
      model, thicknessMm: 0.1, panelColorMode: "artwork" as const, edgeColorMode: "mountain-valley" as const,
    };
    const plainFlat = buildFoldScene({ ...common, projection: "flat-2d", foldStepIndex: 0, foldAngle: 0 });
    model.faceSurfaceLayers = [null, layer];
    const input = { ...common, projection: "folded-3d" as const, foldStepIndex: 1, foldAngle: 0 };
    const scene = buildFoldScene(input);
    const layeredFlat = buildFoldScene({ ...input, projection: "flat-2d", foldStepIndex: 0 });
    expect(layeredFlat.geometry.getAttribute("position").array).toEqual(
      plainFlat.geometry.getAttribute("position").array,
    );
    expect(layeredFlat.solidEdgeGeometry.getAttribute("position").array).toEqual(
      plainFlat.solidEdgeGeometry.getAttribute("position").array,
    );
    for (const foldAngle of [0, 45, 90, 135, 180]) {
      updateFoldScenePositions(scene, { foldStepIndex: 1, foldAngle });
      const fresh = buildFoldScene({ ...input, foldAngle });
      for (const key of ["geometry", "solidEdgeGeometry", "interiorEdgeGeometry", "dashedEdgeGeometry"] as const) {
        const actual = scene[key].getAttribute("position").array;
        const expected = fresh[key].getAttribute("position").array;
        expect(actual.length).toBe(expected.length);
        const maximum = Array.from(actual).reduce((result, value, index) =>
          Math.max(result, Math.abs(value - expected[index])), 0);
        expect(maximum).toBeLessThan(1e-6);
      }
      disposeScene(fresh);
    }
    disposeScene(plainFlat);
    disposeScene(layeredFlat);
    disposeScene(scene);
  });

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

describe("folded handedness", () => {
  // The sheet seen from its print side, as the flat view shows it, must be the
  // sheet seen from outside once folded. A reflection in the fold -> scene remap
  // folded every package into its mirror image: lettering read backwards, and
  // un-mirroring the artwork to compensate moved print onto the opposite panel.
  it("folds the sheet as printed, not its mirror image", () => {
    const model = hingedPanelModel(false, false);
    const common = {
      model, thicknessMm: 0.1, panelColorMode: "artwork" as const,
      edgeColorMode: "mountain-valley" as const,
    };
    const edge = (a: number, b: number) =>
      model.edgesVertices.findIndex(([u, v]) => u === a && v === b);
    const along = edge(0, 1);
    const up = edge(3, 0);
    expect(along).toBeGreaterThanOrEqual(0);
    expect(up).toBeGreaterThanOrEqual(0);

    // Corners A (0,0), B (10,0) and D (0,10) of the fixed body panel, and the
    // turn A -> B -> D as seen looking at its print.
    const turn = (scene: FoldSceneData, toward: readonly number[]): number => {
      const ab = scene.positionsByEdge.get(along);
      const da = scene.positionsByEdge.get(up);
      if (!ab || !da) throw new Error("Missing body edge positions");
      const a = [ab[0], ab[1], ab[2]];
      const b = [ab[3], ab[4], ab[5]];
      const d = [da[0], da[1], da[2]];
      const u = b.map((value, axis) => value - a[axis]);
      const v = d.map((value, axis) => value - a[axis]);
      const cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      return Math.sign(cross.reduce((sum, value, axis) => sum + value * toward[axis], 0));
    };

    // The flat view looks down from +Y at the sheet as printed.
    const flat = buildFoldScene({ ...common, projection: "flat-2d", foldStepIndex: 0, foldAngle: 0 });
    const printed = turn(flat, [0, 1, 0]);
    expect(printed).not.toBe(0);
    disposeScene(flat);

    for (const foldAngle of [0, 90]) {
      const folded = buildFoldScene({ ...common, projection: "folded-3d", foldStepIndex: 1, foldAngle });
      // Seen from outside: along the outward normal of the printed (front) side.
      expect(turn(folded, frontTrianglePointAndNormal(folded, 0).normal)).toBe(printed);
      disposeScene(folded);
    }
  });
});
