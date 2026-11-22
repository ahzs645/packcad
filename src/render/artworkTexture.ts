import { ClampToEdgeWrapping, type Texture } from "three";
import type { ArtworkPlacement } from "@packcad/format";

/**
 * Apply placement to either printed side. Artwork stays registered to its
 * authored UVs in both views.
 *
 * The folded view used to be the mirror image of the flat sheet (its fold ->
 * scene axis remap was a reflection), and documents without the "source-atlas"
 * opt-in were mirrored here to make their lettering read. That also moved every
 * panel's print onto the panel opposite it on the sheet. The folded view is now
 * a rotation of the flat one (foldSceneBuilder.ts), so no document is mirrored;
 * `uvConvention` is kept on documents but no longer changes rendering.
 */
export function applyArtworkPlacement(
  texture: Texture,
  artwork: ArtworkPlacement,
): void {
  const scale = Math.max(0.0001, artwork.scale);
  texture.center.set(0.5, 0.5);
  texture.rotation = (artwork.rotation * Math.PI) / 180;
  texture.repeat.set(1 / scale, 1 / scale);
  texture.offset.set(-artwork.x / scale, -artwork.y / scale);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
}
