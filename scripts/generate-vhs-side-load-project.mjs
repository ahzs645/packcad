import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../artifacts/vhs-side-load");
const fixturePath = resolve(
  scriptDirectory,
  "../packages/fold-solver/src/fixtures/sideLoadVhs.packcad.json",
);

// Outer contour vector-traced from the public 11x17 TaperCraft/Photopea
// silhouette at 600dpi, then simplified to sub-0.01in accuracy. Keeping this
// contour separate from the crease graph lets the printable export retain the
// source's tapered flap cuts instead of collapsing them into rectangles.
const outline = [
  [0.7067, 9.42], [4.8667, 9.42], [4.8667, 8.48],
  [4.9533, 9.3667], [5.7933, 9.3667], [5.8667, 8.4067],
  [5.96, 9.12], [9.84, 9.12], [10, 8.3933],
  [10.6933, 8.2933], [10.6933, 1.06], [10, 0.9933],
  [9.84, 0.2467], [5.9533, 0.2467], [5.88, 0.92],
  [5.8667, 0.96], [5.8067, 0.0867], [4.9533, 0.0867],
  [4.8667, 0.92], [4.8667, 0], [0.7067, 0],
  [0.7067, 0.9933], [0, 1.0867], [0, 8.3], [0.7067, 8.3933],
];
const xs = [0, 0.7067, 4.8667, 5.8667, 10, 10.6933];
const bodyBottom = 1;
const bodyTop = 8.4;
const topOuter = 9.42;

const vertices = [];
const vertexKeys = new Map();
const faces = [];

function vertex(x, y, key = `${x}:${y}`) {
  const existing = vertexKeys.get(key);
  if (existing !== undefined) return existing;
  const index = vertices.length;
  vertices.push([x, y]);
  vertexKeys.set(key, index);
  return index;
}

function addFace(name, loop) {
  faces.push({ name, loop });
}

const bodyVertices = xs.map((x) => ({
  bottom: vertex(x, bodyBottom, `body:${x}:bottom`),
  top: vertex(x, bodyTop, `body:${x}:top`),
}));

// The two seam panels follow the source's angled side cuts. These are the glue
// tabs; the three central panels remain orthogonal so their box dimensions are
// stable when folded.
addFace("Left glue flap", [
  vertex(0, 1.0867, "left:outer-bottom"),
  bodyVertices[1].bottom,
  bodyVertices[1].top,
  vertex(0, 8.3, "left:outer-top"),
]);
for (let index = 1; index < 4; index += 1) {
  addFace(["Front", "Spine", "Back"][index - 1], [
    bodyVertices[index].bottom,
    bodyVertices[index + 1].bottom,
    bodyVertices[index + 1].top,
    bodyVertices[index].top,
  ]);
}
addFace("Right glue flap", [
  bodyVertices[4].bottom,
  vertex(10.6933, 1.06, "right:outer-bottom"),
  vertex(10.6933, 8.2933, "right:outer-top"),
  bodyVertices[4].top,
]);

addFace("Front top flap", [
  bodyVertices[1].top, bodyVertices[2].top,
  vertex(4.8667, 9.42, "front-top:right"),
  vertex(0.7067, 9.42, "front-top:left"),
]);
addFace("Spine top flap", [
  bodyVertices[2].top, bodyVertices[3].top,
  vertex(5.7933, 9.3667, "spine-top:right"),
  vertex(4.9533, 9.3667, "spine-top:left"),
]);
addFace("Back top flap", [
  bodyVertices[3].top, bodyVertices[4].top,
  vertex(9.84, 9.12, "back-top:right"),
  vertex(5.96, 9.12, "back-top:left"),
]);
addFace("Front bottom flap", [
  vertex(0.7067, 0, "front-bottom:left"),
  vertex(4.8667, 0, "front-bottom:right"),
  bodyVertices[2].bottom, bodyVertices[1].bottom,
]);
addFace("Spine bottom flap", [
  vertex(4.9533, 0.0867, "spine-bottom:left"),
  vertex(5.8067, 0.0867, "spine-bottom:right"),
  bodyVertices[3].bottom, bodyVertices[2].bottom,
]);
addFace("Back bottom flap", [
  vertex(5.9533, 0.2467, "back-bottom:left"),
  vertex(9.84, 0.2467, "back-bottom:right"),
  bodyVertices[4].bottom, bodyVertices[3].bottom,
]);

const edges = [];
const edgeFaces = [];
const edgeIndexByPair = new Map();
const facesEdges = [];
const facesEdgesOrientation = [];

function normalizedPair(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
  const loop = faces[faceIndex].loop;
  const faceEdges = [];
  const orientations = [];
  for (let index = 0; index < loop.length; index += 1) {
    const a = loop[index];
    const b = loop[(index + 1) % loop.length];
    const key = normalizedPair(a, b);
    let edgeIndex = edgeIndexByPair.get(key);
    if (edgeIndex === undefined) {
      edgeIndex = edges.length;
      edgeIndexByPair.set(key, edgeIndex);
      edges.push([a, b]);
      edgeFaces.push([]);
    }
    faceEdges.push(edgeIndex);
    orientations.push(edges[edgeIndex][0] === a && edges[edgeIndex][1] === b);
    edgeFaces[edgeIndex].push(faceIndex);
  }
  facesEdges.push(faceEdges);
  facesEdgesOrientation.push(orientations);
}

function uuid(namespace, index) {
  return `${namespace}${String(index).padStart(7, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const vertexIDs = vertices.map((_, index) => uuid("0", index));
const faceIDs = faces.map((_, index) => uuid("1", index));

function sharedEdge(faceNameA, faceNameB) {
  const a = faces.findIndex((face) => face.name === faceNameA);
  const b = faces.findIndex((face) => face.name === faceNameB);
  const match = facesEdges[a].find((edgeIndex) => facesEdges[b].includes(edgeIndex));
  if (match === undefined) throw new Error(`No shared edge: ${faceNameA} / ${faceNameB}`);
  return match;
}

function edgeID(edgeIndex) {
  const [a, b] = edges[edgeIndex];
  return `${vertexIDs[a]}-${vertexIDs[b]}`;
}

function edgeGroup(edgeIndices, targetAngleDegrees) {
  return {
    edgeIDs: edgeIndices.map(edgeID),
    targetAngleDegrees,
    enabled: true,
  };
}

const bodyFoldEdges = [
  sharedEdge("Front", "Spine"),
  sharedEdge("Spine", "Back"),
];
const sideSeamEdges = [
  sharedEdge("Left glue flap", "Front"),
  sharedEdge("Back", "Right glue flap"),
];
const topFlapEdges = [
  sharedEdge("Front", "Front top flap"),
  sharedEdge("Spine", "Spine top flap"),
  sharedEdge("Back", "Back top flap"),
];
const bottomFlapEdges = [
  sharedEdge("Front", "Front bottom flap"),
  sharedEdge("Spine", "Spine bottom flap"),
  sharedEdge("Back", "Back bottom flap"),
];

const pageMargin = 0.25;
const pageWidth = xs.at(-1) + pageMargin * 2;
const pageHeight = topOuter + pageMargin * 2;
const pxPerInch = 72;
const toSvgPoint = ([x, y]) => [
  (x + pageMargin) * pxPerInch,
  (topOuter - y + pageMargin) * pxPerInch,
];
const outlinePath = outline.map((point, index) => {
  const [x, y] = toSvgPoint(point);
  return `${index === 0 ? "M" : "L"}${x.toFixed(3)} ${y.toFixed(3)}`;
}).join(" ") + " Z";
const creaseLines = edges.flatMap(([a, b], edgeIndex) => {
  if (edgeFaces[edgeIndex].length < 2) return [];
  const [ax, ay] = vertices[a];
  const [bx, by] = vertices[b];
  const x1 = (ax + pageMargin) * pxPerInch;
  const y1 = (topOuter - ay + pageMargin) * pxPerInch;
  const x2 = (bx + pageMargin) * pxPerInch;
  const y2 = (topOuter - by + pageMargin) * pxPerInch;
  return [`  <line class="crease" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`];
});
const glueFaceNames = ["Left glue flap", "Right glue flap"];
const glueZones = glueFaceNames.map((name) => {
  const face = faces.find((item) => item.name === name);
  const points = face.loop.map((index) => toSvgPoint(vertices[index]).join(",")).join(" ");
  return `  <polygon class="glue-zone" points="${points}"/>`;
});

const outlineOnlySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageWidth * pxPerInch} ${pageHeight * pxPerInch}" width="${pageWidth}in" height="${pageHeight}in">
  <title>Side-load VHS slipcover traced cut outline</title>
  <desc>Vector trace of the public TaperCraft side-load VHS template silhouette.</desc>
  <rect width="100%" height="100%" fill="#fff"/>
  <path d="${outlinePath}" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>
</svg>
`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageWidth * pxPerInch} ${pageHeight * pxPerInch}" width="${pageWidth}in" height="${pageHeight}in">
  <title>Side-load VHS slipcover dieline</title>
  <desc>Vector-traced from the public TaperCraft side-load VHS silhouette. Black line cuts; red lines crease; amber hatching marks glue or tape.</desc>
  <defs>
    <pattern id="glue-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="8" height="8" fill="#fff7df"/>
      <line x1="0" y1="0" x2="0" y2="8" stroke="#d97706" stroke-width="2"/>
    </pattern>
  </defs>
  <style>
    .cut, .crease { fill: none; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
    .cut { stroke: #000; }
    .crease { stroke: #f00; }
    .glue-zone { fill: url(#glue-hatch); stroke: none; opacity: 0.8; }
  </style>
  <rect width="100%" height="100%" fill="#fff"/>
${glueZones.join("\n")}
  <path class="cut" d="${outlinePath}" fill="none" stroke="#000"/>
${creaseLines.join("\n")}
</svg>
`;

function foldingOperation(id, name, groups, glueFaceIndices = []) {
  return {
    id,
    type: "OPERATION_ORIGAMI_SIMULATION",
    name,
    enabled: true,
    foldingEdgeGroups: groups,
    fixedVertexIDs: [],
    fixedFaceIDs: [faceIDs[1]],
    glueFaceIDs: glueFaceIndices.map((index) => faceIDs[index]),
    enforcePriorConstraints: false,
  };
}

const project = {
  app_version: "0.1.0",
  app_id: "PACKCAD_MOCKUP",
  design: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Side-load VHS Slipcover",
    units: "in",
    operations: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        type: "OPERATION_IMPORT_SVG",
        name: "Import VHS dieline",
        enabled: true,
        filename: "side-load-vhs-clean.svg",
        svgString: svg,
        preferredUnits: "in",
        filters: [
          {
            style: { key: "stroke", value: "red", tolerance: 0.1 },
            assignment: "U",
          },
        ],
        parsedFOLD: {
          file_spec: 1.2,
          file_creator: "PackCAD VHS template generator",
          file_classes: ["singleModel"],
          frame_classes: ["creasePattern"],
          frame_attributes: ["2D"],
          frame_unit: "in",
          vertices_coords: vertices,
          edges_vertices: edges,
          edges_assignment: edgeFaces.map((adjacentFaces) => adjacentFaces.length > 1 ? "U" : "B"),
          faces_edges: facesEdges,
          faces_edges_orientation: facesEdgesOrientation,
          vertices_uv: vertices.map(([x, y]) => [x / xs.at(-1), y / topOuter]),
        },
        verticesAdded: vertexIDs,
        facesAdded: faceIDs,
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        type: "OPERATION_FOLDING_SETUP",
        name: "Folding Setup",
        enabled: true,
        fixedFaceID: faceIDs[1],
      },
      foldingOperation(
        "30000000-0000-4000-8000-000000000003",
        "Form sleeve body",
        [edgeGroup(bodyFoldEdges, 90)],
      ),
      foldingOperation(
        "30000000-0000-4000-8000-000000000004",
        "Close and glue side seam",
        [edgeGroup(sideSeamEdges, 90)],
        [0, 4],
      ),
      foldingOperation(
        "30000000-0000-4000-8000-000000000005",
        "Fold top flaps",
        [edgeGroup(topFlapEdges, 90)],
      ),
      foldingOperation(
        "30000000-0000-4000-8000-000000000006",
        "Fold bottom flaps",
        [edgeGroup(bottomFlapEdges, 90)],
      ),
    ],
    modifiers: {
      OPERATION_THICKNESS: {
        id: "OPERATION_THICKNESS",
        type: "OPERATION_THICKNESS",
        name: "Thickness",
        enabled: true,
        materialType: "MATERIAL_KRAFT_PAPERBOARD",
        thickness: 0.018,
        thicknessOffsetDirection: "THICKNESS_OFFSET_DIRECTION_BACK",
        materialRotationDegrees: 0,
      },
    },
  },
};

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "side-load-vhs-clean.svg"), svg);
writeFileSync(resolve(outputDirectory, "side-load-vhs-outline.svg"), outlineOnlySvg);
writeFileSync(
  resolve(outputDirectory, "side-load-vhs.packcad.json"),
  `${JSON.stringify(project, null, 2)}\n`,
);
writeFileSync(fixturePath, `${JSON.stringify(project, null, 2)}\n`);

console.log(`Generated ${faces.length} faces, ${edges.length} edges, and ${vertices.length} vertices.`);
console.log(resolve(outputDirectory, "side-load-vhs-clean.svg"));
console.log(resolve(outputDirectory, "side-load-vhs-outline.svg"));
console.log(resolve(outputDirectory, "side-load-vhs.packcad.json"));
console.log(fixturePath);
