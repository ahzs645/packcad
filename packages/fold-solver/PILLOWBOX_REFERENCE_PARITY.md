# Pillow-box reference parity gate

Run the strict source-parity gate with:

```sh
pnpm parity:pillowbox
```

This command is intentionally separate from `pnpm test`: it is the strict
captured-source gate for this document and must remain green as the solver
evolves.

## Reference input

The immutable K0, K1, and K2 positions in
`src/fixtures/pillowBox.referenceParity.json` were captured from the patched
PackCAD Mockup 1.3.31 mirror while loading `pillowbox.D8DA7TG9.json`. The
canonical JSON SHA-256 is
`9f58c36bdbe73b9a7553eee70393e364733d5055fcd5c22073d6ff42613668fc`.
The downloaded input and `src/fixtures/pillowBox.packcad.json` have the same
canonical hash.

The test maps vertices by UUID, applies the project's authored Y-axis 180°
rotation and points-to-inches conversion, then removes translation by aligning
centroids. It does not fit a free rotation or scale, so incorrect folding
remains visible in the metrics.

## Baseline on 2026-08-04

| State | Vertex RMS | Vertex max | Worst panel RMS | Worst panel normal | Crease RMS | Active max | Carried max |
|---|---:|---:|---:|---:|---:|---:|---:|
| K0 | effectively zero | effectively zero | effectively zero | 0° | effectively zero | 0° | effectively zero |
| K1 | 0.00559 mm | 0.02836 mm | 0.02059 mm | 0.07805° | 0.01956° | 0.01344° | 0.08710° |
| K2 | 0.01293 mm | 0.03467 mm | 0.03080 mm | 0.06535° | 0.01816° | 0.00001° | 0.07896° |

The gate also prints a best-fit rigid diagnostic without using it for
acceptance. Both folded states are inside the envelope. The fixed subset is
identical to the source after aligning its own centroid (RMS `1.24e-11` mm), so
the remaining aggregate error is folding deformation rather than camera or
global-orientation drift.

For localization, each failed folded state prints the eight worst vertex UUIDs,
the eight worst face UUIDs with centroid and normal error, and the twelve worst
crease edges with source/local angles and active status. A convergence audit
also samples K2 at cycles 1, 19, and the source's cycle 117. Once the local
line-search reports `stuck`, later checkpoints are represented by that same
deterministic state rather than repeating rejected dense solve attempts.

The K2 stage audit additionally starts K2 from the aligned immutable source K1
state. That run matches the captured final K2 state to `1.16e-8` mm RMS and
`1.48e-7` mm maximum, demonstrating that the K2 solver path itself is now
effectively exact; the normal replay's small residual is inherited from K1.
It also reports errors around K2's active creases, K1's prior creases, and the
worst inactive/carried crease neighborhoods separately.

The decisive K2 difference was face triangulation. PackCAD reruns cdt2d after
the graph moves by projecting each face's current 3D geometry onto its
`_normal3DApprox` plane. Reusing the flat-pattern diagonals changed the crease
Jacobian topology on 105 of 138 directly mappable crease constraints. Building
K2's triangulation from its incoming K1 geometry reduces the first-cycle error
from `1.05` mm RMS to `1.60e-8` mm RMS and reproduces the source first-cycle
energy to about `2e-7`.

## Acceptance envelope

K0 allows only capture/rounding noise. K1 and K2 must both satisfy:

- vertex RMS at most 0.05 mm and maximum error at most 0.15 mm;
- worst panel RMS at most 0.15 mm and normal difference at most 0.25°;
- crease RMS at most 0.10° and every crease difference at most 0.50°;
- every current-keyframe active crease at most 0.10° from the reference;
- every inactive/carried crease at most 0.50° from the reference.

When a keyframe has `enforcePriorConstraints: false`, only its own explicit
targets are active. Earlier targets are classified as inactive/carried at that
state. In particular, K2's active set is edges 0 and 1; the four K1 end-tuck
edges are included in K2's carried set.

These are parity targets, not inflated snapshots of the existing mismatch.
When a change improves one aggregate while worsening a specific panel or
inactive crease, the corresponding per-part ceiling will keep the gate red.
