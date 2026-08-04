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
  closedSeamCap: MeshStandardMaterial,
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
    // The bitmap supplies fibre detail; the selected stock colour supplies the
    // material tint. Multiplying textured faces by white washed chipboard and
    // corrugated stock out compared with the source renderer.
    color: new Color(technical ? "#f1f1f1" : edgeFallbackColor),
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
  const cutEdgeColor = new Color(technical ? "#f1f1f1" : edgeFallbackColor);
  if (!technical && edgeTexture) {
    // The flute bitmap supplies the corrugation detail, while this warm, dark
    // stock tint supplies the colour. A pale multiplier left a conspicuous
    // beige ribbon above every red sidewall; the source renders those grazing
    // cut edges as a narrow brown/red seam.
    cutEdgeColor.lerp(new Color("#6e3428"), 0.72);
  }
  const baseEdgeMaterial = new MeshStandardMaterial({
    // Tint the flute texture with the stock colour. Leaving textured edges
    // pure white made exposed folds read as bright plastic bands, especially
    // along the K4/K5 side walls, instead of the source's kraft cut surface.
    color: cutEdgeColor,
    map: technical ? null : edgeTexture,
    roughness: technical ? 0.96 : 1,
    metalness: 0,
    wireframe: technical,
    side: DoubleSide,
  });
  const closedSeamCapMaterial = new MeshStandardMaterial({
    // A double-wall terminal is a broad exposed cross-section, unlike the
    // grazing cut/crease strips above. Keep the flute detail but use natural
    // kraft stock so the cap does not turn into a nearly black corner block.
    color: new Color(
      technical ? "#f1f1f1" : edgeTexture ? "#ffffff" : edgeFallbackColor,
    ),
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
    closedSeamCapMaterial,
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
    hiddenArtworkEdgeMaterial,
  ];

  return { base, artwork };
}
