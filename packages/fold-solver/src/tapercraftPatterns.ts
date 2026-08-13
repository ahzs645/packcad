import {
  packCadProjectToProject,
  type PackCadProjectFile,
  type PackagingProject,
  type ParsedFold,
} from "@packcad/format";

type Point = [number, number];

type FaceDefinition = {
  name: string;
  loop: Point[];
};

type FoldingStageDefinition = {
  id: string;
  name: string;
  facePairs: Array<[string, string]>;
  angle: number;
  glueFaces?: string[];
};

type PatternDefinition = {
  id: string;
  name: string;
  fileName: string;
  width: number;
  height: number;
  outlinePaths: Point[][];
  faces: FaceDefinition[];
  creases?: Array<[Point, Point]>;
  stages?: FoldingStageDefinition[];
  glueFaces?: string[];
  cornerRadius?: number;
};

function uuid(namespace: number, index: number): string {
  return `${String(namespace).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function pointKey([x, y]: Point): string {
  return `${x.toFixed(5)}:${y.toFixed(5)}`;
}

function normalizedPair(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function svgPoint([x, y]: Point, pageHeight: number, margin: number): string {
  return `${((x + margin) * 72).toFixed(3)},${((pageHeight - y + margin) * 72).toFixed(3)}`;
}

function svgPath(points: Point[], pageHeight: number, margin: number): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${svgPoint(point, pageHeight, margin)}`).join(" ") + " Z";
}

function buildPatternProject(definition: PatternDefinition): PackagingProject {
  const vertices: Point[] = [];
  const vertexIndex = new Map<string, number>();
  const faceLoops: number[][] = [];
  const vertex = (point: Point): number => {
    const key = pointKey(point);
    const found = vertexIndex.get(key);
    if (found !== undefined) return found;
    const index = vertices.length;
    vertexIndex.set(key, index);
    vertices.push(point);
    return index;
  };

  for (const face of definition.faces) faceLoops.push(face.loop.map(vertex));

  const edges: Array<[number, number]> = [];
  const edgeFaces: number[][] = [];
  const edgeIndex = new Map<string, number>();
  const facesEdges: number[][] = [];
  const facesEdgesOrientation: boolean[][] = [];
  faceLoops.forEach((loop, faceIndex) => {
    const faceEdges: number[] = [];
    const orientations: boolean[] = [];
    loop.forEach((a, index) => {
      const b = loop[(index + 1) % loop.length];
      const key = normalizedPair(a, b);
      let current = edgeIndex.get(key);
      if (current === undefined) {
        current = edges.length;
        edgeIndex.set(key, current);
        edges.push([a, b]);
        edgeFaces.push([]);
      }
      faceEdges.push(current);
      orientations.push(edges[current][0] === a);
      edgeFaces[current].push(faceIndex);
    });
    facesEdges.push(faceEdges);
    facesEdgesOrientation.push(orientations);
  });

  const vertexIDs = vertices.map((_, index) => uuid(20, index));
  const faceIDs = definition.faces.map((_, index) => uuid(21, index));
  const faceIndexByName = new Map(definition.faces.map((face, index) => [face.name, index]));
  const sharedEdge = (leftName: string, rightName: string): number => {
    const left = faceIndexByName.get(leftName);
    const right = faceIndexByName.get(rightName);
    if (left === undefined || right === undefined) throw new Error(`Unknown face pair: ${leftName}/${rightName}`);
    const match = facesEdges[left].find((edge) => facesEdges[right].includes(edge));
    if (match === undefined) throw new Error(`Faces do not share an edge: ${leftName}/${rightName}`);
    return match;
  };
  const edgeID = (index: number): string => {
    const [a, b] = edges[index];
    return `${vertexIDs[a]}-${vertexIDs[b]}`;
  };

  const margin = 0.25;
  const pageWidth = definition.width + margin * 2;
  const pageHeight = definition.height + margin * 2;
  const outlineMarkup = definition.cornerRadius
    ? definition.faces.map((face) => {
        const xs = face.loop.map(([x]) => x);
        const ys = face.loop.map(([, y]) => y);
        const x = (Math.min(...xs) + margin) * 72;
        const y = (definition.height - Math.max(...ys) + margin) * 72;
        return `  <rect class="cut" x="${x}" y="${y}" width="${(Math.max(...xs) - Math.min(...xs)) * 72}" height="${(Math.max(...ys) - Math.min(...ys)) * 72}" rx="${definition.cornerRadius! * 72}"/>`;
      }).join("\n")
    : definition.outlinePaths.map((points) =>
        `  <path class="cut" d="${svgPath(points, definition.height, margin)}"/>`).join("\n");
  const creaseMarkup = (definition.creases ?? []).map(([a, b]) =>
    `  <line class="crease" x1="${svgPoint(a, definition.height, margin).replace(",", '" y1="')}" x2="${svgPoint(b, definition.height, margin).replace(",", '" y2="')}"/>`).join("\n");
  const glueMarkup = (definition.glueFaces ?? []).flatMap((name) => {
    const face = definition.faces.find((item) => item.name === name);
    return face ? [`  <polygon class="glue-zone" points="${face.loop.map((point) => svgPoint(point, definition.height, margin)).join(" ")}"/>`] : [];
  }).join("\n");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageWidth * 72} ${pageHeight * 72}" width="${pageWidth}in" height="${pageHeight}in">
  <title>${definition.name}</title>
  <desc>Clean vector trace of a public TaperCraft template mask. Black cuts, red creases, amber hatching glue.</desc>
  <defs><pattern id="glue-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#fff7df"/><line x1="0" y1="0" x2="0" y2="8" stroke="#d97706" stroke-width="2"/></pattern></defs>
  <style>.cut,.crease{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.5}.cut{stroke:#000}.crease{stroke:#f00}.glue-zone{fill:url(#glue-hatch);stroke:none;opacity:.8}</style>
  <rect width="100%" height="100%" fill="#fff"/>
${glueMarkup}
${outlineMarkup}
${creaseMarkup}
</svg>
`;

  const parsedFOLD: ParsedFold = {
    file_spec: 1.2,
    file_creator: "PackCAD TaperCraft pattern importer",
    file_classes: ["singleModel"],
    frame_classes: ["creasePattern"],
    frame_attributes: ["2D"],
    frame_unit: "in",
    vertices_coords: vertices,
    edges_vertices: edges,
    edges_assignment: edgeFaces.map((faces) => faces.length > 1 ? "U" : "B"),
    faces_edges: facesEdges,
    faces_edges_orientation: facesEdgesOrientation,
    vertices_uv: vertices.map(([x, y]) => [x / definition.width, y / definition.height]),
  };

  const stages = (definition.stages ?? []).map((stage, index) => ({
    id: uuid(23, index),
    type: "OPERATION_ORIGAMI_SIMULATION" as const,
    name: stage.name,
    enabled: true,
    foldingEdgeGroups: [{
      edgeIDs: stage.facePairs.map(([a, b]) => edgeID(sharedEdge(a, b))),
      targetAngleDegrees: stage.angle,
      enabled: true,
    }],
    fixedVertexIDs: [],
    fixedFaceIDs: [faceIDs[Math.min(1, faceIDs.length - 1)]],
    glueFaceIDs: (stage.glueFaces ?? []).flatMap((name) => {
      const index = faceIndexByName.get(name);
      return index === undefined ? [] : [faceIDs[index]];
    }),
    enforcePriorConstraints: false,
  }));

  const file: PackCadProjectFile = {
    app_version: "0.1.0",
    app_id: "PACKCAD_MOCKUP",
    design: {
      id: uuid(24, definition.id.length),
      name: definition.name,
      units: "in",
      operations: [
        {
          id: uuid(22, 0),
          type: "OPERATION_IMPORT_SVG",
          name: `Import ${definition.name}`,
          enabled: true,
          filename: definition.fileName,
          svgString: svg,
          preferredUnits: "in",
          filters: [{ style: { key: "stroke", value: "red", tolerance: 0.1 }, assignment: "U" }],
          parsedFOLD,
          verticesAdded: vertexIDs,
          facesAdded: faceIDs,
        },
        {
          id: uuid(22, 1),
          type: "OPERATION_FOLDING_SETUP",
          name: "Folding Setup",
          enabled: true,
          fixedFaceID: faceIDs[Math.min(1, faceIDs.length - 1)],
        },
        ...stages,
      ],
      modifiers: {},
    },
  };
  return packCadProjectToProject(file);
}

function rectangle(name: string, x1: number, y1: number, x2: number, y2: number): FaceDefinition {
  return { name, loop: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] };
}

const betamaxOutline: Point[] = [[1.275,7.62],[1.18,7.54],[1.115,7.455],[1.065,7.36],[1.03,7.245],[1.005,6.92],[1,6.225],[0.93,6.23],[0.885,6.27],[0.845,6.92],[0.24,6.915],[0.215,6.88],[0.19,6.805],[0.12,6.47],[0,6.37],[0,0],[0.18,0],[0.19,0.055],[0.22,0.115],[0.28,0.18],[0.375,0.235],[0.485,0.26],[0.59,0.25],[0.675,0.215],[0.725,0.18],[0.795,0.1],[0.83,0],[4.95,0],[4.99,0.1],[5.035,0.155],[5.145,0.225],[5.22,0.245],[5.335,0.245],[5.47,0.195],[5.56,0.11],[5.595,0.045],[5.605,0],[9.66,0],[9.72,0.12],[9.81,0.195],[9.93,0.24],[10.03,0.245],[10.03,5.955],[9.56,6.1],[5.78,6.1],[5.78,6.375],[5.65,6.49],[5.59,6.82],[5.575,6.87],[5.54,6.92],[4.935,6.92],[4.895,6.275],[4.87,6.23],[4.775,6.23],[4.775,6.95],[4.755,7.24],[4.725,7.35],[4.67,7.46],[4.615,7.535],[4.525,7.62]];
const vhsSlipcoverOutline: Point[] = [[1.275,9.18],[1.1127,9.0177],[1.02,8.7859],[1.0045,7.5341],[0.9427,7.5341],[0.8886,7.5727],[0.8423,8.2295],[0.2473,8.2295],[0.1932,8.1445],[0.1159,7.7736],[0,7.6886],[0.0077,0],[0.1855,0.0077],[0.2164,0.1159],[0.2936,0.1932],[0.3786,0.2395],[0.4868,0.2627],[0.6259,0.2395],[0.7186,0.1855],[0.7959,0.1005],[0.8268,0],[5.2932,0],[5.3705,0.1468],[5.4709,0.2164],[5.5868,0.2473],[5.7182,0.2395],[5.7955,0.2086],[5.8959,0.1236],[5.9577,0],[10.3623,0],[10.3932,0.0773],[10.4705,0.17],[10.6173,0.2395],[10.7332,0.2473],[10.7332,7.2636],[10.2695,7.4105],[6.1355,7.4105],[6.1355,7.6732],[5.9964,7.7968],[5.9423,8.1214],[5.8882,8.2295],[5.2777,8.2295],[5.2391,7.5805],[5.2159,7.5418],[5.1232,7.5341],[5.1232,8.4768],[5.1077,8.7859],[5.0382,8.9868],[4.9532,9.1105],[4.8759,9.18]];

function slipcoverDefinition(kind: "betamax" | "vhs"): PatternDefinition {
  const isVhs = kind === "vhs";
  const xs = isVhs ? [0, 1.0045, 5.1232, 6.1355, 10.2695, 10.7332] : [0, 1, 4.775, 5.78, 9.56, 10.03];
  const bodyTop = isVhs ? 7.4105 : 6.1;
  const height = isVhs ? 9.18 : 7.62;
  const frontFlapTop = isVhs ? 9.18 : 7.62;
  const spineFlapTop = isVhs ? 8.2295 : 6.92;
  const faces: FaceDefinition[] = [
    rectangle("Left glue flap", xs[0], 0, xs[1], bodyTop),
    rectangle("Front", xs[1], 0, xs[2], bodyTop),
    rectangle("Spine", xs[2], 0, xs[3], bodyTop),
    rectangle("Back", xs[3], 0, xs[4], bodyTop),
    rectangle("Right glue flap", xs[4], 0, xs[5], bodyTop),
    { name: "Front closure flap", loop: [[xs[1], bodyTop], [xs[2], bodyTop], [xs[2] - 0.6, frontFlapTop], [xs[1] + 0.27, frontFlapTop]] },
    { name: "Spine closure flap", loop: [[xs[2], bodyTop], [xs[3], bodyTop], [xs[3] - 0.24, spineFlapTop], [xs[2] + 0.15, spineFlapTop]] },
  ];
  return {
    id: `${kind}-slipcover`,
    name: isVhs ? "VHS Slipcover" : "Betamax Slipcover",
    fileName: `${kind}-slipcover-traced.svg`,
    width: xs[5],
    height,
    outlinePaths: [isVhs ? vhsSlipcoverOutline : betamaxOutline],
    faces,
    creases: [
      ...xs.slice(1, 5).map((x) => [[x, 0], [x, bodyTop]] as [Point, Point]),
      [[xs[1], bodyTop], [xs[2], bodyTop]],
      [[xs[2], bodyTop], [xs[3], bodyTop]],
    ],
    glueFaces: ["Left glue flap", "Right glue flap"],
    stages: [
      { id: "body", name: "Form sleeve body", facePairs: [["Front", "Spine"], ["Spine", "Back"]], angle: 90 },
      { id: "seam", name: "Close and glue side seam", facePairs: [["Left glue flap", "Front"], ["Back", "Right glue flap"]], angle: 90, glueFaces: ["Left glue flap", "Right glue flap"] },
      { id: "closure", name: "Fold end closure", facePairs: [["Front", "Front closure flap"], ["Spine", "Spine closure flap"]], angle: 90 },
    ],
  };
}

function sheetDefinition(
  id: string,
  name: string,
  width: number,
  height: number,
  boxes: Array<[number, number, number, number]>,
): PatternDefinition {
  const faces = boxes.map(([x1, y1, x2, y2], index) => rectangle(`Piece ${index + 1}`, x1, height - y2, x2, height - y1));
  return {
    id,
    name,
    fileName: `${id}.svg`,
    width,
    height,
    faces,
    outlinePaths: faces.map((face) => face.loop),
    cornerRadius: 0.08,
  };
}

const vhsMainBoxes: Array<[number, number, number, number]> = [
  [1.0586,.9234,4.1341,2.7548],[4.3659,.9234,7.4414,2.7548],
  [1.0586,2.7664,4.1341,4.5784],[4.3659,2.7664,7.4414,4.5784],
  [1.0586,4.5939,4.1341,6.4098],[4.3659,4.5939,7.4414,6.4098],
  [1.0586,6.4214,4.1341,8.2373],[4.3659,6.4214,7.4414,8.2373],
  [1.0586,8.2527,4.1341,10.0841],[4.3659,8.2527,7.4414,10.0841],
];
const vhsSpineBoxes = Array.from({ length: 15 }, (_, index) => {
  const y1 = .4636 + index * .6723;
  return [1.333, y1, 7.1632, y1 + .653] as [number, number, number, number];
});
const cassetteBoxes = [0.5039, 4.5084].flatMap((x, column) => Array.from({ length: 6 }, (_, row) => {
  const y1 = .5427 + row * ((10.5015 - .5427) / 6);
  return [x, y1, column === 0 ? 4.0199 : 8.0205, y1 + ((10.5015 - .5427) / 6)] as [number, number, number, number];
}));
const minidiscBoxes: Array<[number, number, number, number]> = [];
for (const y of [.4093, 3.019, 5.6287]) {
  for (const x of [.6857, 2.445, 4.199, 5.9689]) minidiscBoxes.push([x, y, x + (x === 2.445 ? 1.5626 : 1.5573), y + 2.2324]);
}
for (const y of [.287, 2.8968, 5.5065]) {
  for (const x of [8.1162, 8.7381, 9.36, 9.9872]) minidiscBoxes.push([x, y, x + .303, y + 2.4769]);
}

export function createBetamaxSlipcoverProject(): PackagingProject {
  return buildPatternProject(slipcoverDefinition("betamax"));
}

export function createVhsSlipcoverProject(): PackagingProject {
  return buildPatternProject(slipcoverDefinition("vhs"));
}

export function createVhsFaceLabelSheetProject(): PackagingProject {
  return buildPatternProject(sheetDefinition("vhs-face-label-sheet", "VHS Face Label Sheet", 8.5, 11, vhsMainBoxes));
}

export function createVhsSpineLabelSheetProject(): PackagingProject {
  return buildPatternProject(sheetDefinition("vhs-spine-label-sheet", "VHS Spine Label Sheet", 8.5, 11, vhsSpineBoxes));
}

export function createCassetteLabelSheetProject(): PackagingProject {
  return buildPatternProject(sheetDefinition("cassette-label-sheet", "Cassette Label Sheet", 8.5283, 11.0287, cassetteBoxes));
}

export function createMiniDiscLabelSheetProject(): PackagingProject {
  return buildPatternProject(sheetDefinition("minidisc-label-sheet", "MiniDisc Label Sheet", 11.6933, 8.2704, minidiscBoxes));
}
