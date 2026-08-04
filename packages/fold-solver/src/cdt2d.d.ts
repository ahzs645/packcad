// `cdt2d` ships no types. Declaration copied from packager/src/cdt2d.d.ts for
// the production face-triangulation path and its source-parity tests.
declare module "cdt2d" {
  export type Cdt2dOptions = {
    delaunay?: boolean;
    interior?: boolean;
    exterior?: boolean;
    infinity?: boolean;
  };

  export default function cdt2d(
    points: number[][],
    edges?: Array<[number, number]>,
    options?: Cdt2dOptions,
  ): Array<[number, number, number]>;
}
