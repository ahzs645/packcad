# PackCAD

PackCAD is a React 19 packaging editor built on the local Atelier engine. It imports the
bundled MailerBox PackCAD/FOLD document, solves its rigid-origami fold sequence, renders the
result through Atelier's imperative three.js viewport, records edits in Atelier history, and
exports the folded model or flat dieline.

## Repository map

- `packages/fold-solver/` — app-owned rigid-origami solvers, folding player, thickness rules,
  worker, tests, and the MailerBox golden fixture.
- `packages/packcad-format/` — app-owned PackCAD/FOLD project parsing, SVG crease assignment,
  material taxonomy, and the `PackagingProject` document content type.
- `src/model/` — Atelier command registrations and the PackCAD-to-Atelier drawing adapter.
- `src/render/` — app-owned folded mesh construction and fold-line presentation rules.
- `src/components/` — focused toolbar, inspector, operation, material, and viewport panes.

Atelier packages are workspace-external `file:` dependencies. `three` is pinned to `0.181.2`,
and Vite deduplicates it so the viewport and application always share one runtime instance.

## Commands

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm lint
```

The app intentionally has no production build script in this migration checkpoint. Validation
uses strict TypeScript, Vitest, and ESLint, as requested.

## Solver API shape

`@packcad/fold-solver` exposes an honest synchronous API (`foldNewton`, `foldNewtonSequence`,
`solveFoldTimeline`, `createFoldingPlayer`, and related helpers). Atelier's `SolverPlugin`
contract is a continuous async `step(dt)` runner. PackCAD instead needs an immediate,
deterministic scrub solve followed by a persistent settled solve, so wrapping it as a
`SolverHandle` would hide rather than model its lifecycle.

## R2 triangulation golden

The solver imports `triangulateFace` from `@atelier/geometry`; no `cdt2d` copy remains. The
MailerBox golden records all 100 final Newton-solved vertex positions at eight decimal places.
The migrated run currently reports:

- maximum relative edge error: `5.073250553591979e-8`
- maximum angular error: `0.000005204858961581021°`

The original `packager` comparison could not be executed in the current network-restricted
workspace because `packager/node_modules` is absent and `cdt2d` is not available locally.
This is explicitly **not** a claim of numerical equality with the old `cdt2d` run. Re-run the
original comparison in an environment where `packager` dependencies are installed before
accepting R2.

## Keyboard and interaction

- `Cmd+Z` / `Ctrl+Z` — undo the last command.
- `Cmd+Shift+Z` / `Ctrl+Shift+Z` — redo.
- In 3D, drag to orbit, scroll to zoom, and click the package to select its source face.
- The 2D toggle displays the same folded-scene graph with Atelier's `projection: "2d"`.

## Engine integration notes

- `PickService` returns the rendered triangle index, which maps cleanly through
  `faceIndexByTriangle` to a PackCAD face.
- `ViewportCanvas` only reacts to projection changes. Camera presets, scene contents, and fit
  still require imperative effects; that is appropriate, but a documented React scene
  ownership example would reduce integration work.
- Atelier I/O's neutral `Drawing` makes SVG, DXF, HPGL, tiled PDF, and PNG exports mechanical.
- The engine has no helper that owns and disposes a multi-material application mesh as one
  unit. PackCAD therefore performs explicit geometry/material disposal beside its scene builder.
- `@atelier/io/three` exports a scene object directly, which fits glTF export well.

## Not yet ported

Each omission is visible here rather than represented by a non-working control.

- File-open, save-document, local-draft, share-route, and recovery UI — from
  `packager/src/model/{localDrafts,projectDocument,routeState}.ts` and the corresponding
  sections of `packager/src/App.tsx`.
- Artwork image upload, front/back texture placement, and texture previews — from
  `packager/src/App.tsx`, `packager/src/render/FoldScene.tsx`, and
  `packager/src/render/ThreePreview.tsx`.
- Animated play/pause/loop controls — the player is ported in
  `packages/fold-solver/src/foldingPlayer.ts`; its UI remains in `packager/src/App.tsx`.
- Interactive crease hover, edge-group editing, locked-face authoring, and operation reorder/
  rename controls — command reducers are registered; the remaining controls come from
  `packager/src/App.tsx`, `packager/src/render/FoldScene.tsx`, and
  `packager/src/render/foldLineInteraction.ts`.
- Fat screen-space line rendering and crease hover overlays — from
  `packager/src/render/FatEdges.tsx` and `packager/src/render/FoldScene.tsx`; the vertical
  slice currently uses native three.js line segments.
- Texture files and captured material artwork assets — from `packager/public/assets/`; the
  current vertical slice uses the catalog's material colors and physical thickness.
- Legacy route-level diagnostics and audit `data-*` attributes — from
  `packager/src/render/{DielinePreview,FoldScene,ThreePreview}.tsx`. The F1 descriptor
  scaffolding files were intentionally not ported.
