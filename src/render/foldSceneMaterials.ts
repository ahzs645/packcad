import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  type Texture,
} from "three";
import type { ViewMode } from "@packcad/format";

export type FoldSceneMaterials = readonly [
  front: MeshStandardMaterial,
  back: MeshStandardMaterial,
  edge: MeshStandardMaterial,
];

/**
 * Packager renders the fold shell directly. GTAO's replacement render pass can
 * fully occlude a thin, upright multi-material panel even though its material
 * and texture are valid, so the port keeps the reference's direct-render path.
 */
export const FOLD_SCENE_POST_PROCESSING = false;

type FoldSceneMaterialOptions = {
  viewMode: ViewMode;
  technical: boolean;
  showArtwork: boolean;
  useFaceColors: boolean;
  frontArtworkTexture: Texture | null;
  backArtworkTexture: Texture | null;
  edgeTexture: Texture | null;
  edgeFallbackColor: string;
};

export function createFoldSceneMaterials({
  viewMode,
  technical,
  showArtwork,
  useFaceColors,
  frontArtworkTexture,
  backArtworkTexture,
  edgeTexture,
  edgeFallbackColor,
}: FoldSceneMaterialOptions): FoldSceneMaterials {
  const frontMaterial = new MeshStandardMaterial({
    color: new Color(technical ? "#f1f1f1" : "#ffffff"),
    map: technical || !showArtwork ? null : frontArtworkTexture,
    roughness: technical ? 0.96 : 0.9,
    metalness: 0,
    vertexColors: !technical && useFaceColors,
    wireframe: technical,
    side: technical || viewMode === "2d" ? DoubleSide : FrontSide,
  });
  const backMaterial = frontMaterial.clone();
  backMaterial.map = technical
    ? null
    : viewMode === "2d"
      ? showArtwork ? frontArtworkTexture : null
      : showArtwork ? backArtworkTexture : null;
  if (!technical) {
    backMaterial.side = viewMode === "2d" ? DoubleSide : BackSide;
  }
  const edgeMaterial = new MeshStandardMaterial({
    color: technical ? "#f1f1f1" : edgeTexture ? "#ffffff" : edgeFallbackColor,
    map: technical ? null : edgeTexture,
    roughness: technical ? 0.96 : 1,
    metalness: 0,
    wireframe: technical,
    side: DoubleSide,
  });

  return [frontMaterial, backMaterial, edgeMaterial];
}
