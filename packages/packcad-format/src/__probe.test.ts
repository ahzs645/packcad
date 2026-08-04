import { appendFileSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { buildFoldFromSvg } from "./svgFold";
import { buildFoldModel } from "./foldGeometry";
import { packCadProjectToProject } from "./packcadProject";

const cases = [
  ["curved box", "/Users/ahmadjalil/Downloads/curvedbox.Dp6qF5YV.json", "202 / 281 / 80, 154 curved"],
  ["pillow box", "/Users/ahmadjalil/Downloads/pillowbox.D8DA7TG9.json", "176 / 242 / 67, 176 curved"],
  ["milk carton", "/Users/ahmadjalil/Downloads/milk_carton.Dqp7XjYa.json", "53 / 77 / 25, 8 curved"],
];

describe("fresh-SVG import vs embedded FOLD", () => {
  it("compares the two paths", () => {
    const rows: string[] = [];
    for (const [name, path, expected] of cases) {
      const doc = JSON.parse(readFileSync(path, "utf8"));
      const op = doc.design.operations.find((o: { type: string }) => o.type === "OPERATION_IMPORT_SVG");
      const raw = buildFoldFromSvg(op.svgString, op.filters ?? []);
      const curvedRaw = raw.edges_vertices.filter((e: number[]) => e.length > 2).length;

      // now run it through the same model builder the bundled path uses
      const stripped = JSON.parse(JSON.stringify(doc));
      const strippedOp = stripped.design.operations.find((o: { type: string }) => o.type === "OPERATION_IMPORT_SVG");
      delete strippedOp.parsedFOLD;
      delete strippedOp.verticesAdded;
      delete strippedOp.facesAdded;
      const fromSvgModel = buildFoldModel(packCadProjectToProject(stripped).design!);
      const embedded = buildFoldModel(packCadProjectToProject(doc).design!);

      rows.push(
        `${name}\n` +
        `  raw SVG graph      ${raw.vertices_coords.length} v / ${raw.edges_vertices.length} e / ${raw.faces_edges.length} f, ${curvedRaw} curved\n` +
        `  via SVG  -> model  ${fromSvgModel ? `${fromSvgModel.verticesCoords.length} / ${fromSvgModel.edgesVertices.length} / ${fromSvgModel.facesVertices.length}, ${fromSvgModel.edgeControlPoints?.filter((c) => c.length > 0).length} curved` : "null"}\n` +
        `  embedded -> model  ${embedded ? `${embedded.verticesCoords.length} / ${embedded.edgesVertices.length} / ${embedded.facesVertices.length}, ${embedded.edgeControlPoints?.filter((c) => c.length > 0).length} curved` : "null"}   (reference: ${expected})`);
    }
    appendFileSync("/tmp/packcad-cmp.txt", rows.join("\n") + "\n");
  }, 300_000);
});
