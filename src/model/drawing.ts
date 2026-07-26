import type { Drawing } from "@atelier/io";
import type { FoldModel } from "@packcad/format";

function millimetresPerUnit(unit: string): number {
  if (unit === "in") return 25.4;
  if (unit === "cm") return 10;
  if (unit === "px") return 25.4 / 72;
  return 1;
}

export function foldModelToDrawing(model: FoldModel): Drawing {
  const scale = millimetresPerUnit(model.coordinateUnit);
  const points = model.verticesCoords.map(([x, y]) => ({
    x: x * scale,
    y: y * scale,
  }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    layers: [
      { id: "cut", name: "Cut", style: { color: "#111111", width: 0.3 } },
      {
        id: "crease",
        name: "Crease",
        style: { color: "#c83f36", width: 0.25, dashed: true },
      },
    ],
    polys: model.edgesVertices.map(([a, b], edgeIndex) => ({
      pts: [points[a], points[b]],
      closed: false,
      layer: model.edgeFaces[edgeIndex]?.length === 1 ? "cut" : "crease",
    })),
    texts: [],
    boundsMm: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
  };
}
