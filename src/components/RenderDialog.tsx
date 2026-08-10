import {
  DEFAULT_STILL_STUDIO_SETTINGS,
  RenderCancelledError,
  createStillPreview,
  renderStill,
  type StillPreview,
  type StillRenderProgress,
  type StillStudioSettings,
} from "@atelier/render";
import type { Viewport } from "@atelier/viewport";
import { useEffect, useRef, useState } from "react";
import { Scene, type Object3D } from "three";
import { Icon } from "./Icon";

interface RenderDialogProps {
  open: boolean;
  viewport: Viewport | null;
  sceneObject: Object3D | null;
  onClose: () => void;
}

type AspectRatio = "4:3" | "1:1" | "16:9" | "3:2" | "Custom";
type PreviewTab = "live" | "result";

const aspectValues: Record<Exclude<AspectRatio, "Custom">, number> = {
  "4:3": 4 / 3,
  "1:1": 1,
  "16:9": 16 / 9,
  "3:2": 3 / 2,
};

const initialProgress: StillRenderProgress = {
  stage: "preparing",
  progress: 0,
  sample: 0,
  samples: 0,
};

function progressLabel(progress: StillRenderProgress): string {
  if (progress.stage === "preparing") return "Preparing scene";
  if (progress.stage === "sampling") {
    return `Tracing sample ${progress.sample} of ${progress.samples}`;
  }
  if (progress.stage === "denoising") return "Denoising image";
  return "Render complete";
}

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface NumberControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  slider?: boolean;
  onChange: (value: number) => void;
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  slider = false,
  onChange,
}: NumberControlProps) {
  const update = (next: number): void => {
    if (Number.isFinite(next)) onChange(bounded(next, min, max));
  };
  return (
    <div className={`render-control${slider ? " with-slider" : ""}`} role="group" aria-label={label}>
      <span>{label}</span>
      {slider ? (
        <input
          type="range"
          aria-label={`${label} slider`}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => update(event.currentTarget.valueAsNumber)}
        />
      ) : null}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => update(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

export function RenderDialog({
  open,
  viewport,
  sceneObject,
  onClose,
}: RenderDialogProps) {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("4:3");
  const [samples, setSamples] = useState(150);
  const [bounces, setBounces] = useState(3);
  const [exposure, setExposure] = useState(0.6);
  const [denoise, setDenoise] = useState(true);
  const [studio, setStudio] = useState<StillStudioSettings>({
    ...DEFAULT_STILL_STUDIO_SETTINGS,
  });
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(initialProgress);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("live");
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<StillPreview | null>(null);

  const updateStudio = <Key extends keyof StillStudioSettings>(
    key: Key,
    value: StillStudioSettings[Key],
  ): void => setStudio((current) => ({ ...current, [key]: value }));

  useEffect(() => () => {
    controllerRef.current?.abort();
    previewRef.current?.dispose();
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      controllerRef.current?.abort();
      previewRef.current?.dispose();
      previewRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas || !viewport || !sceneObject) return;
    let preview: StillPreview | null = null;
    try {
      // Render the package, not the editor scene around it. The viewport also
      // owns picking planes, transform controls, selection overlays and its
      // shadow catcher; some of those helpers become opaque when materials are
      // normalized for the still renderer and can appear as black geometry
      // from rear camera angles.
      const renderScene = new Scene();
      renderScene.add(sceneObject.clone(true));
      preview = createStillPreview(
        { scene: renderScene, camera: viewport.camera.camera },
        canvas,
        { exposure, studioSettings: studio },
      );
      previewRef.current = preview;
      const observer = new ResizeObserver((entries) => {
        const bounds = entries[0]?.contentRect;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          preview?.resize(bounds.width, bounds.height);
        }
      });
      observer.observe(canvas);
      return () => {
        observer.disconnect();
        preview?.dispose();
        if (previewRef.current === preview) previewRef.current = null;
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [open, viewport, sceneObject, previewEpoch]);

  useEffect(() => {
    previewRef.current?.update({ exposure, studioSettings: studio });
  }, [exposure, studio]);

  if (!open) return null;

  const setWidthForAspect = (next: number): void => {
    const safe = Math.round(bounded(next, 16, 4096));
    setWidth(safe);
    if (aspectRatio !== "Custom") {
      setHeight(Math.round(safe / aspectValues[aspectRatio]));
    }
  };

  const setHeightForAspect = (next: number): void => {
    const safe = Math.round(bounded(next, 16, 4096));
    setHeight(safe);
    if (aspectRatio !== "Custom") {
      setWidth(Math.round(safe * aspectValues[aspectRatio]));
    }
  };

  const selectAspect = (next: AspectRatio): void => {
    setAspectRatio(next);
    if (next !== "Custom") setHeight(Math.round(width / aspectValues[next]));
  };

  const startRender = async (): Promise<void> => {
    if (!viewport || rendering) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRendering(true);
    setError(null);
    setErrorDetails(null);
    setWarning(null);
    setProgress({ ...initialProgress, samples });
    try {
      const previewSource = previewRef.current?.createRenderSource();
      const renderSource = previewSource ?? {
        scene: viewport.scene,
        camera: viewport.camera.camera,
      };
      const result = await renderStill(
        renderSource,
        {
          width,
          height,
          samples,
          bounces,
          exposure,
          studio: true,
          studioSettings: studio,
          studioCamera: renderSource.camera,
          denoise,
          denoiseQuality: "balanced",
          denoiseWeightsUrl: new URL("denoiser", document.baseURI).href.replace(/\/$/, ""),
          signal: controller.signal,
          onProgress: setProgress,
        },
      );
      const nextUrl = URL.createObjectURL(result.blob);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = nextUrl;
      setResultUrl(nextUrl);
      setPreviewTab("result");
      if (result.denoiseError) {
        setWarning(`Denoising could not finish; showing the traced image: ${result.denoiseError.message}`);
      }
    } catch (cause) {
      if (cause instanceof RenderCancelledError || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setErrorDetails(cause instanceof Error ? cause.stack ?? cause.message : null);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setRendering(false);
    }
  };

  const download = (): void => {
    if (!resultUrl) return;
    const anchor = document.createElement("a");
    anchor.href = resultUrl;
    anchor.download = "packcad-render.png";
    anchor.click();
  };

  return (
    <div className="dialog-backdrop render-backdrop" role="presentation" onClick={onClose}>
      <div className="render-dialog" role="dialog" aria-modal="true" aria-labelledby="render-title" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <Icon name="sparkles" size={18} />
            <h2 id="render-title">Render</h2>
            <span className="render-beta-badge">Beta</span>
          </div>
          <button type="button" className="dialog-close" aria-label="Close render dialog" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="render-layout">
          <aside className="render-settings" aria-label="Render settings">
            <details className="render-section" open>
              <summary>Output</summary>
              <div className="render-section-body">
                <label className="render-select-control">
                  <span>Aspect Ratio</span>
                  <select value={aspectRatio} disabled={rendering} onChange={(event) => selectAspect(event.currentTarget.value as AspectRatio)}>
                    {Object.keys(aspectValues).map((ratio) => <option key={ratio}>{ratio}</option>)}
                    <option>Custom</option>
                  </select>
                </label>
                <NumberControl label="Width (up to 4096 px)" value={width} min={16} max={4096} disabled={rendering} onChange={setWidthForAspect} />
                <NumberControl label="Height (up to 4096 px)" value={height} min={16} max={4096} disabled={rendering} onChange={setHeightForAspect} />
              </div>
            </details>

            <details className="render-section" open>
              <summary>Scene</summary>
              <div className="render-section-body">
                <label className="render-color-control">
                  <span>Background Color</span>
                  <code>{studio.backgroundColor}</code>
                  <input type="color" aria-label="Background Color" value={studio.backgroundColor} disabled={rendering} onChange={(event) => updateStudio("backgroundColor", event.currentTarget.value)} />
                </label>
                <label className="render-toggle">
                  <input type="checkbox" checked={studio.floorVisible} disabled={rendering} onChange={(event) => updateStudio("floorVisible", event.currentTarget.checked)} />
                  <span>Studio floor</span>
                </label>
                <label className="render-color-control compact">
                  <span>Floor Color</span>
                  <code>{studio.floorColor}</code>
                  <input type="color" aria-label="Floor Color" value={studio.floorColor} disabled={rendering || !studio.floorVisible} onChange={(event) => updateStudio("floorColor", event.currentTarget.value)} />
                </label>
              </div>
            </details>

            <details className="render-section">
              <summary>Lighting</summary>
              <div className="render-section-body">
                <NumberControl label="Key Angle" value={studio.keyAngle} min={-180} max={180} slider disabled={rendering} onChange={(value) => updateStudio("keyAngle", value)} />
                <NumberControl label="Key Intensity" value={studio.keyIntensity} min={0} max={20} step={0.1} slider disabled={rendering} onChange={(value) => updateStudio("keyIntensity", value)} />
                <NumberControl label="Fill Intensity" value={studio.fillIntensity} min={0} max={20} step={0.1} slider disabled={rendering} onChange={(value) => updateStudio("fillIntensity", value)} />
                <NumberControl label="Ambient Intensity" value={studio.ambientIntensity} min={0} max={2} step={0.05} slider disabled={rendering} onChange={(value) => updateStudio("ambientIntensity", value)} />
              </div>
            </details>

            <details className="render-section">
              <summary>Camera</summary>
              <div className="render-section-body">
                <label className="render-select-control">
                  <span>Camera Type</span>
                  <select aria-label="Camera Type" value="Perspective" disabled><option>Perspective</option></select>
                </label>
                <NumberControl label="FOV" value={studio.fov} min={10} max={90} slider disabled={rendering} onChange={(value) => updateStudio("fov", value)} />
                <button type="button" className="render-reset-view" disabled={rendering} onClick={() => setPreviewEpoch((value) => value + 1)}>Reset preview view</button>
              </div>
            </details>

            <details className="render-section">
              <summary>Renderer</summary>
              <div className="render-section-body">
                <NumberControl label="Exposure" value={exposure} min={0.05} max={4} step={0.05} slider disabled={rendering} onChange={setExposure} />
                <NumberControl label="Samples" value={samples} min={1} max={4096} disabled={rendering} onChange={(value) => setSamples(Math.round(value))} />
                <NumberControl label="Light Bounces" value={bounces} min={1} max={32} disabled={rendering} onChange={(value) => setBounces(Math.round(value))} />
                <label className="render-toggle">
                  <input type="checkbox" checked={denoise} disabled={rendering} onChange={(event) => setDenoise(event.currentTarget.checked)} />
                  <span>Denoise final image</span>
                </label>
              </div>
            </details>
          </aside>

          <section className="render-workspace" aria-label="Render preview">
            <div className="render-preview-tabs" role="tablist" aria-label="Render previews">
              <button type="button" role="tab" aria-selected={previewTab === "live"} onClick={() => setPreviewTab("live")}><span className="live-dot" />Live Preview</button>
              {resultUrl ? <button type="button" role="tab" aria-selected={previewTab === "result"} onClick={() => setPreviewTab("result")}>Render 1</button> : null}
            </div>
            <div className="render-preview-stage">
              <canvas ref={canvasRef} className={previewTab === "live" ? "active" : ""} aria-label="Movable live render preview" />
              {resultUrl ? <img className={previewTab === "result" ? "active" : ""} src={resultUrl} alt="Latest PackCAD path-traced render" /> : null}
              {!viewport ? <div className="render-preview-empty"><Icon name="image" size={28} /><span>Waiting for the 3D model</span></div> : null}
              {rendering ? (
                <div className="render-progress" role="status">
                  <span>{progressLabel(progress)}</span>
                  <progress value={progress.progress} max={1} />
                  <small>{Math.round(progress.progress * 100)}%</small>
                </div>
              ) : null}
            </div>
            <div className="render-preview-footer">
              <span>Drag to rotate · Scroll to zoom · Right-drag to pan</span>
              <span>{studio.floorVisible ? "Studio floor on" : "Studio floor off"}</span>
            </div>
          </section>
        </div>

        {error ? <p className="render-message error" role="alert" title={errorDetails ?? undefined}>{error}</p> : null}
        {warning ? <p className="render-message warning" role="status">{warning}</p> : null}

        <div className="dialog-actions render-actions">
          {resultUrl ? <button type="button" onClick={download} disabled={rendering}><Icon name="save" size={14} />Download PNG</button> : null}
          {rendering ? (
            <button type="button" onClick={() => controllerRef.current?.abort()}>Cancel</button>
          ) : (
            <button type="button" onClick={() => void startRender()} disabled={!viewport}><Icon name="sparkles" size={14} />Start Render</button>
          )}
        </div>
      </div>
    </div>
  );
}
