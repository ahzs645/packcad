import { log } from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const bundleUrl = new URL(
  "../artifacts/reference-prettified/app.packcad.com/mockup/assets/index-B3RIumNL.js",
  import.meta.url,
);
const bundlePath = fileURLToPath(bundleUrl);

const IMPORT_SOURCE_WIPE_ORIGINAL = `          {
            const T0 =
              window[EoQK3yiBytTlbwhMngHO(wreAZJzYPBMt9oHqL04G[f0(187)])][
                EoQK3yiBytTlbwhMngHO(wreAZJzYPBMt9oHqL04G.bQGNcI3_LVpGjcvK3qUK)
              ];
            setTimeout(() => {
              const n0 = f0;
              T0 !== EoQK3yiBytTlbwhMngHO(wreAZJzYPBMt9oHqL04G[n0(185)]) &&
                T0 !== EoQK3yiBytTlbwhMngHO(wreAZJzYPBMt9oHqL04G[n0(157)]) &&
                (o0[n0(213)] = void 0);
            }, 1e3 * 2);
          }`;

const IMPORT_SOURCE_WIPE_PATCHED = `          {
            // The downloaded reference bundle deliberately clears the SVG
            // source after two seconds when it is not running on an allowed
            // host. In the local mirror that invalidates the import operation,
            // collapses the graph, and makes the completed animation impossible
            // to replay. Keep the embedded source for this offline reference.
          }`;

const RESET_ORIGINAL = `  [_0x435364(191)]() {
    this[_0x435364(266)].reset();
  }`;

const RESET_LEGACY_PATCHED = `  [_0x435364(191)]() {
    // Local mirror fix: reset the whole operation stage immediately. The
    // stage hard reset copies both 2D and 3D geometry from its starting graph,
    // resets solver matrices, and preserves graph element IDs.
    this[_0x435364(266)].hardReset();
  }`;

const RESET_PATCHED = `  [_0x435364(191)]() {
    // Keep the reference's normal replay lifecycle. Its stage reset restores
    // the missing 3D state without relinking the entire keyframe chain.
    this[_0x435364(266)].reset();
  }`;

const STAGE_RESET_ORIGINAL = `  [_0x435364(191)]() {
    const e0 = _0x435364;
    (this[e0(276)][e0(191)](), this.setNeedsRecompute());
  }`;

const STAGE_RESET_PATCHED = `  [_0x435364(191)]() {
    const e0 = _0x435364;
    // OrigamiSimulation.reset() restores constraints and 2D positions on its
    // next update, but omits 3D positions. Restore only this stage's 3D output
    // first so replay starts flat without forcing a hard reset downstream.
    this._endingGraph.copy3DGeometry(this.startingGraph);
    (this[e0(276)][e0(191)](), this.setNeedsRecompute());
  }`;

const IMPORT_FACE_CACHE_ORIGINAL = `    i0.setFromFOLD(B0, o0, s0);`;

const IMPORT_FACE_CACHE_PATCHED = `    i0.setFromFOLD(B0, o0, s0);
    // Local mirror fix: remember a geometry signature for every authored face.
    // This lets downstream selections survive a later graph rebuild that
    // recreates an otherwise identical face under a different runtime ID.
    for (
      let packcadMirrorFaceIndex = 0;
      packcadMirrorFaceIndex < i0.faces.length;
      packcadMirrorFaceIndex++
    ) {
      packcadMirrorRememberFace(
        i0.faces[packcadMirrorFaceIndex],
        packcadMirrorFaceIndex,
      );
    }`;

const ORIGAMI_FACE_REMAP_ORIGINAL = `      this[t0(270)](new _0x428a0e(this, e0)));
  }
  set _origamiSimulationStage(e0) {`;

const ORIGAMI_FACE_REMAP_PATCHED = `      this[t0(270)](new _0x428a0e(this, e0)));
  }
  update() {
    const remaps = globalThis.__PACKCAD_MIRROR_FACE_ID_REMAPS__;
    if (remaps && this.fixedFaceIDs.length) {
      const fixedFaceIDs = this.fixedFaceIDs.map((id) => remaps.get(id) ?? id);
      if (fixedFaceIDs.some((id, index) => id !== this.fixedFaceIDs[index])) {
        this.fixedFaceIDs = fixedFaceIDs;
      }
    }
    return super.update();
  }
  set _origamiSimulationStage(e0) {`;

const FOLDING_SETUP_HELPERS_ORIGINAL = `const OPERATION_FOLDING_SETUP = _0x552671(158);`;

const FOLDING_SETUP_HELPERS_PATCHED = `function packcadMirrorFaceGeometrySignature(face) {
  const loops = [face.boundary, ...(face.holes ?? [])];
  return loops
    .map((loop) =>
      loop.pEdges
        .map((pEdge) => {
          const point = pEdge.pv1.position2D;
          return point
            ? point.x.toFixed(6) + "," + point.y.toFixed(6)
            : "vertex:" + pEdge.pv1.vertex.id;
        })
        .sort()
        .join(";")
    )
    .sort()
    .join("|");
}

function packcadMirrorRememberFace(face, index) {
  const signatures =
    globalThis.__PACKCAD_MIRROR_FACE_SIGNATURES__ ??
    (globalThis.__PACKCAD_MIRROR_FACE_SIGNATURES__ = new Map());
  signatures.set(face.id, packcadMirrorFaceGeometrySignature(face));
  if (index !== void 0) {
    const indices =
      globalThis.__PACKCAD_MIRROR_FACE_INDICES__ ??
      (globalThis.__PACKCAD_MIRROR_FACE_INDICES__ = new Map());
    indices.set(face.id, index);
  }
}

function packcadMirrorRemapFace(graph, faceID) {
  const signatures = globalThis.__PACKCAD_MIRROR_FACE_SIGNATURES__;
  const signature = signatures?.get(faceID);
  if (!signature) return;
  const replacementByGeometry = graph.faces.find(
      (face) => packcadMirrorFaceGeometrySignature(face) === signature,
    ),
    sourceIndex = globalThis.__PACKCAD_MIRROR_FACE_INDICES__?.get(faceID),
    replacement =
      replacementByGeometry ??
      (sourceIndex !== void 0 ? graph.faces[sourceIndex] : void 0);
  globalThis.__PACKCAD_MIRROR_FACE_REMAP_DIAGNOSTIC__ = {
    faceID,
    graphFaceCount: graph.faces.length,
    sourceIndex,
    geometryMatched: !!replacementByGeometry,
    replacementID: replacement?.id,
  };
  if (!replacement) return;
  packcadMirrorRememberFace(replacement);
  const remaps =
    globalThis.__PACKCAD_MIRROR_FACE_ID_REMAPS__ ??
    (globalThis.__PACKCAD_MIRROR_FACE_ID_REMAPS__ = new Map());
  remaps.set(faceID, replacement.id);
  return replacement.id;
}

const OPERATION_FOLDING_SETUP = _0x552671(158);`;

const FOLDING_SETUP_REMAP_ORIGINAL = `      this[t0(153)](),
      this[t0(167)]());
  }
  set [_0x552671(169)](e0) {`;

const FOLDING_SETUP_REMAP_PATCHED = `      this[t0(153)](),
      this[t0(167)]());
  }
  update() {
    const graph = this._transform3DStage.startingGraph,
      faceID = this.fixedFaceID;
    if (graph && faceID) {
      const face = graph.getFaceWithIDIfExists(faceID);
      if (face) {
        packcadMirrorRememberFace(face);
      } else {
        const replacementID = packcadMirrorRemapFace(graph, faceID);
        if (replacementID) this.fixedFaceID = replacementID;
      }
    }
    return super.update();
  }
  set [_0x552671(169)](e0) {`;

const RENDER_ORIGINAL = `  let b0 = !1;

  function f0() {
    var Z0 = t0;
    b0 ||
      (window[Z0(107)](f0),
      udxMezkztRO5LjzW8i7O.design[Z0(129)](),
      glRenderer[Z0(149)]());
  }`;

const RENDER_PATCHED = `  let b0 = !1;
  let packcadMirrorPreviewDesign,
    packcadMirrorLastValidGraph,
    packcadMirrorLastSnapshotTime = 0,
    packcadMirrorPreviousSelectionPriorityMode;

  function packcadMirrorSetPreviewActive(active) {
    if (active) {
      if (packcadMirrorPreviousSelectionPriorityMode === void 0) {
        packcadMirrorPreviousSelectionPriorityMode = glRenderer.selectionPriorityMode;
      }
      glRenderer.selectionPriorityMode = SELECTION_PRIORITY_MODE_NONE;
    } else if (packcadMirrorPreviousSelectionPriorityMode !== void 0) {
      glRenderer.selectionPriorityMode = packcadMirrorPreviousSelectionPriorityMode;
      packcadMirrorPreviousSelectionPriorityMode = void 0;
    }
    globalThis.__PACKCAD_MIRROR_LAST_VALID_PREVIEW_ACTIVE__ = active;
  }

  function packcadMirrorRetainLastValidPreview() {
    const design = udxMezkztRO5LjzW8i7O.design,
      liveGraph = design.graph;
    globalThis.__PACKCAD_MIRROR_DESIGN__ = design;
    if (packcadMirrorPreviewDesign !== design) {
      packcadMirrorLastValidGraph?.dispose();
      packcadMirrorPreviewDesign = design;
      packcadMirrorLastValidGraph = void 0;
      packcadMirrorLastSnapshotTime = 0;
    }
    const operations = [...design.operations, ...design.modifiers],
      hasErrors = operations.some(
        (operation) => operation.enabled && operation.isInErrorState,
      ),
      isSolving = operations.some(
        (operation) => operation.enabled && operation.iterativeSolveInProgress,
      ),
      hasRenderableFaces = liveGraph.faces.length > 0;
    if (!hasErrors && hasRenderableFaces) {
      const now = performance.now();
      if (!packcadMirrorLastValidGraph) {
        packcadMirrorLastValidGraph = liveGraph.clone();
        packcadMirrorLastSnapshotTime = now;
      } else if (!isSolving && now - packcadMirrorLastSnapshotTime >= 250) {
        packcadMirrorLastValidGraph.copy(liveGraph);
        packcadMirrorLastSnapshotTime = now;
      }
      dnsvDtlCU3x9dbk6drsX.graph = liveGraph;
      packcadMirrorSetPreviewActive(!1);
    } else if (hasErrors && !hasRenderableFaces && packcadMirrorLastValidGraph) {
      // Presentation-only fallback for the local reference mirror. The live
      // Design graph remains untouched so operation recovery still sees the
      // real error state instead of stale topology.
      dnsvDtlCU3x9dbk6drsX.graph = packcadMirrorLastValidGraph;
      packcadMirrorSetPreviewActive(!0);
    } else {
      dnsvDtlCU3x9dbk6drsX.graph = liveGraph;
      packcadMirrorSetPreviewActive(!1);
    }
  }

  function f0() {
    var Z0 = t0;
    b0 ||
      (window[Z0(107)](f0),
      udxMezkztRO5LjzW8i7O.design[Z0(129)](),
      packcadMirrorRetainLastValidPreview(),
      glRenderer[Z0(149)]());
  }`;

const EXPORT_ORIGINAL = `  async function T0() {
    var O0 = t0;
    if (_0x2612e0[O0(480)](x0)) {`;

const EXPORT_PATCHED = `  async function T0() {
    var O0 = t0;
    if (globalThis.__PACKCAD_MIRROR_LAST_VALID_PREVIEW_ACTIVE__) {
      alert("Resolve folding errors before exporting the last valid preview.");
      return;
    }
    if (_0x2612e0[O0(480)](x0)) {`;

function replacePatch(source, original, patched, label) {
  if (source.includes(patched)) return { source, changed: false };
  const first = source.indexOf(original);
  if (first < 0) throw new Error(`Could not locate ${label} patch point.`);
  if (source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`${label} patch point was not unique.`);
  }
  return {
    source: source.slice(0, first) + patched + source.slice(first + original.length),
    changed: true,
  };
}

let source = await readFile(bundlePath, "utf8");
let migratedLegacyReset = false;
if (source.includes(RESET_LEGACY_PATCHED)) {
  source = source.replace(RESET_LEGACY_PATCHED, RESET_ORIGINAL);
  migratedLegacyReset = true;
}
const importSourceWipe = replacePatch(
  source,
  IMPORT_SOURCE_WIPE_ORIGINAL,
  IMPORT_SOURCE_WIPE_PATCHED,
  "local import source retention",
);
source = importSourceWipe.source;
const importFaceCache = replacePatch(
  source,
  IMPORT_FACE_CACHE_ORIGINAL,
  IMPORT_FACE_CACHE_PATCHED,
  "import face signature cache",
);
source = importFaceCache.source;
const origamiFaceRemap = replacePatch(
  source,
  ORIGAMI_FACE_REMAP_ORIGINAL,
  ORIGAMI_FACE_REMAP_PATCHED,
  "origami fixed face remap",
);
source = origamiFaceRemap.source;
const foldingSetupHelpers = replacePatch(
  source,
  FOLDING_SETUP_HELPERS_ORIGINAL,
  FOLDING_SETUP_HELPERS_PATCHED,
  "folding setup remap helpers",
);
source = foldingSetupHelpers.source;
const foldingSetupRemap = replacePatch(
  source,
  FOLDING_SETUP_REMAP_ORIGINAL,
  FOLDING_SETUP_REMAP_PATCHED,
  "folding setup fixed face remap",
);
source = foldingSetupRemap.source;
const stageReset = replacePatch(
  source,
  STAGE_RESET_ORIGINAL,
  STAGE_RESET_PATCHED,
  "solver stage replay reset",
);
source = stageReset.source;
const reset = replacePatch(source, RESET_ORIGINAL, RESET_PATCHED, "solver reset");
source = reset.source;
const render = replacePatch(source, RENDER_ORIGINAL, RENDER_PATCHED, "render fallback");
source = render.source;
const exportGuard = replacePatch(source, EXPORT_ORIGINAL, EXPORT_PATCHED, "fallback export guard");
source = exportGuard.source;

if (process.argv.includes("--check")) {
  if (
    !source.includes(RESET_PATCHED)
    || !source.includes(IMPORT_SOURCE_WIPE_PATCHED)
    || !source.includes(STAGE_RESET_PATCHED)
    || !source.includes(IMPORT_FACE_CACHE_PATCHED)
    || !source.includes(ORIGAMI_FACE_REMAP_PATCHED)
    || !source.includes(FOLDING_SETUP_HELPERS_PATCHED)
    || !source.includes(FOLDING_SETUP_REMAP_PATCHED)
    || !source.includes(RENDER_PATCHED)
    || !source.includes(EXPORT_PATCHED)
  ) {
    throw new Error("Reference mirror patch verification failed.");
  }
  log("Reference mirror patches are present.");
} else if (
  importSourceWipe.changed
  || importFaceCache.changed
  || origamiFaceRemap.changed
  || foldingSetupHelpers.changed
  || foldingSetupRemap.changed
  || migratedLegacyReset
  || stageReset.changed
  || reset.changed
  || render.changed
  || exportGuard.changed
) {
  await writeFile(bundlePath, source);
  log("Patched the local PackCAD reference mirror.");
} else {
  log("The local PackCAD reference mirror is already patched.");
}
