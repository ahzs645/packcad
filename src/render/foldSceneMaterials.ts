import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  type Texture,
} from "three";
import type { ViewMode } from "@packcad/format";

export type FoldSceneMaterials = [
  front: MeshStandardMaterial,
  back: MeshStandardMaterial,
  edge: MeshStandardMaterial,
];

export type FoldSceneMaterialLayers = {
  base: FoldSceneMaterials;
  artwork: FoldSceneMaterials | null;
};

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
  faceTexture: Texture | null;
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
  faceTexture,
  frontArtworkTexture,
  backArtworkTexture,
  edgeTexture,
  edgeFallbackColor,
}: FoldSceneMaterialOptions): FoldSceneMaterialLayers {
  const baseFrontMaterial = new MeshStandardMaterial({
    color: new Color(technical ? "#f1f1f1" : "#ffffff"),
    map: technical || useFaceColors ? null : faceTexture,
    roughness: technical ? 0.96 : 0.9,
    metalness: 0,
    vertexColors: !technical && useFaceColors,
    wireframe: technical,
    side: technical || viewMode === "2d" ? DoubleSide : FrontSide,
  });
  const baseBackMaterial = baseFrontMaterial.clone();
  if (!technical) {
    baseBackMaterial.side = viewMode === "2d" ? DoubleSide : BackSide;
  }
  const baseEdgeMaterial = new MeshStandardMaterial({
    color: technical ? "#f1f1f1" : edgeTexture ? "#ffffff" : edgeFallbackColor,
    map: technical ? null : edgeTexture,
    roughness: technical ? 0.96 : 1,
    metalness: 0,
    wireframe: technical,
    side: DoubleSide,
  });

  const base: FoldSceneMaterials = [
    baseFrontMaterial,
    baseBackMaterial,
    baseEdgeMaterial,
  ];
  if (technical || !showArtwork || !frontArtworkTexture) {
    return { base, artwork: null };
  }

  // Artwork is a print layer, not the board itself. In particular, the live
  // MailerBox interior PNG has a transparent background so corrugated stock
  // must remain visible beneath it. Rendering it as the only face map turned
  // those transparent pixels into a solid navy back face and exposed that
  // colour as a false strip along every cut edge.
  const artworkFrontMaterial = new MeshStandardMaterial({
    color: "#ffffff",
    map: frontArtworkTexture,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: viewMode === "2d" ? DoubleSide : FrontSide,
  });
  const artworkBackMaterial = artworkFrontMaterial.clone();
  artworkBackMaterial.map = viewMode === "2d"
    ? frontArtworkTexture
    : backArtworkTexture;
  artworkBackMaterial.side = viewMode === "2d" ? DoubleSide : BackSide;
  const hiddenArtworkEdgeMaterial = new MeshStandardMaterial({ visible: false });
  const artwork: FoldSceneMaterials = [
    artworkFrontMaterial,
    artworkBackMaterial,
    hiddenArtworkEdgeMaterial,
  ];

  return { base, artwork };
}
