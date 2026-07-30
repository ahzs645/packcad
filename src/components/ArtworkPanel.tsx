import type { PackagingProject } from "@packcad/format";
import { useState } from "react";
import {
  artworkImageSource,
  artworkPlacementForFace,
} from "../model/artworkPlacement";

interface ArtworkPanelProps {
  project: PackagingProject;
  onSetColor: (artworkColor: string) => void;
  onSetPlacement: (
    placement: Partial<PackagingProject["artwork"]>,
  ) => void;
  onResetPlacement: () => void;
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected artwork could not be read."));
    });
    reader.addEventListener("error", () => reject(
      reader.error ?? new Error("The selected artwork could not be read."),
    ));
    reader.readAsDataURL(file);
  });
}

export function ArtworkPanel({
  project,
  onSetColor,
  onSetPlacement,
  onResetPlacement,
}: ArtworkPanelProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const imageSource = artworkImageSource(project);
  const model = project.foldModel;

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploadError(null);
    try {
      const imageDataUrl = await fileAsDataUrl(file);
      onSetPlacement({ imageDataUrl, imageName: file.name });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Artwork upload failed.");
    }
  };

  return (
    <section className="panel artwork-panel">
      <div className="panel-heading">Artwork</div>
      <label className="artwork-upload">
        <span>{project.artwork.imageName ?? (imageSource ? "Source artwork" : "Upload image")}</span>
        {imageSource ? (
          <img src={imageSource} alt="Artwork preview" />
        ) : (
          <span className="artwork-upload-empty">Choose PNG, JPEG, WebP, or SVG</span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(event) => {
            void upload(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {uploadError ? <p className="artwork-error" role="alert">{uploadError}</p> : null}
      {project.artwork.imageDataUrl ? (
        <button
          type="button"
          className="artwork-remove"
          onClick={() => onSetPlacement({ imageDataUrl: null, imageName: null })}
        >
          Remove uploaded artwork
        </button>
      ) : null}
      <label>
        Place on panel
        <select
          value={project.artwork.panelIndex ?? ""}
          disabled={!model}
          onChange={(event) => {
            if (!model || event.currentTarget.value === "") {
              onSetPlacement({ panelIndex: null });
              return;
            }
            const placement = artworkPlacementForFace(
              model,
              Number(event.currentTarget.value),
            );
            if (placement) onSetPlacement(placement);
          }}
        >
          <option value="">UV atlas centre</option>
          {model?.facesVertices.map((_, faceIndex) => (
            <option value={faceIndex} key={model.facesIDs[faceIndex] ?? faceIndex}>
              Panel {faceIndex + 1}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tint
        <input
          type="color"
          value={project.artworkColor}
          onChange={(event) => onSetColor(event.currentTarget.value)}
        />
      </label>
      <div className="artwork-controls">
        <label>
          Horizontal <output>{project.artwork.x.toFixed(2)}</output>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.05"
            value={project.artwork.x}
            onChange={(event) => onSetPlacement({ x: event.currentTarget.valueAsNumber })}
          />
        </label>
        <label>
          Vertical <output>{project.artwork.y.toFixed(2)}</output>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.05"
            value={project.artwork.y}
            onChange={(event) => onSetPlacement({ y: event.currentTarget.valueAsNumber })}
          />
        </label>
        <label>
          Scale <output>{project.artwork.scale.toFixed(2)}×</output>
          <input
            type="range"
            min="0.25"
            max="2"
            step="0.05"
            value={project.artwork.scale}
            onChange={(event) => onSetPlacement({ scale: event.currentTarget.valueAsNumber })}
          />
        </label>
        <label>
          Rotation <output>{project.artwork.rotation.toFixed(0)}°</output>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={project.artwork.rotation}
            onChange={(event) => onSetPlacement({ rotation: event.currentTarget.valueAsNumber })}
          />
        </label>
      </div>
      <button type="button" onClick={onResetPlacement}>Reset placement</button>
    </section>
  );
}
