// `cdt2d` ships no types. It is a devDependency retained ONLY so the R2 parity tests can
// compare the engine's delaunator triangulation against packager's original one; it is not
// used by shipped code. Declaration copied from packager/src/cdt2d.d.ts.
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
