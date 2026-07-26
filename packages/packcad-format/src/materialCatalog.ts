// Full captured material taxonomy (MATERIAL_*), reconstructed from the bundle.
//
// The rebuild renders with 4 texture swatches (MaterialId), but the captured
// app exposes paperboards plus the complete corrugated flute grade taxonomy
// (A-T), each with an authentic board thickness and flute frequency. This
// catalog preserves that taxonomy and maps every entry onto a render swatch.
// Thickness values are inches and frequency is flutes per inch, taken verbatim
// from the captured constants (e.g. MATERIAL_CORRUGATED_CARDBOARD_A_FLUTE_*).

import type { MaterialId } from "./packaging";

export type MaterialGroup = "paperboard" | "corrugated";

export type MaterialSpec = {
  /** Captured MATERIAL_* identifier. */
  id: string;
  label: string;
  group: MaterialGroup;
  /** Render swatch this maps onto. */
  swatch: MaterialId;
  /** Board thickness in inches (captured). */
  thicknessIn: number;
  /** Flute frequency in flutes per inch (corrugated only). */
  fluteFrequencyPerIn?: number;
  /** Captured corrugated sub-type, when applicable. */
  subType?: string;
};

// Flute grades: [letter, thickness inches, frequency per inch] from the bundle.
const FLUTES: Array<[string, number, number]> = [
  ["A", 1 / 4, 33 / 12],
  ["B", 1 / 8, 49 / 12],
  ["C", 11 / 64, 39 / 12],
  ["D", 11 / 50, 72 / 12],
  ["E", 1 / 16, 90 / 12],
  ["F", 1 / 32, 125 / 12],
  ["G", 1 / 32, 90 / 12],
  ["N", 1 / 50, 170 / 12],
  ["R", 3 / 32, 61 / 12],
  ["T", 3 / 64, 116 / 12],
];

export const materialCatalog: Record<string, MaterialSpec> = {
  MATERIAL_CHIPBOARD: {
    id: "MATERIAL_CHIPBOARD",
    label: "Chipboard",
    group: "paperboard",
    swatch: "chipboard",
    thicknessIn: 0.02,
  },
  MATERIAL_KRAFT_PAPERBOARD: {
    id: "MATERIAL_KRAFT_PAPERBOARD",
    label: "Kraft paperboard",
    group: "paperboard",
    swatch: "kraft",
    thicknessIn: 0.02,
  },
  MATERIAL_CORRUGATED_CARDBOARD: {
    id: "MATERIAL_CORRUGATED_CARDBOARD",
    label: "Corrugated cardboard",
    group: "corrugated",
    swatch: "corrugated",
    // The reference's OPERATION_THICKNESS_DEFAULT_STATE resolves base corrugated
    // to E-flute (1/16 in), not the bogus 0.157 in this entry used to carry
    // (~2.5x too thick). Match the reference default.
    thicknessIn: 1 / 16,
    fluteFrequencyPerIn: 90 / 12,
    subType: "MATERIAL_CORRUGATED_CARDBOARD_E_FLUTE",
  },
  ...Object.fromEntries(
    FLUTES.map(([letter, thicknessIn, frequency]) => {
      const id = `MATERIAL_CORRUGATED_CARDBOARD_${letter}_FLUTE`;
      return [
        id,
        {
          id,
          label: `Corrugated ${letter}-flute`,
          group: "corrugated" as MaterialGroup,
          swatch: "flute" as MaterialId,
          thicknessIn,
          fluteFrequencyPerIn: frequency,
          subType: id,
        },
      ];
    }),
  ),
};

export type MaterialSpecId = keyof typeof materialCatalog;

export const defaultMaterialSpecId = "MATERIAL_CHIPBOARD";

/** Resolve a captured materialType (+ optional sub-type) to a catalog entry. */
export function resolveMaterialSpec(materialType: string, materialSubType?: string): MaterialSpec {
  if (materialSubType && materialCatalog[materialSubType]) return materialCatalog[materialSubType];
  if (materialCatalog[materialType]) return materialCatalog[materialType];
  return materialCatalog[defaultMaterialSpecId];
}

/** Catalog entries grouped for display. */
export function materialCatalogByGroup(): Record<MaterialGroup, MaterialSpec[]> {
  const groups: Record<MaterialGroup, MaterialSpec[]> = { paperboard: [], corrugated: [] };
  for (const spec of Object.values(materialCatalog)) groups[spec.group].push(spec);
  return groups;
}
