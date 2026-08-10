import { log } from "node:console";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const assetUrl = (name) =>
  new URL(`../artifacts/render-beta-v1.4.3/public/mockup/assets/${name}`, import.meta.url);
const pristineAssetUrl = (name) =>
  new URL(
    `../artifacts/render-beta-recovered/public/mockup/assets/${name}`,
    import.meta.url,
  );

const MAIN_CHUNK = "index-86ku_AyT.js";
const RENDER_CLIENT_CHUNK = "RenderClient-Do6HTTv3.js";
const RENDER_CLIENT_LOCAL_CHUNKS = [
  "RenderClient-local-v2-Do6HTTv3.js",
  "RenderClient-local-Do6HTTv3.js",
  `${RENDER_CLIENT_CHUNK}?localDenoiser=1`,
];
const PATH_TRACE_WORKER_CHUNK = "pathtrace.worker-DHPvehDc.js";
const DENOISER_RUNTIME_CHUNK = "index-Bg30tw7y.js";

const bundlePath = fileURLToPath(assetUrl(MAIN_CHUNK));
const renderClientPath = fileURLToPath(assetUrl(RENDER_CLIENT_CHUNK));
const pathTraceWorkerPath = fileURLToPath(assetUrl(PATH_TRACE_WORKER_CHUNK));
const denoiserRuntimePath = fileURLToPath(assetUrl(DENOISER_RUNTIME_CHUNK));
const pristineRenderClientPath = fileURLToPath(
  pristineAssetUrl(RENDER_CLIENT_CHUNK),
);
const pristinePathTraceWorkerPath = fileURLToPath(
  pristineAssetUrl(PATH_TRACE_WORKER_CHUNK),
);
const pristineDenoiserRuntimePath = fileURLToPath(
  pristineAssetUrl(DENOISER_RUNTIME_CHUNK),
);
const denoiserWeightsUrl = new URL(
  "../artifacts/render-beta-v1.4.3/public/mockup/tzas/rt_ldr_alb_nrm.tza",
  import.meta.url,
);
const legacyDenoiserWeightsUrl = new URL(
  "../artifacts/render-beta-v1.4.3/public/mockup/assets/denoiser/tzas/rt_ldr_alb_nrm.tza",
  import.meta.url,
);
const denoiserWeightsModuleUrl = assetUrl("denoiser-weights-local.js");

const SOURCE_WIPE = `{const C0=window[kd6b3Bx86RqMU8Ky4sC6(E9yKFmN4urhirELCVsM3[u0(526)])][kd6b3Bx86RqMU8Ky4sC6(E9yKFmN4urhirELCVsM3.Se_NaaHLD9UBd1Pf7_3I)];setTimeout(()=>{const n0=u0;C0!==kd6b3Bx86RqMU8Ky4sC6(E9yKFmN4urhirELCVsM3[n0(545)])&&C0!==kd6b3Bx86RqMU8Ky4sC6(E9yKFmN4urhirELCVsM3.NPRcEqiNHnLr2OcDe4Jv)&&(s0[n0(556)]=void 0)},1e3*2)}`;
const SOURCE_RETENTION_MARKER =
  "globalThis.__PACKCAD_RENDER_BETA_LOCAL_SOURCE_RETENTION__=!0";
const DENOISE_WEIGHTS_CDN =
  "https://cdn.jsdelivr.net/npm/denoiser@0.0.11/tzas";
const DENOISE_WEIGHTS_LOCAL = "/mockup/tzas";
const DENOISE_WEIGHTS_FILE_URL =
  `${DENOISE_WEIGHTS_CDN}/rt_ldr_alb_nrm.tza`;
const DENOISE_WEIGHTS_SIZE = 1_841_160;
const ENABLE_DENOISER_DIAGNOSTICS =
  process.env.PACKCAD_DENOISER_DIAGNOSTICS === "1";
const DENOISE_WORKER_ORIGINAL = `async function uT(s,e,t,n,i){const r=await import("./denoise-DH0n1ly8.js");let a,o=!1;try{a=await r.denoiseImage(e,t,n,{weightsUrl:i.denoise.weightsUrl,quality:i.denoise.quality,fireflyClamp:!0,onProgress:c=>{Yn||Zn.postMessage({type:"DENOISE_PROGRESS",progress:c})}})}catch(c){console.warn("[packcad] OIDN denoise failed; using firefly-clamped frame.",c),a=r.clampFireflies(e),o=!0}return Yn||mT(s,a),{image:a,failed:o}}`;
const DENOISE_WORKER_DIAGNOSTIC = `async function uT(s,e,t,n,i){const r=await import("./denoise-DH0n1ly8.js");let a,o=!1,l;try{a=await r.denoiseImage(e,t,n,{weightsUrl:i.denoise.weightsUrl,quality:i.denoise.quality,fireflyClamp:!0,onProgress:c=>{Yn||Zn.postMessage({type:"DENOISE_PROGRESS",progress:c})}})}catch(c){const h=c instanceof Error?c.stack??c.message:String(c);l="weightsUrl="+i.denoise.weightsUrl+"\\n"+h,console.warn("[packcad] OIDN denoise failed; using firefly-clamped frame.",c),a=r.clampFireflies(e),o=!0}return Yn||mT(s,a),{image:a,failed:o,error:l}}`;
const DENOISE_RESULT_DECLARATION_ORIGINAL =
  `try{let a=pT(Ot,t,n),o=!1;if(e.denoise.enabled)`;
const DENOISE_RESULT_DECLARATION_DIAGNOSTIC =
  `try{let a=pT(Ot,t,n),o=!1,d;if(e.denoise.enabled)`;
const DENOISE_RESULT_ORIGINAL =
  `Nm(),{image:a,failed:o}=await uT(Ot,a,l,h,e)}if(Yn)return;const c=await createImageBitmap(gT(a));Zn.postMessage({type:"DONE",bitmap:c,denoiseFailed:o},[c])`;
const DENOISE_RESULT_DIAGNOSTIC =
  `Nm(),{image:a,failed:o,error:d}=await uT(Ot,a,l,h,e)}if(Yn)return;const c=await createImageBitmap(gT(a));Zn.postMessage({type:"DONE",bitmap:c,denoiseFailed:o,denoiseError:d},[c])`;
const DENOISE_CLIENT_ORIGINAL =
  `if(e.type==="DONE"){this.__stopStepping();const t=this.__pending;this.__pending=null,t?.resolve({bitmap:e.bitmap,denoiseFailed:e.denoiseFailed});return}`;
const DENOISE_CLIENT_DIAGNOSTIC =
  `if(e.type==="DONE"){this.__stopStepping();const t=this.__pending;this.__pending=null,globalThis.__PACKCAD_DENOISE_LAST_ERROR__=e.denoiseError??null,t?.resolve({bitmap:e.bitmap,denoiseFailed:e.denoiseFailed});return}`;
const DENOISE_WEIGHTS_ERROR_ORIGINAL =
  `if(s+=2,o!==16855)throw new Error("Invalid or corrupted weights blob")`;
const DENOISE_WEIGHTS_ERROR_DIAGNOSTIC =
  `if(s+=2,o!==16855)throw new Error("Invalid or corrupted weights blob (length "+n.byteLength+", prefix "+Array.from(new Uint8Array(n,0,Math.min(16,n.byteLength))).join(",")+")")`;
const DENOISE_MODEL_FETCH_ORIGINAL =
  `async function Ud(n){const e=await fetch(n,{method:"HEAD"});if(!e.ok)throw new Error(\`Failed to fetch TZA file headers from \${n}\`);const t=e.headers.get("Content-Disposition");let s=null;if(t){const r=t.match(/filename="?(.+?)"?$/);r?.[1]&&(s=r[1])}if(s||(s=new URL(n).pathname.split("/").pop()),!s||!s.endsWith(".tza"))throw new Error(\`The file at \${n} does not appear to be a TZA file based on its extension.\`);const o=await fetch(n);if(!o.ok)throw new Error(\`Failed to load TZA file from \${n}\`);return await o.arrayBuffer()}`;
const DENOISE_MODEL_FETCH_LOCAL =
  `async function Ud(n){const{default:e}=await import("./denoiser-weights-local.js"),t=atob(e),s=new Uint8Array(t.length);for(let o=0;o<t.length;o++)s[o]=t.charCodeAt(o);return s.buffer}`;

function replaceUnique(source, original, replacement, label) {
  const first = source.indexOf(original);
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Could not uniquely locate the v1.4.3 ${label}.`);
  }
  return (
    source.slice(0, first) +
    replacement +
    source.slice(first + original.length)
  );
}

async function ensureDenoiserWeights() {
  let bytes;
  let foundAtRuntimePath = true;
  try {
    bytes = await readFile(denoiserWeightsUrl);
  } catch {
    foundAtRuntimePath = false;
    try {
      bytes = await readFile(legacyDenoiserWeightsUrl);
    } catch {
      // A missing local model is downloaded below.
    }
  }
  let valid =
    bytes?.byteLength === DENOISE_WEIGHTS_SIZE &&
    bytes[0] === 0xd7 &&
    bytes[1] === 0x41;
  if (!valid) {
    const response = await fetch(DENOISE_WEIGHTS_FILE_URL);
    if (!response.ok) {
      throw new Error(
        `Could not download pinned denoiser weights (${response.status}).`,
      );
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    valid =
      bytes.byteLength === DENOISE_WEIGHTS_SIZE &&
      bytes[0] === 0xd7 &&
      bytes[1] === 0x41;
    if (!valid) {
      throw new Error("Downloaded denoiser weights failed size or magic checks.");
    }
  }
  if (foundAtRuntimePath) return false;

  await mkdir(new URL(".", denoiserWeightsUrl), { recursive: true });
  await writeFile(denoiserWeightsUrl, bytes);
  return true;
}

async function writeDenoiserWeightsModule() {
  const bytes = await readFile(denoiserWeightsUrl);
  if (
    bytes.byteLength !== DENOISE_WEIGHTS_SIZE ||
    bytes[0] !== 0xd7 ||
    bytes[1] !== 0x41
  ) {
    throw new Error("Local denoiser weights failed size or magic checks.");
  }
  const encoded = Buffer.from(bytes).toString("base64");
  await writeFile(denoiserWeightsModuleUrl, `export default ${JSON.stringify(encoded)};\n`);
}

let mainSource = await readFile(bundlePath, "utf8");
const alteredRenderClientSpecifier = RENDER_CLIENT_LOCAL_CHUNKS.find(
  (candidate) => mainSource.includes(candidate),
);
if (alteredRenderClientSpecifier) {
  mainSource = replaceUnique(
    mainSource,
    alteredRenderClientSpecifier,
    RENDER_CLIENT_CHUNK,
    "render client chunk specifier",
  );
  log("Restored the original v1.4.3 render client chunk name.");
} else if (!mainSource.includes(RENDER_CLIENT_CHUNK)) {
  throw new Error("Could not locate the v1.4.3 render client chunk specifier.");
}

if (!mainSource.includes(SOURCE_RETENTION_MARKER)) {
  mainSource = replaceUnique(
    mainSource,
    SOURCE_WIPE,
    SOURCE_RETENTION_MARKER,
    "imported-SVG source wipe",
  );
  log("Patched v1.4.3 to retain imported SVG source in the local mirror.");
} else {
  log("The v1.4.3 local source-retention patch is already present.");
}
await writeFile(bundlePath, mainSource);

// Always derive the runnable chunks from pristine recovered assets. This
// prevents a rerun from accumulating diagnostic or cache-busting mutations.
const pristineRenderClient = await readFile(pristineRenderClientPath, "utf8");
let patchedRenderClient = replaceUnique(
  pristineRenderClient,
  DENOISE_WEIGHTS_CDN,
  DENOISE_WEIGHTS_LOCAL,
  "render-client denoiser weights URL",
);

const pristinePathTraceWorker = await readFile(
  pristinePathTraceWorkerPath,
  "utf8",
);
let patchedPathTraceWorker = replaceUnique(
  pristinePathTraceWorker,
  DENOISE_WEIGHTS_CDN,
  DENOISE_WEIGHTS_LOCAL,
  "worker denoiser weights URL",
);
if (ENABLE_DENOISER_DIAGNOSTICS) {
  patchedRenderClient = replaceUnique(
    patchedRenderClient,
    DENOISE_CLIENT_ORIGINAL,
    DENOISE_CLIENT_DIAGNOSTIC,
    "denoiser result handler",
  );
  for (const [original, replacement, label] of [
    [
      DENOISE_RESULT_DECLARATION_ORIGINAL,
      DENOISE_RESULT_DECLARATION_DIAGNOSTIC,
      "denoiser result declaration",
    ],
    [DENOISE_WORKER_ORIGINAL, DENOISE_WORKER_DIAGNOSTIC, "denoiser error capture"],
    [DENOISE_RESULT_ORIGINAL, DENOISE_RESULT_DIAGNOSTIC, "denoiser result message"],
  ]) {
    patchedPathTraceWorker = replaceUnique(
      patchedPathTraceWorker,
      original,
      replacement,
      label,
    );
  }
  log("Enabled temporary v1.4.3 denoiser diagnostics.");
}
let pristineDenoiserRuntime = await readFile(
  pristineDenoiserRuntimePath,
  "utf8",
);
pristineDenoiserRuntime = replaceUnique(
  pristineDenoiserRuntime,
  DENOISE_MODEL_FETCH_ORIGINAL,
  DENOISE_MODEL_FETCH_LOCAL,
  "TZA model fetch",
);
if (ENABLE_DENOISER_DIAGNOSTICS) {
  pristineDenoiserRuntime = replaceUnique(
    pristineDenoiserRuntime,
    DENOISE_WEIGHTS_ERROR_ORIGINAL,
    DENOISE_WEIGHTS_ERROR_DIAGNOSTIC,
    "TZA model header check",
  );
}

await Promise.all([
  writeFile(renderClientPath, patchedRenderClient),
  writeFile(pathTraceWorkerPath, patchedPathTraceWorker),
  writeFile(denoiserRuntimePath, pristineDenoiserRuntime),
]);
log("Rebuilt the renderer from pristine assets with local denoiser weights.");

if (await ensureDenoiserWeights()) {
  log("Downloaded and verified the pinned v1.4.3 denoiser weights locally.");
} else {
  log("The pinned v1.4.3 local denoiser weights are present and valid.");
}
await writeDenoiserWeightsModule();
log("Embedded the verified denoiser model in a worker-safe local JS module.");
