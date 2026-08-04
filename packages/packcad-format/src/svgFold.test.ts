import { describe, expect, it } from "vitest";
import pillowBoxFixture from "../../fold-solver/src/fixtures/pillowBox.packcad.json";
import curvedBoxFixture from "../../fold-solver/src/fixtures/curvedBox.packcad.json";
import milkCartonFixture from "../../fold-solver/src/fixtures/milkCarton.packcad.json";
import { buildFoldFromSvg } from "./svgFold";

type Operation = { type: string; svgString?: string; parsedFOLD?: unknown; filters?: unknown };
type Fixture = { design: { operations: Operation[] } };

function importOperation(fixture: unknown): Operation {
  const operations = (fixture as Fixture).design.operations;
  const found = operations.find((operation) => operation.type === "OPERATION_IMPORT_SVG");
  if (!found?.svgString) throw new Error("fixture has no SVG import operation");
  return found;
}

const curvedEdges = (edges: number[][]): number => edges.filter((edge) => edge.length > 2).length;

describe("dieline SVG import", () => {
  // A document that has already been through the reference carries its graph in
  // `parsedFOLD`. Importing the same document's raw SVG has to land on that same
  // graph, otherwise a hand-imported dieline is a different mesh from a bundled
  // one and folds differently.
  it("rebuilds the pillow box's own graph from its SVG alone", () => {
    const operation = importOperation(pillowBoxFixture);
    const embedded = operation.parsedFOLD as {
      vertices_coords: number[][]; edges_vertices: number[][]; faces_edges: number[][];
    };
    const rebuilt = buildFoldFromSvg(operation.svgString as string, []);

    expect(rebuilt.vertices_coords).toHaveLength(embedded.vertices_coords.length);
    expect(rebuilt.edges_vertices).toHaveLength(embedded.edges_vertices.length);
    expect(rebuilt.faces_edges).toHaveLength(embedded.faces_edges.length);
    expect(curvedEdges(rebuilt.edges_vertices)).toBe(curvedEdges(embedded.edges_vertices));
  });

  it("keeps every authored cubic as one curved edge with its two handles", () => {
    const operation = importOperation(pillowBoxFixture);
    const rebuilt = buildFoldFromSvg(operation.svgString as string, []);
    const curved = rebuilt.edges_vertices.filter((edge) => edge.length > 2);

    expect(curved.length).toBeGreaterThan(0);
    // exactly two handles per curved edge, and every index resolves
    for (const edge of curved) {
      expect(edge).toHaveLength(4);
      for (const index of edge.slice(2)) {
        expect(rebuilt.controlPoints_coords?.[index]).toHaveLength(2);
      }
    }
    expect(rebuilt.controlPoints_coords).toHaveLength(curved.length * 2);
  });

  it("does not collapse the two arcs of a lens into one edge", () => {
    // The pillow box's eight arcs come in pairs that share BOTH endpoints. Keyed
    // on endpoints alone, one of each pair is swallowed as a duplicate and only
    // four arcs survive -- 44 curved edges once the score lines cut them into
    // eleven cells apiece, instead of 88.
    const operation = importOperation(pillowBoxFixture);
    const rebuilt = buildFoldFromSvg(operation.svgString as string, []);
    expect(curvedEdges(rebuilt.edges_vertices)).toBe(88);
  });

  it("drops score lines that overhang the panels they cross", () => {
    // Every vertex must be reachable by at least two edges; a degree-1 stub
    // bounds no face (the reference's removeStrayEdges).
    for (const fixture of [pillowBoxFixture, curvedBoxFixture, milkCartonFixture]) {
      const operation = importOperation(fixture);
      const rebuilt = buildFoldFromSvg(operation.svgString as string, []);
      const degree = new Map<number, number>();
      for (const [a, b] of rebuilt.edges_vertices) {
        degree.set(a, (degree.get(a) ?? 0) + 1);
        degree.set(b, (degree.get(b) ?? 0) + 1);
      }
      expect([...degree.values()].filter((count) => count < 2)).toEqual([]);
    }
  });
});
