// SVG -> FOLD crease-pattern builder (OPERATION_IMPORT_SVG).
//
// The captured runtime parses an imported dieline SVG into a FOLD crease
// pattern: vertices, edges (assigned from stroke-colour filters), faces, and
// normalized UVs. The captured sample files already embed that `parsedFOLD`, so
// the importer prefers it; this builder reconstructs one from the raw SVG for
// dielines that don't ship a pre-computed pattern.
//
// Framework-free (regex SVG scan + half-edge planar face detection) so it runs
// in the browser and headlessly under node verification.

import { fromSVG } from "@atelier/io";
import type { ImportSvgFilter, ParsedFold } from "./packcadProject";

type Pt = { x: number; y: number };
type Segment = { a: Pt; b: Pt; stroke: string };

// Reference import constants (CPIO_*, px basis @72ppi). svgFold works in the
// SVG's own coordinate space (px for the bundled samples), so the px-denominated
// tolerances are used directly.
const VERTEX_MERGE_TOL_PX = 0.5; // CPIO_DEFAULT_SVG_VERTEX_TOLERANCE_PX
const SVG_PPI = 72; // CPIO_DEFAULT_SVG_PPI
// Adaptive curve flattening: max chord deviation (DEFAULT_..._MAX_DEVIATION_IN=1/80).
const CURVE_MAX_DEV_PX = (1 / 80) * SVG_PPI; // ≈0.9px
const NUMERICAL_TOL = 1e-12;

/** Perpendicular distance from p to the segment line through a,b. */
function distToLine(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < NUMERICAL_TOL) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
}

/** Adaptively flatten a cubic Bézier by recursive subdivision until the control
 *  points are within CURVE_MAX_DEV_PX of the chord (the reference's
 *  deviation-bounded discretizeCurves, vs the old fixed 16 steps). Appends the
 *  flattened interior+end points (not p0) to `out`. */
function flattenCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[], depth = 0): void {
  if (depth >= 18 || (distToLine(p1, p0, p3) <= CURVE_MAX_DEV_PX && distToLine(p2, p0, p3) <= CURVE_MAX_DEV_PX)) {
    out.push(p3);
    return;
  }
  const mid = (u: Pt, v: Pt): Pt => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });
  const p01 = mid(p0, p1), p12 = mid(p1, p2), p23 = mid(p2, p3);
  const p012 = mid(p01, p12), p123 = mid(p12, p23);
  const m = mid(p012, p123);
  flattenCubic(p0, p01, p012, m, out, depth + 1);
  flattenCubic(m, p123, p23, p3, out, depth + 1);
}

/** Adaptively flatten a quadratic Bézier (deviation-bounded). */
function flattenQuad(p0: Pt, p1: Pt, p2: Pt, out: Pt[], depth = 0): void {
  if (depth >= 18 || distToLine(p1, p0, p2) <= CURVE_MAX_DEV_PX) {
    out.push(p2);
    return;
  }
  const mid = (u: Pt, v: Pt): Pt => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });
  const p01 = mid(p0, p1), p12 = mid(p1, p2);
  const m = mid(p01, p12);
  flattenQuad(p0, p01, m, out, depth + 1);
  flattenQuad(m, p12, p2, out, depth + 1);
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
}

function strokeOf(tag: string): string {
  const direct = attr(tag, "stroke");
  if (direct) return direct.trim().toLowerCase();
  const style = attr(tag, "style");
  if (style) {
    const m = style.match(/stroke\s*:\s*([^;]+)/i);
    if (m) return m[1].trim().toLowerCase();
  }
  return "";
}

function numbers(s: string): number[] {
  return (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
}

// Flatten a path `d` into line segments (curves sampled; arcs approximated as
// straight chords). Handles M/L/H/V/C/Q/Z (absolute + relative).
function pathSegments(d: string, stroke: string): Segment[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const segs: Segment[] = [];
  let i = 0;
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let cmd = "";
  const num = () => Number(tokens[i++]);
  const lineTo = (p: Pt) => {
    segs.push({ a: cur, b: p, stroke });
    cur = p;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "M") {
      const p = { x: num() + (rel ? cur.x : 0), y: num() + (rel ? cur.y : 0) };
      cur = p;
      start = p;
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      lineTo({ x: num() + (rel ? cur.x : 0), y: num() + (rel ? cur.y : 0) });
    } else if (C === "H") {
      lineTo({ x: num() + (rel ? cur.x : 0), y: cur.y });
    } else if (C === "V") {
      lineTo({ x: cur.x, y: num() + (rel ? cur.y : 0) });
    } else if (C === "C") {
      const p1 = { x: num() + (rel ? cur.x : 0), y: num() + (rel ? cur.y : 0) };
      const p2 = { x: num() + (rel ? cur.x : 0), y: num() + (rel ? cur.y : 0) };
      const p3 = { x: num() + (rel ? cur.x : 0), y: num() + (rel ? cur.y : 0) };
      const pts: Pt[] = [];
      flattenCubic(cur, p1, p2, p3, pts);
      for (const pt of pts) lineTo(pt);
    } else if (C === "Q") {
      const p1 = { x: num() + (rel ? cur.x : 0), y: num() + (rel ? cur.y : 0) };
      const p2 = { x: num() + (rel ? cur.x : 0), y: num() + (rel ? cur.y : 0) };
      const pts: Pt[] = [];
      flattenQuad(cur, p1, p2, pts);
      for (const pt of pts) lineTo(pt);
    } else if (C === "Z") {
      if (cur.x !== start.x || cur.y !== start.y) lineTo(start);
    } else {
      i++; // unsupported command token; skip
    }
  }
  return segs;
}

/** Extract all line segments from an SVG string, tagged with stroke colour. */
export function parseSvgSegments(svg: string): Segment[] {
  // Atelier owns raw SVG path parsing. Convert its neutral millimetre drawing
  // back into the FOLD importer’s 72 px/in coordinate frame, retaining the
  // source stroke colour for PackCAD's crease-assignment filters.
  const drawing = fromSVG(svg, { unit: "px", dpi: SVG_PPI });
  const pxPerMm = SVG_PPI / 25.4;
  const engineSegments: Segment[] = [];
  for (const poly of drawing.polys) {
    const stroke = drawing.layers
      .find((layer) => layer.id === poly.layer)
      ?.style?.color.toLowerCase() ?? "";
    const points = poly.pts.map((point) => ({
      x: point.x * pxPerMm,
      y: -point.y * pxPerMm,
    }));
    for (let index = 0; index + 1 < points.length; index += 1) {
      engineSegments.push({ a: points[index], b: points[index + 1], stroke });
    }
    if (poly.closed && points.length > 2) {
      engineSegments.push({
        a: points[points.length - 1],
        b: points[0],
        stroke,
      });
    }
  }
  if (engineSegments.length > 0) return engineSegments;

  // Keep the small legacy scanner as a fallback for malformed-but-recoverable
  // captures that Atelier correctly declines to turn into drawable polylines.
  const segs: Segment[] = [];
  const tags = svg.match(/<(line|polyline|polygon|rect|path)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const kind = (tag.match(/<(\w+)/) || [])[1].toLowerCase();
    const stroke = strokeOf(tag);
    if (kind === "line") {
      const n = ["x1", "y1", "x2", "y2"].map((k) => Number(attr(tag, k) || 0));
      segs.push({ a: { x: n[0], y: n[1] }, b: { x: n[2], y: n[3] }, stroke });
    } else if (kind === "polyline" || kind === "polygon") {
      const pts = numbers(attr(tag, "points") || "");
      for (let k = 0; k + 3 < pts.length; k += 2) {
        segs.push({ a: { x: pts[k], y: pts[k + 1] }, b: { x: pts[k + 2], y: pts[k + 3] }, stroke });
      }
      if (kind === "polygon" && pts.length >= 4) {
        segs.push({
          a: { x: pts[pts.length - 2], y: pts[pts.length - 1] },
          b: { x: pts[0], y: pts[1] },
          stroke,
        });
      }
    } else if (kind === "rect") {
      const x = Number(attr(tag, "x") || 0);
      const y = Number(attr(tag, "y") || 0);
      const w = Number(attr(tag, "width") || 0);
      const h = Number(attr(tag, "height") || 0);
      const c = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
      for (let k = 0; k < 4; k++) segs.push({ a: c[k], b: c[(k + 1) % 4], stroke });
    } else if (kind === "path") {
      segs.push(...pathSegments(attr(tag, "d") || "", stroke));
    }
  }
  return segs;
}

function assignmentFor(stroke: string, filters: ImportSvgFilter[]): string {
  for (const f of filters) {
    if (f.style.key === "stroke" && stroke && stroke.includes(f.style.value.toLowerCase())) {
      return f.assignment;
    }
  }
  return "B"; // unmatched strokes default to boundary
}

/** Strict interior crossing point of two straight segments, or null (parallel,
 *  collinear, or meeting only at/near an endpoint). Mirrors the reference's
 *  straight-straight branch of _calculateIntersections (general-crossing case). */
function segmentCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < NUMERICAL_TOL) return null; // parallel/collinear (weld handles overlap)
  const qpx = b1.x - a1.x;
  const qpy = b1.y - a1.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  const E = 1e-9;
  if (t <= E || t >= 1 - E || u <= E || u >= 1 - E) return null; // not strictly interior to both
  return { x: a1.x + t * rx, y: a1.y + t * ry };
}

/**
 * Split every edge-edge crossing by inserting a shared vertex and splitting both
 * edges (the reference's splitCuts / _calculateIntersections). Without this,
 * crossing strokes (X-scores, tab-over-panel) are never split, so the half-edge
 * face traversal sees wrong topology and merges or drops panels. `vid` welds the
 * crossing point onto an existing vertex when within tolerance.
 */
function splitIntersections(
  verts: Pt[],
  edges: Array<[number, number]>,
  edgeAssign: string[],
  vid: (p: Pt) => number,
): void {
  let guard = 0;
  const maxSplits = 4 * edges.length + 64;
  let again = true;
  while (again && guard < maxSplits) {
    again = false;
    for (let i = 0; i < edges.length && !again; i += 1) {
      const [a1, a2] = edges[i];
      for (let j = i + 1; j < edges.length; j += 1) {
        const [b1, b2] = edges[j];
        if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue; // shared endpoint
        const p = segmentCross(verts[a1], verts[a2], verts[b1], verts[b2]);
        if (!p) continue;
        const m = vid(p); // welds to an existing vertex if within tolerance
        if (m === a1 || m === a2 || m === b1 || m === b2) continue; // crossing at an endpoint
        edges[i] = [a1, m];
        edges[j] = [b1, m];
        edges.push([m, a2]);
        edgeAssign.push(edgeAssign[i]);
        edges.push([m, b2]);
        edgeAssign.push(edgeAssign[j]);
        guard += 1;
        again = true;
        break;
      }
    }
  }
}

/**
 * Build a FOLD crease pattern from a dieline SVG. Welds near-coincident vertices
 * (tolerance), splits edge-edge crossings, assigns each edge from the
 * stroke-colour `filters`, detects bounded faces via a half-edge planar
 * traversal, and normalizes UVs to the bounding box.
 */
export function buildFoldFromSvg(svg: string, filters: ImportSvgFilter[] = []): ParsedFold {
  const segs = parseSvgSegments(svg).filter((s) => Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y) > 1e-6);

  // Tolerance weld: a spatial hash keyed by round(p / tol); a point merges onto
  // any existing vertex within `tol` distance across the 3x3 neighbour cells.
  // This is the reference's findVertexGroupsWithinTolerance, replacing the old
  // exact 1/1000 grid snap that left sub-pixel-near endpoints split (-> open
  // loops -> dropped panels).
  const verts: Pt[] = [];
  const tol = VERTEX_MERGE_TOL_PX;
  const cells = new Map<string, number[]>();
  const vid = (p: Pt): number => {
    const cx = Math.round(p.x / tol);
    const cy = Math.round(p.y / tol);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = cells.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const id of bucket) {
          if ((verts[id].x - p.x) ** 2 + (verts[id].y - p.y) ** 2 <= tol * tol) return id;
        }
      }
    }
    const id = verts.length;
    verts.push({ x: p.x, y: p.y });
    const k = `${cx}:${cy}`;
    const bucket = cells.get(k);
    if (bucket) bucket.push(id);
    else cells.set(k, [id]);
    return id;
  };

  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  // Build edges from welded endpoints (dedup by vertex pair).
  let edges: Array<[number, number]> = [];
  let edgeAssign: string[] = [];
  const seenE = new Set<string>();
  for (const s of segs) {
    const a = vid(s.a);
    const b = vid(s.b);
    if (a === b) continue; // self-loop (reference E_w7p9): drop
    const k = edgeKey(a, b);
    if (seenE.has(k)) continue;
    seenE.add(k);
    edges.push([a, b]);
    edgeAssign.push(assignmentFor(s.stroke, filters));
  }

  // Split edge-edge crossings (insert shared vertices), then dedup any edge a
  // split happened to recreate.
  splitIntersections(verts, edges, edgeAssign, vid);
  {
    const uniq = new Map<string, number>();
    const e2: Array<[number, number]> = [];
    const a2: string[] = [];
    edges.forEach(([a, b], i) => {
      if (a === b) return;
      const k = edgeKey(a, b);
      if (uniq.has(k)) return;
      uniq.set(k, e2.length);
      e2.push([a, b]);
      a2.push(edgeAssign[i]);
    });
    edges = e2;
    edgeAssign = a2;
  }

  // Edge index lookup for faces_edges, rebuilt from the final (split) edge set.
  const edgeSeen = new Map<string, number>();
  edges.forEach(([a, b], i) => edgeSeen.set(edgeKey(a, b), i));

  // Half-edge planar face detection.
  type Half = { from: number; to: number; angle: number; edge: number };
  const halves: Half[] = [];
  const outByVertex: number[][] = verts.map(() => []);
  edges.forEach(([a, b], ei) => {
    const ab = halves.length;
    halves.push({ from: a, to: b, angle: Math.atan2(verts[b].y - verts[a].y, verts[b].x - verts[a].x), edge: ei });
    outByVertex[a].push(ab);
    const ba = halves.length;
    halves.push({ from: b, to: a, angle: Math.atan2(verts[a].y - verts[b].y, verts[a].x - verts[b].x), edge: ei });
    outByVertex[b].push(ba);
  });
  for (const list of outByVertex) list.sort((p, q) => halves[p].angle - halves[q].angle);
  const twin = (h: number) => h ^ 1; // ab/ba are adjacent pairs
  // next(h): at the target vertex, take the edge clockwise-adjacent to the twin
  // among CCW-sorted outgoing edges, so interior faces trace counter-clockwise.
  const next = (h: number): number => {
    const t = twin(h);
    const around = outByVertex[halves[t].from];
    const idx = around.indexOf(t);
    return around[(idx - 1 + around.length) % around.length];
  };

  const visited = new Array<boolean>(halves.length).fill(false);
  const facesVerts: number[][] = [];
  for (let h = 0; h < halves.length; h++) {
    if (visited[h]) continue;
    const loop: number[] = [];
    let cur = h;
    let guard = 0;
    do {
      visited[cur] = true;
      loop.push(halves[cur].from);
      cur = next(cur);
      guard++;
    } while (cur !== h && guard < halves.length + 1);
    if (loop.length >= 3) {
      // Signed area: keep only counter-clockwise (bounded) faces; drop the
      // single outer face (clockwise / largest).
      let area = 0;
      for (let k = 0; k < loop.length; k++) {
        const p = verts[loop[k]];
        const q = verts[loop[(k + 1) % loop.length]];
        area += p.x * q.y - q.x * p.y;
      }
      if (area > 0) facesVerts.push(loop);
    }
  }

  // faces_edges from consecutive vertex pairs.
  const facesEdges = facesVerts.map((loop) =>
    loop.map((v, k) => edgeSeen.get(edgeKey(v, loop[(k + 1) % loop.length])) ?? -1),
  );

  // Flip Y to convert SVG's Y-down coordinates to Y-up, matching the reference's
  // import wizard (IMPORT_DIELINE_WIZARD_SVG_FLIP_Y = true). Without it the
  // reconstructed flat pattern is mirrored in Y relative to the reference, which
  // inverts the fold's handedness / dihedral signs downstream. Mirror only the
  // output geometry+UVs: face detection above already ran on the original coords,
  // and buildFoldModel re-derives a globally-consistent winding, so the topology
  // is unaffected.
  const coords = verts.map((p) => [p.x, -p.y] as [number, number]);
  const xs = coords.map((p) => p[0]);
  const ys = coords.map((p) => p[1]);
  const minX = Math.min(...xs, 0);
  const minY = Math.min(...ys, 0);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;

  return {
    file_spec: 1.1,
    file_creator: "svgFold",
    frame_classes: ["creasePattern"],
    frame_attributes: ["2D"],
    frame_unit: "px",
    vertices_coords: coords.map((p) => [p[0], p[1]]),
    edges_vertices: edges.map(([a, b]) => [a, b]),
    edges_assignment: edgeAssign,
    faces_edges: facesEdges,
    vertices_uv: coords.map((p) => [(p[0] - minX) / spanX, (p[1] - minY) / spanY]),
  };
}
