import { ClampToEdgeWrapping, type Texture } from "three";
import type { ArtworkPlacement, ViewMode } from "@packcad/format";

/**
 * Apply placement to either printed side. Source atlases stay registered to
 * their authored UVs; documents without the opt-in keep the legacy 3D mirror.
 */
export function applyArtworkPlacement(
  texture: Texture,
  artwork: ArtworkPlacement,
  viewMode: ViewMode,
): void {
  const scale = Math.max(0.0001, artwork.scale);
  const mirror = viewMode !== "2d" && artwork.uvConvention !== "source-atlas";
  texture.center.set(0.5, 0.5);
  texture.rotation = (artwork.rotation * Math.PI) / 180;
  texture.repeat.set((mirror ? -1 : 1) / scale, 1 / scale);
  texture.offset.set(-artwork.x / scale, -artwork.y / scale);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
}
