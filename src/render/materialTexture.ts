import type { FoldModel } from "@packcad/format";

const SVG_POINTS_PER_INCH = 72;
const PAPERBOARD_TILE_SIZE_IN = 2;
const CORRUGATED_TEXTURE_FLUTES = 20;
const DEFAULT_CORRUGATED_FLUTES_PER_IN = 7.5;
const FALLBACK_REPEAT = 2;

function foldUnitsPerInch(coordinateUnit: string): number {
  switch (coordinateUnit.toLowerCase()) {
    case "px":
    case "pt":
      return SVG_POINTS_PER_INCH;
    case "in":
      return 1;
    case "cm":
      return 2.54;
    case "mm":
    default:
      return 25.4;
  }
}

function axisRepeat(
  model: FoldModel,
  axis: 0 | 1,
  tileSizeIn: number,
): number {
  let minPosition = Infinity;
  let maxPosition = -Infinity;
  let minUv = Infinity;
  let maxUv = -Infinity;

  for (let index = 0; index < model.verticesCoords.length; index += 1) {
    const position = model.verticesCoords[index]?.[axis];
    const uv = model.verticesUv[index]?.[axis];
    if (!Number.isFinite(position) || !Number.isFinite(uv)) continue;
    minPosition = Math.min(minPosition, position);
    maxPosition = Math.max(maxPosition, position);
    minUv = Math.min(minUv, uv);
    maxUv = Math.max(maxUv, uv);
  }

  const positionSpanIn = (maxPosition - minPosition)
    / foldUnitsPerInch(model.coordinateUnit);
  const uvSpan = maxUv - minUv;
  const uvsPerInch = uvSpan / positionSpanIn;
  const repeat = 1 / (uvsPerInch * tileSizeIn);
  return Number.isFinite(repeat) && repeat > 0 ? repeat : FALLBACK_REPEAT;
}

/**
 * Match PackCAD's material compositor: paperboard swatches are physical
 * two-inch tiles, while corrugated stock spans twenty flutes per source image.
 * The returned repeat is expressed in the imported FOLD UV atlas.
 */
export function materialTextureRepeat(
  model: FoldModel | null | undefined,
  options: {
    corrugated: boolean;
    fluteFrequencyPerIn?: number;
  },
): readonly [number, number] {
  if (!model || model.verticesUv.length === 0) {
    return [FALLBACK_REPEAT, FALLBACK_REPEAT];
  }
  const tileSizeIn = options.corrugated
    ? CORRUGATED_TEXTURE_FLUTES
      / Math.max(options.fluteFrequencyPerIn ?? DEFAULT_CORRUGATED_FLUTES_PER_IN, 0.001)
    : PAPERBOARD_TILE_SIZE_IN;
  return [
    axisRepeat(model, 0, tileSizeIn),
    axisRepeat(model, 1, tileSizeIn),
  ];
}

