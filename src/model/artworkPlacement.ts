import type { FoldModel, PackagingProject } from "@packcad/format";
import { getEnabledSourceArtwork } from "@packcad/format";

export type PanelArtworkPlacement = Pick<
  PackagingProject["artwork"],
  "panelIndex" | "x" | "y"
>;

/**
 * Resolve the uploaded override first, then fall back to source-backed PackCAD
 * artwork. Both are serializable strings (normally data URLs).
 */
export type ArtworkImageSources = {
  front: string | null;
  back: string | null;
};

export function artworkImageSources(project: PackagingProject): ArtworkImageSources {
  if (project.artwork.imageDataUrl) {
    return {
      front: project.artwork.imageDataUrl,
      back: project.artwork.imageDataUrl,
    };
  }
  const sourceArtwork = getEnabledSourceArtwork(project.design);
  const front = sourceArtwork?.frontArtwork ?? sourceArtwork?.backArtwork ?? null;
  const back = sourceArtwork?.backArtwork ?? sourceArtwork?.frontArtwork ?? null;
  return { front, back };
}

export function artworkImageSource(project: PackagingProject): string | null {
  return artworkImageSources(project).front;
}

/**
 * Convert a face selection into the legacy global UV-placement coordinates.
 *
 * Legacy applies offset `(-x / scale, -y / scale)` around texture centre
 * `(0.5, 0.5)`, so centring the image on a face means x/y are the face's UV
 * centroid relative to the atlas centre.
 */
export function artworkPlacementForFace(
  model: FoldModel,
  panelIndex: number,
): PanelArtworkPlacement | null {
  const loop = model.facesVertices[panelIndex];
  if (!loop?.length) return null;
  const uv = loop
    .map((vertexIndex) => model.verticesUv[vertexIndex])
    .filter((value): value is number[] => Boolean(value && value.length >= 2));
  if (uv.length === 0) return null;
  const centroid = uv.reduce(
    (sum, value) => [sum[0] + value[0], sum[1] + value[1]] as [number, number],
    [0, 0] as [number, number],
  );
  return {
    panelIndex,
    x: Math.max(-1, Math.min(1, centroid[0] / uv.length - 0.5)),
    y: Math.max(-1, Math.min(1, centroid[1] / uv.length - 0.5)),
  };
}
