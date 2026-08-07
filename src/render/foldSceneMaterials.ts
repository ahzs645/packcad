import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Texture,
} from "three";
import type { ViewMode } from "@packcad/format";

export type FoldSceneMaterials = [
  front: MeshStandardMaterial | MeshBasicMaterial,
  back: MeshStandardMaterial | MeshBasicMaterial,
  edge: MeshStandardMaterial | MeshBasicMaterial,
  closedSeamCap: MeshStandardMaterial | MeshBasicMaterial,
  frontBend: MeshStandardMaterial | MeshBasicMaterial,
  backBend: MeshStandardMaterial | MeshBasicMaterial,
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
  const faceMap = technical || useFaceColors ? null : faceTexture;
  // PackCAD composites the stock bitmap into a white albedo surface. Applying
  // the catalog's beige swatch as a second multiplier darkens the exact same
  // JPEG and is especially visible on chipboard.
  const faceColor = new Color(
    technical
      ? "#f1f1f1"
      : faceMap || useFaceColors
        ? "#ffffff"
        : edgeFallbackColor,
  );
  const baseFrontMaterial = viewMode === "2d"
    ? new MeshBasicMaterial({
        color: faceColor,
        map: faceMap,
        vertexColors: !technical && useFaceColors,
        wireframe: technical,
        side: FrontSide,
      })
    : new MeshStandardMaterial({
        color: faceColor,
        map: faceMap,
        roughness: technical ? 0.96 : 0.9,
        metalness: 0,
        vertexColors: !technical && useFaceColors,
        wireframe: technical,
        side: FrontSide,
      });
  const baseBackMaterial = baseFrontMaterial.clone();
  baseBackMaterial.side = BackSide;
  // PackCAD's GraphVisSideBand is an untinted white MeshStandardMaterial: the
  // sideband bitmap alone supplies the kraft cut-surface colour. (Its earlier
  // "dark brown seam" impression came from fold-hinge rims wrongly wearing this
  // material — rims now wrap the face sheet instead.) The source also offsets
  // the band behind the printed faces to avoid grazing-angle z-fighting; it can
  // use FrontSide because its graph windings are normalized, while FOLD cut
  // edges have no guaranteed orientation, so the band stays double-sided here.
  const cutEdgeColor = new Color(
    technical ? "#f1f1f1" : edgeTexture ? "#ffffff" : edgeFallbackColor,
  );
  const baseEdgeMaterial = new MeshStandardMaterial({
    color: cutEdgeColor,
    map: technical ? null : edgeTexture,
    roughness: technical ? 0.96 : 1,
    metalness: 0,
    wireframe: technical,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const closedSeamCapMaterial = new MeshStandardMaterial({
    // A double-wall terminal rail is closed by one continuous cut face, same
    // white-times-flute treatment as the individual sidebands.
    color: cutEdgeColor.clone(),
    map: technical ? null : edgeTexture,
    roughness: technical ? 0.96 : 1,
    metalness: 0,
    wireframe: technical,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  // PackCAD wraps the sheet itself around each fold hinge, so a bend shows the
  // adjoining face's stock and print, not the cut-edge sideband. A bend's
  // winding flips with the fold's mountain/valley direction, so unlike the
  // sheets these stay double-sided.
  const frontBendMaterial = baseFrontMaterial.clone();
  frontBendMaterial.side = DoubleSide;
  const backBendMaterial = baseBackMaterial.clone();
  backBendMaterial.side = DoubleSide;

  const base: FoldSceneMaterials = [
    baseFrontMaterial,
    baseBackMaterial,
    baseEdgeMaterial,
    closedSeamCapMaterial,
    frontBendMaterial,
    backBendMaterial,
  ];
  if (technical || !showArtwork || !frontArtworkTexture) {
    return { base, artwork: null };
  }

  // Artwork is a print layer, not the board itself. In particular, the live
  // MailerBox interior PNG has a transparent background so corrugated stock
  // must remain visible beneath it. Rendering it as the only face map turned
  // those transparent pixels into a solid navy back face and exposed that
  // colour as a false strip along every cut edge.
  const artworkOptions = {
    color: "#ffffff",
    map: frontArtworkTexture,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    side: FrontSide,
  } as const;
  const artworkFrontMaterial = viewMode === "2d"
    ? new MeshBasicMaterial(artworkOptions)
    : new MeshStandardMaterial({
        ...artworkOptions,
        roughness: 0.9,
        metalness: 0,
      });
  const artworkBackMaterial = artworkFrontMaterial.clone();
  artworkBackMaterial.map = viewMode === "2d"
    ? frontArtworkTexture
    : backArtworkTexture;
  artworkBackMaterial.side = BackSide;
  const hiddenArtworkEdgeMaterial = new MeshStandardMaterial({ visible: false });
  // Print wraps around a fold with the sheet, so bends carry their side's
  // artwork too (double-sided for the same winding reason as the base bends).
  const artworkFrontBendMaterial = artworkFrontMaterial.clone();
  artworkFrontBendMaterial.side = DoubleSide;
  const artworkBackBendMaterial = artworkBackMaterial.clone();
  artworkBackBendMaterial.side = DoubleSide;
  const artwork: FoldSceneMaterials = [
    artworkFrontMaterial,
    artworkBackMaterial,
    hiddenArtworkEdgeMaterial,
    hiddenArtworkEdgeMaterial,
    artworkFrontBendMaterial,
    artworkBackBendMaterial,
  ];

  return { base, artwork };
}
