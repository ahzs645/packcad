// Editable operation pipeline.
//
// The captured PackCAD design is an ordered operation list plus a keyed
// modifier map. These pure mutations let the editor toggle, rename, and reorder
// operations and toggle modifiers, then re-derive the fold model / steps /
// material from the edited design (via deriveFromDesign). Source-owned: no
// captured runtime is involved.

import type {
  OrigamiSimulationOperation,
  PackCadDesign,
  PackCadOperation,
  PackagingProject,
} from "@packcad/format";
import { deriveFromDesign } from "@packcad/format";

function cloneDesign(design: PackCadDesign): PackCadDesign {
  return {
    ...design,
    operations: design.operations.map((op) => ({ ...op })),
    modifiers: { ...design.modifiers },
  };
}

/** Apply an edited design back onto a project, re-deriving fold/material state. */
export function applyDesign(project: PackagingProject, design: PackCadDesign): PackagingProject {
  const derived = deriveFromDesign(design);
  const activeStepId = derived.foldingSteps?.some((step) => step.id === project.activeStepId)
    ? project.activeStepId
    : (derived.activeStepId ?? derived.foldingSteps?.[0]?.id ?? project.activeStepId);
  return { ...project, ...derived, activeStepId };
}

function withOperations(
  project: PackagingProject,
  update: (operations: PackCadOperation[]) => PackCadOperation[],
): PackagingProject {
  if (!project.design) return project;
  const design = cloneDesign(project.design);
  design.operations = update(design.operations);
  return applyDesign(project, design);
}

/** Toggle an operation's `enabled` flag. */
export function toggleOperation(project: PackagingProject, operationId: string): PackagingProject {
  return withOperations(project, (operations) =>
    operations.map((op) => (op.id === operationId ? { ...op, enabled: !op.enabled } : op)),
  );
}

/** Set an operation's `enabled` flag explicitly. */
export function setOperationEnabled(
  project: PackagingProject,
  operationId: string,
  enabled: boolean,
): PackagingProject {
  return withOperations(project, (operations) =>
    operations.map((op) => (op.id === operationId ? { ...op, enabled } : op)),
  );
}

/** Rename an operation. */
export function renameOperation(
  project: PackagingProject,
  operationId: string,
  name: string,
): PackagingProject {
  return withOperations(project, (operations) =>
    operations.map((op) => (op.id === operationId ? { ...op, name } : op)),
  );
}

/** Move an operation up (-1) or down (+1) in the pipeline order. */
export function moveOperation(
  project: PackagingProject,
  operationId: string,
  direction: -1 | 1,
): PackagingProject {
  return withOperations(project, (operations) => {
    const index = operations.findIndex((op) => op.id === operationId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= operations.length) return operations;
    const next = operations.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
}

/** Toggle a modifier (e.g. OPERATION_THICKNESS, OPERATION_ARTWORK) on/off. */
export function toggleModifier(project: PackagingProject, modifierKey: string): PackagingProject {
  if (!project.design) return project;
  const current = project.design.modifiers[modifierKey];
  if (!current) return project;
  const design = cloneDesign(project.design);
  design.modifiers[modifierKey] = { ...current, enabled: !current.enabled };
  return applyDesign(project, design);
}

/**
 * Append a new (neutral) folding keyframe to a source-backed design. Clones the
 * last origami-simulation operation for valid edge groups / fixed anchors, zeroes
 * its target angles (an empty keyframe the user then dials in), and re-derives.
 */
export function addOrigamiKeyframe(project: PackagingProject): PackagingProject {
  if (!project.design) return project;
  const origamiOps = project.design.operations.filter(
    (op): op is OrigamiSimulationOperation => op.type === "OPERATION_ORIGAMI_SIMULATION",
  );
  const template = origamiOps[origamiOps.length - 1];
  if (!template) return project;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `keyframe-${project.design.operations.length}-${origamiOps.length}`;
  const next: OrigamiSimulationOperation = {
    ...template,
    id,
    name: `Folding Keyframe ${origamiOps.length + 1}`,
    enabled: true,
    foldingEdgeGroups: template.foldingEdgeGroups.map((group) => ({
      ...group,
      targetAngleDegrees: 0,
    })),
  };
  const design = cloneDesign(project.design);
  design.operations = [...design.operations, next];
  // Select the freshly-added keyframe so its editor opens immediately (matches
  // PackCAD, where adding a keyframe focuses it ready for crease angles).
  return applyDesign({ ...project, activeStepId: id }, design);
}

/**
 * Set the target fold angle (signed, -180..180) for an origami operation. With
 * `groupIndex` only that edge group changes; otherwise all groups are set.
 */
export function setOperationTargetAngle(
  project: PackagingProject,
  operationId: string,
  angleDegrees: number,
  groupIndex?: number,
): PackagingProject {
  const clamped = Math.max(-180, Math.min(180, angleDegrees));
  return withOperations(project, (operations) =>
    operations.map((op) => {
      if (op.id !== operationId || op.type !== "OPERATION_ORIGAMI_SIMULATION") return op;
      const origami = op as OrigamiSimulationOperation;
      return {
        ...origami,
        foldingEdgeGroups: origami.foldingEdgeGroups.map((group, gi) =>
          groupIndex === undefined || gi === groupIndex ? { ...group, targetAngleDegrees: clamped } : group,
        ),
      };
    }),
  );
}

/** Toggle the "enforce prior constraints" flag on an origami keyframe. */
export function setOperationEnforcePrior(
  project: PackagingProject,
  operationId: string,
  value: boolean,
): PackagingProject {
  return withOperations(project, (operations) =>
    operations.map((op) =>
      op.id === operationId && op.type === "OPERATION_ORIGAMI_SIMULATION"
        ? { ...(op as OrigamiSimulationOperation), enforcePriorConstraints: value }
        : op,
    ),
  );
}

/** Add or remove a face (by UUID) from a keyframe's locked/fixed panel set. */
export function toggleOperationLockedFace(
  project: PackagingProject,
  operationId: string,
  faceId: string,
): PackagingProject {
  return withOperations(project, (operations) =>
    operations.map((op) => {
      if (op.id !== operationId || op.type !== "OPERATION_ORIGAMI_SIMULATION") return op;
      const origami = op as OrigamiSimulationOperation;
      const has = origami.fixedFaceIDs.includes(faceId);
      return {
        ...origami,
        fixedFaceIDs: has
          ? origami.fixedFaceIDs.filter((id) => id !== faceId)
          : [...origami.fixedFaceIDs, faceId],
      };
    }),
  );
}

/**
 * Set the fold angle for the crease identified by `<uuidA>-<uuidB>` edge id. If the
 * crease already belongs to a constraint group its (whole) group is retargeted
 * (symmetric creases fold together, like the source); otherwise a new single-crease
 * group is appended. This is what a click-a-crease-then-set-angle gesture calls.
 */
export function setOperationCreaseAngle(
  project: PackagingProject,
  operationId: string,
  edgeId: string,
  angleDegrees: number,
): PackagingProject {
  const clamped = Math.max(-180, Math.min(180, angleDegrees));
  return withOperations(project, (operations) =>
    operations.map((op) => {
      if (op.id !== operationId || op.type !== "OPERATION_ORIGAMI_SIMULATION") return op;
      const origami = op as OrigamiSimulationOperation;
      const exists = origami.foldingEdgeGroups.some((group) => group.edgeIDs.includes(edgeId));
      return {
        ...origami,
        foldingEdgeGroups: exists
          ? origami.foldingEdgeGroups.map((group) =>
              group.edgeIDs.includes(edgeId) ? { ...group, targetAngleDegrees: clamped } : group,
            )
          : [
              ...origami.foldingEdgeGroups,
              { edgeIDs: [edgeId], targetAngleDegrees: clamped, enabled: true },
            ],
      };
    }),
  );
}
