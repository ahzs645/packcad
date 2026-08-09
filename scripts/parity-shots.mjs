#!/usr/bin/env node
// Edge-parity screenshot utility: captures MATCHED views of the local
// Atelier-based PackCAD app and the offline reference mirror.
//
//   pnpm shots:parity            capture all named views
//   VIEWS=full,corner-top       capture a subset
//   APP_URL / REF_URL / OUT_DIR  override autodetection
//
// How matching works: our app exposes a dev-only camera hook, so its views are
// framed exactly (direction/target/zoom, targets resolved from the live mesh
// bounds). The reference has no camera API and its wheel zoom anchors at the
// orbit target, so instead of navigating it per view, the script captures one
// high-DPI anchor frame per orientation from its deterministic boot orbit
// (plus a recorded coarse orbit drag for non-default orientations), REGISTERS
// that anchor against our matching anchor via masked image correlation, and
// then CROPS every close-up out of the reference anchor using the recovered
// pixel mapping. Both sides of every pair therefore show the same world rect.
//
// puppeteer-core + pngjs are bootstrapped into ~/.cache/packcad-parity-shots
// on first run so the pnpm workspace stays untouched.

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKCAD_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(homedir(), ".cache", "packcad-parity-shots");
const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const OURS_DPR = 2; // our renderer caps devicePixelRatio at 2
const REF_DPR = 3;

/**
 * Named views. `dir` is the camera direction in OUR scene axes; the reference
 * reaches the same orientation with an orbit drag computed from its
 * deterministic boot camera (which maps to (-1,1,-1) in our axes) using the
 * calibrated drag sensitivities below. `target` is "center" or
 * "corner-front-left" (resolved against the shell bounding box at height `y`).
 */
const ALL_VIEWS = [
  { name: "full", dir: [-1, 1, -1], refDrag: null, target: "center", zoom: null },
  {
    name: "corner-top",
    dir: [-1, 1, -1],
    refDrag: null,
    target: "corner-front-left",
    y: 0.28,
    zoom: 3.0,
  },
  {
    // The reference reaches this orientation with the recorded orbit drag
    // below, replayed from its deterministic boot camera. NOTE: orbit-drag
    // rotation scales with canvas size, so this (refDrag, dir) pair is only
    // valid at the 1440x940 capture viewport; the matching direction was
    // matched against the captured anchor with a fine sweep grid
    // (az 174deg, el 4.5deg in our y-up spherical convention).
    name: "corner-front",
    dir: [0.104, 0.078, -0.991],
    refDrag: [150, -80],
    target: "corner-front-right",
    y: 0.28,
    zoom: 3.2,
  },
];

const REF_BOOT_DIR = [-1, 1, -1];

function dirToSpherical([x, y, z]) {
  const norm = Math.hypot(x, y, z);
  return { az: Math.atan2(x / norm, z / norm), el: Math.asin(y / norm) };
}

function sphericalToDir(az, el) {
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- dependency bootstrap ---------------------------------------------------

function loadDeps() {
  const resolveFrom = (name) => {
    for (const base of [PACKCAD_ROOT, CACHE_DIR]) {
      try {
        // Anchor resolution inside each base so a bootstrap that ran moments
        // ago in this same process is picked up.
        return createRequire(path.join(base, "__resolve__.js"))(name);
      } catch {
        // keep looking
      }
    }
    return null;
  };
  let puppeteer = resolveFrom("puppeteer-core");
  let pngjs = resolveFrom("pngjs");
  if (!puppeteer || !pngjs) {
    console.log("Bootstrapping capture dependencies into", CACHE_DIR);
    mkdirSync(CACHE_DIR, { recursive: true });
    execSync("npm install puppeteer-core pngjs --no-audit --no-fund --prefix .", {
      cwd: CACHE_DIR,
      stdio: "inherit",
    });
    puppeteer = resolveFrom("puppeteer-core");
    pngjs = resolveFrom("pngjs");
  }
  return { puppeteer, PNG: pngjs.PNG };
}

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chrome) {
    throw new Error("No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH.");
  }
  return chrome;
}

// --- servers ----------------------------------------------------------------

async function urlAlive(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await urlAlive(url)) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureAppServer() {
  if (process.env.APP_URL) return { url: process.env.APP_URL, stop: () => {} };
  for (const port of [5173, 5174, 5175]) {
    const url = `http://localhost:${port}/`;
    if (await urlAlive(url)) return { url, stop: () => {} };
  }
  console.log("Starting vite dev server...");
  const child = spawn("pnpm", ["dev", "--port", "4301", "--strictPort"], {
    cwd: PACKCAD_ROOT,
    stdio: "ignore",
  });
  const url = "http://localhost:4301/";
  await waitForUrl(url, 90000);
  return { url, stop: () => child.kill("SIGTERM") };
}

async function ensureReferenceServer() {
  if (process.env.REF_URL) return { url: process.env.REF_URL, stop: () => {} };
  const url = "http://127.0.0.1:4179/app.packcad.com/mockup/";
  if (await urlAlive(url)) return { url, stop: () => {} };
  console.log("Starting reference mirror server...");
  const child = spawn(
    "python3",
    ["-m", "http.server", "4179", "--bind", "127.0.0.1", "--directory", "artifacts/reference-prettified"],
    { cwd: PACKCAD_ROOT, stdio: "ignore" },
  );
  await waitForUrl(url, 20000);
  return { url, stop: () => child.kill("SIGTERM") };
}

// --- small image library (pngjs-backed) -------------------------------------

function readPng(PNG, file) {
  return PNG.sync.read(readFileSync(file));
}

function writePng(PNG, file, png) {
  writeFileSync(file, PNG.sync.write(png));
}

/** Luminance + foreground mask (background is near-white grey). */
function toLuminance(png) {
  const { width, height, data } = png;
  const lum = new Float32Array(width * height);
  const fg = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const value = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = value;
    fg[i] = value < 235 || Math.abs(r - g) > 12 || Math.abs(g - b) > 12 ? 1 : 0;
  }
  return { width, height, lum, fg };
}

function downscaleLum(img, targetW) {
  const factor = img.width / targetW;
  const targetH = Math.round(img.height / factor);
  const lum = new Float32Array(targetW * targetH);
  const fg = new Uint8Array(targetW * targetH);
  for (let y = 0; y < targetH; y += 1) {
    for (let x = 0; x < targetW; x += 1) {
      const sx = Math.min(img.width - 1, Math.round(x * factor));
      const sy = Math.min(img.height - 1, Math.round(y * factor));
      lum[y * targetW + x] = img.lum[sy * img.width + sx];
      fg[y * targetW + x] = img.fg[sy * img.width + sx];
    }
  }
  return { width: targetW, height: targetH, lum, fg, factor };
}

/**
 * Silhouette matcher: maximize the Dice overlap of foreground masks. The
 * outline shape changes sharply with orientation, so this is the calibration
 * metric — luminance/edge NCC plateaus under orientation error.
 */
function registerMasks(A, B, scaleRange) {
  const areaB = B.fg.reduce((sum, v) => sum + v, 0);
  let best = { score: -Infinity, scale: 1, dx: 0, dy: 0 };
  for (let scale = scaleRange[0]; scale <= scaleRange[1]; scale += 0.05) {
    for (let dy = -B.height; dy < B.height; dy += 2) {
      for (let dx = -B.width; dx < B.width; dx += 2) {
        let inter = 0;
        let areaA = 0;
        for (let y = 0; y < A.height; y += 1) {
          for (let x = 0; x < A.width; x += 1) {
            if (!A.fg[y * A.width + x]) continue;
            areaA += 1;
            const bx = Math.round(x * scale + dx);
            const by = Math.round(y * scale + dy);
            if (bx < 0 || by < 0 || bx >= B.width || by >= B.height) continue;
            if (B.fg[by * B.width + bx]) inter += 1;
          }
        }
        if (areaA < 100) continue;
        // Dice on A's mask vs B's mask scaled into A's density
        const score = (2 * inter) / (areaA + areaB / (scale * scale));
        if (score > best.score) best = { score: score * 255, scale, dx, dy };
      }
    }
  }
  return {
    scale: (best.scale * B.factor) / A.factor,
    dx: best.dx * B.factor,
    dy: best.dy * B.factor,
    score: best.score,
  };
}

/** Gradient magnitude of a downscaled luminance image (in place). */
function toEdges(img) {
  const { width, height, lum } = img;
  const mag = new Float32Array(width * height);
  const fg = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const gx = lum[y * width + x + 1] - lum[y * width + x - 1];
      const gy = lum[(y + 1) * width + x] - lum[(y - 1) * width + x];
      const value = Math.min(255, Math.abs(gx) + Math.abs(gy));
      mag[y * width + x] = value;
      fg[y * width + x] = value > 30 ? 1 : 0;
    }
  }
  return { ...img, lum: mag, fg };
}

/**
 * Find affine mapping refPx = scale * oursPx + (dx, dy) by masked NCC search.
 * Returns the mapping in FULL-RESOLUTION pixel coordinates. `edges` correlates
 * gradient maps instead of luminance — slower to score high but far more
 * orientation-sensitive, which the calibration sweep needs.
 */
function maskBounds(img) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let area = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (!img.fg[y * img.width + x]) continue;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!area) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1, area };
}

function registerImages(oursImg, refImg, mode = "lum") {
  let A = downscaleLum(oursImg, 150);
  let B = downscaleLum(refImg, 220);
  if (mode === "edges") {
    A = toEdges(A);
    B = toEdges(B);
  }
  if (mode === "mask") return registerMasks(A, B, [0.6, 1.8]);
  // Seed scale and offset from the foreground bounding boxes: both captures
  // show the same subject, so the physically sensible alignment scales one
  // silhouette onto the other. Searching blindly instead finds wrong-scale
  // local optima on repetitive artwork.
  const boundsA = maskBounds(A);
  const boundsB = maskBounds(B);
  const seedScale = boundsA && boundsB
    ? Math.min(boundsB.w / boundsA.w, boundsB.h / boundsA.h)
    : 1;
  const seedDx = boundsA && boundsB
    ? (boundsB.minX + boundsB.w / 2) - (boundsA.minX + boundsA.w / 2) * seedScale
    : 0;
  const seedDy = boundsA && boundsB
    ? (boundsB.minY + boundsB.h / 2) - (boundsA.minY + boundsA.h / 2) * seedScale
    : 0;
  let best = { score: -Infinity, scale: seedScale, dx: seedDx, dy: seedDy };
  const scales = [];
  for (let s = seedScale * 0.8; s <= seedScale * 1.25; s += seedScale * 0.03) scales.push(s);
  for (const scale of scales) {
    // scale maps A-small pixels to B-small pixels
    for (let dy = seedDy - 30; dy <= seedDy + 30; dy += 3) {
      for (let dx = seedDx - 30; dx <= seedDx + 30; dx += 3) {
        let sum = 0;
        let count = 0;
        for (let y = 0; y < A.height; y += 2) {
          for (let x = 0; x < A.width; x += 2) {
            if (!A.fg[y * A.width + x]) continue;
            const bx = Math.round(x * scale + dx);
            const by = Math.round(y * scale + dy);
            if (bx < 0 || by < 0 || bx >= B.width || by >= B.height) continue;
            const diff = A.lum[y * A.width + x] - B.lum[by * B.width + bx];
            sum += 255 - Math.abs(diff);
            count += 1;
          }
        }
        if (count < 60) continue;
        const score = (sum / count) * Math.min(1, count / 400);
        if (score > best.score) best = { score, scale, dx, dy };
      }
    }
  }
  // refine around the coarse optimum
  for (let scale = best.scale - 0.04; scale <= best.scale + 0.04; scale += 0.01) {
    for (let dy = best.dy - 3; dy <= best.dy + 3; dy += 1) {
      for (let dx = best.dx - 3; dx <= best.dx + 3; dx += 1) {
        let sum = 0;
        let count = 0;
        for (let y = 0; y < A.height; y += 1) {
          for (let x = 0; x < A.width; x += 1) {
            if (!A.fg[y * A.width + x]) continue;
            const bx = Math.round(x * scale + dx);
            const by = Math.round(y * scale + dy);
            if (bx < 0 || by < 0 || bx >= B.width || by >= B.height) continue;
            sum += 255 - Math.abs(A.lum[y * A.width + x] - B.lum[by * B.width + bx]);
            count += 1;
          }
        }
        if (count < 200) continue;
        const score = sum / count;
        if (score > best.score) best = { score, scale, dx, dy };
      }
    }
  }
  // convert small-image mapping to full resolution:
  // aFull = aSmall * A.factor ; bFull = bSmall * B.factor
  // bSmall = aSmall*scale + d  =>  bFull = aFull * (scale*B.factor/A.factor) + d*B.factor
  return {
    scale: (best.scale * B.factor) / A.factor,
    dx: best.dx * B.factor,
    dy: best.dy * B.factor,
    score: best.score,
  };
}

/**
 * Upgrade the global similarity mapping to a full affine by matching a grid of
 * landmark patches from A into B (translation-only NCC per patch, seeded by
 * the similarity) and least-squares fitting refPx = M * oursPx + t. The affine
 * absorbs the shear/anisotropy a small orientation mismatch introduces, which
 * a scale+offset model cannot.
 */
function patchAffine(oursImg, refImg, seed) {
  const A = downscaleLum(oursImg, 300);
  const B = downscaleLum(refImg, 440);
  const seedScale = (seed.scale * A.factor) / B.factor; // A-small -> B-small
  const seedDx = seed.dx / B.factor;
  const seedDy = seed.dy / B.factor;
  const bounds = maskBounds(A);
  if (!bounds) return null;
  const half = 22;
  const search = 26;
  const pairs = [];
  for (let gy = 0; gy < 4; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      const cx = Math.round(bounds.minX + ((gx + 0.5) / 5) * bounds.w);
      const cy = Math.round(bounds.minY + ((gy + 0.5) / 4) * bounds.h);
      if (cx - half < 0 || cy - half < 0 || cx + half >= A.width || cy + half >= A.height) continue;
      // patch must contain real content
      let fgCount = 0;
      for (let y = -half; y <= half; y += 2) {
        for (let x = -half; x <= half; x += 2) {
          if (A.fg[(cy + y) * A.width + cx + x]) fgCount += 1;
        }
      }
      if (fgCount < 120) continue;
      const bx0 = cx * seedScale + seedDx;
      const by0 = cy * seedScale + seedDy;
      let bestPos = null;
      let bestScore = -Infinity;
      for (let oy = -search; oy <= search; oy += 1) {
        for (let ox = -search; ox <= search; ox += 1) {
          let sum = 0;
          let count = 0;
          for (let y = -half; y <= half; y += 2) {
            for (let x = -half; x <= half; x += 2) {
              const bx = Math.round(bx0 + ox + x * seedScale);
              const by = Math.round(by0 + oy + y * seedScale);
              if (bx < 0 || by < 0 || bx >= B.width || by >= B.height) continue;
              sum += 255 - Math.abs(A.lum[(cy + y) * A.width + cx + x] - B.lum[by * B.width + bx]);
              count += 1;
            }
          }
          if (count < 200) continue;
          const score = sum / count;
          if (score > bestScore) {
            bestScore = score;
            bestPos = [bx0 + ox, by0 + oy];
          }
        }
      }
      if (bestPos && bestScore > 195) {
        pairs.push({
          a: [cx * A.factor, cy * A.factor],
          b: [bestPos[0] * B.factor, bestPos[1] * B.factor],
          w: bestScore - 195,
        });
      }
    }
  }
  if (pairs.length < 5) return null;
  // weighted least squares for [m00 m01 tx; m10 m11 ty]
  const solveRow = (component) => {
    let sxx = 0, sxy = 0, sx1 = 0, syy = 0, sy1 = 0, s11 = 0;
    let bx = 0, by = 0, b1 = 0;
    for (const { a, b, w } of pairs) {
      const target = component === 0 ? b[0] : b[1];
      sxx += w * a[0] * a[0]; sxy += w * a[0] * a[1]; sx1 += w * a[0];
      syy += w * a[1] * a[1]; sy1 += w * a[1]; s11 += w;
      bx += w * a[0] * target; by += w * a[1] * target; b1 += w * target;
    }
    // 3x3 normal equations, Cramer's rule
    const m = [sxx, sxy, sx1, sxy, syy, sy1, sx1, sy1, s11];
    const det3 = (q) => q[0] * (q[4] * q[8] - q[5] * q[7])
      - q[1] * (q[3] * q[8] - q[5] * q[6])
      + q[2] * (q[3] * q[7] - q[4] * q[6]);
    const d = det3(m);
    if (Math.abs(d) < 1e-9) return null;
    const rhs = [bx, by, b1];
    const col = (idx) => det3(m.map((value, position) =>
      position % 3 === idx ? rhs[Math.floor(position / 3)] : value));
    return [col(0) / d, col(1) / d, col(2) / d];
  };
  const rowX = solveRow(0);
  const rowY = solveRow(1);
  if (!rowX || !rowY) return null;
  return {
    apply: ([x, y]) => [
      rowX[0] * x + rowX[1] * y + rowX[2],
      rowY[0] * x + rowY[1] * y + rowY[2],
    ],
    pairs: pairs.length,
  };
}

/**
 * Refine a predicted crop rect by sliding/rescaling it locally so the cropped
 * reference region best matches OUR captured view. Absorbs the residual error
 * a small orientation mismatch leaves in the global anchor registration.
 */
function refineRect(oursImg, refImg, seed) {
  const A = downscaleLum(oursImg, 120);
  const evaluate = (rect) => {
    let sum = 0;
    let count = 0;
    for (let y = 0; y < A.height; y += 2) {
      for (let x = 0; x < A.width; x += 2) {
        if (!A.fg[y * A.width + x]) continue;
        const rx = Math.round(rect.x + (rect.w * x) / A.width);
        const ry = Math.round(rect.y + (rect.h * y) / A.height);
        if (rx < 0 || ry < 0 || rx >= refImg.width || ry >= refImg.height) continue;
        sum += 255 - Math.abs(A.lum[y * A.width + x] - refImg.lum[ry * refImg.width + rx]);
        count += 1;
      }
    }
    return count < 120 ? -Infinity : sum / count;
  };
  const searchAround = (center, spanF, stepF, scales) => {
    let best = { score: -Infinity, rect: center };
    for (const scale of scales) {
      const w = seed.w * scale;
      const h = seed.h * scale;
      for (let fy = -spanF; fy <= spanF; fy += stepF) {
        for (let fx = -spanF; fx <= spanF; fx += stepF) {
          const rect = {
            x: center.x + seed.w * fx + (center.w - w) / 2,
            y: center.y + seed.h * fy + (center.h - h) / 2,
            w,
            h,
          };
          const score = evaluate(rect);
          if (score > best.score) best = { score, rect };
        }
      }
    }
    return best;
  };
  // Coarse: sweep the ENTIRE anchor so a wrong-corner seed (mirror ambiguity
  // on near-symmetric frontal views) can still recover; the crop-sized content
  // window disambiguates via the artwork. Then polish locally.
  let coarse = { score: -Infinity, rect: seed };
  for (const scale of [0.9, 0.96, 1.02, 1.08]) {
    const w = seed.w * scale;
    const h = seed.h * scale;
    for (let y = -h * 0.2; y <= refImg.height - h * 0.8; y += h * 0.1) {
      for (let x = -w * 0.2; x <= refImg.width - w * 0.8; x += w * 0.1) {
        const score = evaluate({ x, y, w, h });
        if (score > coarse.score) coarse = { score, rect: { x, y, w, h } };
      }
    }
  }
  const fineScales = [];
  const coarseScale = coarse.rect.w / seed.w;
  for (let s = coarseScale - 0.045; s <= coarseScale + 0.045; s += 0.015) fineScales.push(s);
  return searchAround(coarse.rect, 0.08, 0.012, fineScales);
}

/** Crop rect from png (clamped) and bilinear-resize to outW x outH. */
function cropResize(PNG, png, rect, outW, outH) {
  const out = new PNG({ width: outW, height: outH });
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(png.width, rect.x + rect.w);
  const y1 = Math.min(png.height, rect.y + rect.h);
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const sx = x0 + ((x1 - x0) * x) / outW;
      const sy = y0 + ((y1 - y0) * y) / outH;
      const ix = Math.min(png.width - 2, Math.floor(sx));
      const iy = Math.min(png.height - 2, Math.floor(sy));
      const fx = sx - ix;
      const fy = sy - iy;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = png.data[(iy * png.width + ix) * 4 + channel];
        const p10 = png.data[(iy * png.width + ix + 1) * 4 + channel];
        const p01 = png.data[((iy + 1) * png.width + ix) * 4 + channel];
        const p11 = png.data[((iy + 1) * png.width + ix + 1) * 4 + channel];
        out.data[(y * outW + x) * 4 + channel] =
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy)
          + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
    }
  }
  return out;
}

// --- browser helpers --------------------------------------------------------

async function canvasRect(page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")]
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
}

async function shootCanvas(page, file) {
  const rect = await canvasRect(page);
  await page.screenshot({
    path: file,
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  });
  return rect;
}

/**
 * Set our camera for a view and return the projection info needed to compute
 * where world points land in the capture: css canvas size plus the combined
 * projection*view matrix and the world rect the view covers.
 */
async function setOursView(page, view) {
  return page.evaluate(({ dir, target, y, zoom }) => {
    const viewport = window.__packcadViewports?.["3d"];
    if (!viewport) return null;
    let group = null;
    viewport.scene.traverse((object) => {
      if (object.name === "PackCAD folded package") group = object;
    });
    let bounds = null;
    group?.traverse((object) => {
      const box = object.geometry?.boundingBox;
      if (!box) return;
      if (!bounds) {
        bounds = {
          min: { x: box.min.x, y: box.min.y, z: box.min.z },
          max: { x: box.max.x, y: box.max.y, z: box.max.z },
        };
      } else {
        bounds.min.x = Math.min(bounds.min.x, box.min.x);
        bounds.min.y = Math.min(bounds.min.y, box.min.y);
        bounds.min.z = Math.min(bounds.min.z, box.min.z);
        bounds.max.x = Math.max(bounds.max.x, box.max.x);
        bounds.max.y = Math.max(bounds.max.y, box.max.y);
        bounds.max.z = Math.max(bounds.max.z, box.max.z);
      }
    });
    const state = viewport.camera.getState();
    let focus;
    if (target === "corner-front-left" && bounds) {
      focus = [bounds.min.x + 0.02, y ?? 0.28, bounds.min.z + 0.02];
    } else if (target === "corner-front-right" && bounds) {
      focus = [bounds.max.x - 0.02, y ?? 0.28, bounds.min.z + 0.02];
    } else {
      focus = state.target;
    }
    const distance = Math.hypot(
      state.position[0] - state.target[0],
      state.position[1] - state.target[1],
      state.position[2] - state.target[2],
    );
    const norm = Math.hypot(...dir) || 1;
    viewport.camera.setState({
      ...state,
      target: focus,
      position: [
        focus[0] + (dir[0] / norm) * distance,
        focus[1] + (dir[1] / norm) * distance,
        focus[2] + (dir[2] / norm) * distance,
      ],
      zoom: zoom ?? state.zoom * 1.2,
    });
    return { ok: true };
  }, view);
}

/** Read the current camera's projection data (after render settles). */
async function readOursCamera(page) {
  return page.evaluate(() => {
    const viewport = window.__packcadViewports?.["3d"];
    const camera = viewport.camera.camera;
    camera.updateMatrixWorld(true);
    const canvas = viewport.renderer.domElement;
    return {
      cssW: canvas.clientWidth,
      cssH: canvas.clientHeight,
      view: [...camera.matrixWorldInverse.elements],
      proj: [...camera.projectionMatrix.elements],
      world: [...camera.matrixWorld.elements],
      frustum: {
        left: camera.left,
        right: camera.right,
        top: camera.top,
        bottom: camera.bottom,
        zoom: camera.zoom,
      },
      target: viewport.camera.getState().target,
    };
  });
}

/** Project a world point to capture pixels using readOursCamera data. */
function projectPoint(camera, dpr, point) {
  const mul = (m, v) => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
  const eye = mul(camera.view, [...point, 1]);
  const clip = mul(camera.proj, eye);
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  return [((ndcX + 1) / 2) * camera.cssW * dpr, ((1 - ndcY) / 2) * camera.cssH * dpr];
}

/** World-space corners of the current ortho view. */
function viewWorldCorners(camera) {
  const right = [camera.world[0], camera.world[1], camera.world[2]];
  const up = [camera.world[4], camera.world[5], camera.world[6]];
  const halfW = (camera.frustum.right - camera.frustum.left) / 2 / camera.frustum.zoom;
  const halfH = (camera.frustum.top - camera.frustum.bottom) / 2 / camera.frustum.zoom;
  const t = camera.target;
  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      corners.push([
        t[0] + right[0] * halfW * sx + up[0] * halfH * sy,
        t[1] + right[1] * halfW * sx + up[1] * halfH * sy,
        t[2] + right[2] * halfW * sx + up[2] * halfH * sy,
      ]);
    }
  }
  return corners;
}

async function hideReferenceOverlays(page) {
  await page.evaluate(() => {
    const needles = ["Ready to Fold Your Design", "Stay in Touch"];
    for (const div of document.querySelectorAll("div")) {
      const text = div.textContent || "";
      if (!needles.some((needle) => text.includes(needle))) continue;
      if (text.length > 300) continue; // keep containers of the whole app alive
      div.style.display = "none";
    }
  });
}

async function refOrbitDrag(page, [dx, dy]) {
  const rect = await canvasRect(page);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
    await sleep(30);
  }
  await page.mouse.up();
  await sleep(700);
}

// --- orbit calibration ------------------------------------------------------

/**
 * Measure the reference's orbit-drag sensitivity: drag by a known pixel
 * amount, then find which of OUR camera orientations best matches the result
 * via registration score. Prints px-per-radian for both axes.
 */
async function calibrate(browser, ours, refUrl) {
  const { PNG } = loadDeps();
  const tmp = path.join(CACHE_DIR, "calibration");
  mkdirSync(tmp, { recursive: true });
  const boot = dirToSpherical(REF_BOOT_DIR);
  const probe = async (drag, sweep) => {
    const ref = await browser.newPage();
    await ref.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
    await ref.goto(refUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(5000);
    await hideReferenceOverlays(ref);
    await refOrbitDrag(ref, drag);
    const refFile = path.join(tmp, "ref-probe.png");
    await shootCanvas(ref, refFile);
    const refImg = toLuminance(readPng(PNG, refFile));
    await ref.close();
    let best = { score: -Infinity, offset: 0 };
    for (const offset of sweep) {
      const dir = drag[1] === 0
        ? sphericalToDir(boot.az + offset, boot.el)
        : sphericalToDir(boot.az, boot.el + offset);
      await setOursView(ours, { dir, target: "center", zoom: null });
      await sleep(900);
      const oursFile = path.join(tmp, "ours-probe.png");
      await shootCanvas(ours, oursFile);
      const oursImg = toLuminance(readPng(PNG, oursFile));
      const fit = registerImages(oursImg, refImg, "mask");
      console.log(
        `  offset ${(offset * 180 / Math.PI).toFixed(1)}deg -> score ${fit.score.toFixed(1)}`,
      );
      if (fit.score > best.score) best = { score: fit.score, offset };
    }
    return best.offset;
  };

  console.log("calibrating azimuth (drag +200,0)...");
  const sweepAz = [];
  for (let deg = -50; deg <= 50; deg += 7.5) sweepAz.push((deg * Math.PI) / 180);
  const azOffset = await probe([200, 0], sweepAz);
  console.log("calibrating elevation (drag 0,-120)...");
  const sweepEl = [];
  for (let deg = -35; deg <= 35; deg += 5) sweepEl.push((deg * Math.PI) / 180);
  const elOffset = await probe([0, -120], sweepEl);
  console.log("\nCalibration results:");
  console.log("  REF_AZ_PX_PER_RAD =", azOffset ? (200 / azOffset).toFixed(1) : "unresolved");
  console.log("  REF_EL_PX_PER_RAD =", elOffset ? (-120 / elOffset).toFixed(1) : "unresolved");
  console.log("Update the constants in scripts/parity-shots.mjs (or set env vars).");
}

// --- contact sheet ----------------------------------------------------------

function writeContactSheet(outDir, viewNames) {
  const rows = viewNames.map((name) => `
    <h2>${name}</h2>
    <div class="row">
      <figure><img src="ours-${name}.png"><figcaption>ours</figcaption></figure>
      <figure><img src="ref-${name}.png"><figcaption>reference</figcaption></figure>
    </div>`).join("\n");
  writeFileSync(path.join(outDir, "index.html"), `<!doctype html>
<meta charset="utf-8"><title>PackCAD edge parity</title>
<style>
  body { background: #111; color: #eee; font: 14px system-ui; margin: 24px; }
  .row { display: flex; gap: 12px; margin-bottom: 24px; }
  figure { flex: 1; margin: 0; }
  img { width: 100%; border: 1px solid #333; }
  figcaption { text-align: center; padding: 4px; color: #aaa; }
</style>
<h1>PackCAD edge parity — ${new Date().toISOString().slice(0, 16)}</h1>
${rows}`);
}

// --- main -------------------------------------------------------------------

const { puppeteer, PNG } = loadDeps();
const outDir = process.env.OUT_DIR
  ?? path.join(PACKCAD_ROOT, "artifacts", `parity-shots-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(outDir, { recursive: true });
const requestedViews = process.env.VIEWS
  ? ALL_VIEWS.filter((view) => process.env.VIEWS.split(",").includes(view.name))
  : ALL_VIEWS;

const app = await ensureAppServer();
const reference = await ensureReferenceServer();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "new",
  defaultViewport: { width: 1440, height: 940, deviceScaleFactor: OURS_DPR },
});

try {
  // ---- our app: exact camera framing per view -----------------------------
  const ours = await browser.newPage();
  await ours.goto(app.url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2500);
  const opened = await ours.evaluate(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.innerText.includes("Mailer Box"));
    if (!button) return false;
    button.click();
    return true;
  });
  if (!opened) throw new Error("Mailer Box entry not found in the app sidebar");
  await sleep(12000);

  // ---- optional calibration mode ------------------------------------------
  if (process.env.CALIBRATE) {
    await calibrate(browser, ours, reference.url);
    process.exit(0);
  }

  const orientationKey = (view) => view.dir.join(",");
  const orientations = new Map();
  for (const view of requestedViews) {
    if (!orientations.has(orientationKey(view))) {
      orientations.set(orientationKey(view), { dir: view.dir, refDrag: view.refDrag });
    }
  }

  // anchors: our fit-level capture per orientation (for registration)
  const oursAnchors = new Map();
  for (const [key, orientation] of orientations) {
    await setOursView(ours, { dir: orientation.dir, target: "center", zoom: null });
    await sleep(1200);
    const camera = await readOursCamera(ours);
    const file = path.join(outDir, `_ours-anchor-${key.replaceAll(",", "_")}.png`);
    await shootCanvas(ours, file);
    oursAnchors.set(key, { camera, file });
  }

  // per-view exact captures
  const oursViews = new Map();
  for (const view of requestedViews) {
    const result = await setOursView(ours, view);
    if (!result?.ok) throw new Error("__packcadViewports hook missing (production build?)");
    await sleep(1200);
    const camera = await readOursCamera(ours);
    const file = path.join(outDir, `ours-${view.name}.png`);
    await shootCanvas(ours, file);
    oursViews.set(view.name, { camera, file });
    console.log("captured ours-" + view.name);
  }

  // ---- reference: anchors per orientation + registration-based crops ------
  const ref = await browser.newPage();
  await ref.setViewport({ width: 1440, height: 940, deviceScaleFactor: REF_DPR });
  await ref.goto(reference.url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(5000);
  await hideReferenceOverlays(ref);

  let refOriented = false;
  for (const [key, orientation] of orientations) {
    if (refOriented) {
      // one orientation per page load keeps the deterministic boot orbit
      await ref.goto(reference.url, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(5000);
      await hideReferenceOverlays(ref);
    }
    refOriented = true;
    if (orientation.refDrag) await refOrbitDrag(ref, orientation.refDrag);
    const fitFile = path.join(outDir, `_ref-anchor-${key.replaceAll(",", "_")}.png`);
    await shootCanvas(ref, fitFile);

    const oursAnchor = oursAnchors.get(key);
    const oursImg = toLuminance(readPng(PNG, oursAnchor.file));
    const refFitImg = toLuminance(readPng(PNG, fitFile));
    const toFit = registerImages(oursImg, refFitImg);
    const affine = patchAffine(oursImg, refFitImg, toFit);
    console.log(
      `registered ${key}: ours->ref scale=${toFit.scale.toFixed(3)} ` +
      `score=${toFit.score.toFixed(1)}` +
      (affine ? ` affine(${affine.pairs} patches)` : " affine unavailable"),
    );
    const mapPoint = affine
      ? affine.apply
      : ([x, y]) => [x * toFit.scale + toFit.dx, y * toFit.scale + toFit.dy];

    // produce the matched reference image for every view in this orientation
    const refPng = readPng(PNG, fitFile);
    for (const view of requestedViews.filter((v) => orientationKey(v) === key)) {
      const oursView = oursViews.get(view.name);
      const corners = viewWorldCorners(oursView.camera)
        .map((corner) => projectPoint(oursAnchor.camera, OURS_DPR, corner))
        .map(mapPoint);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const seed = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
      const oursPng = readPng(PNG, oursView.file);
      const refined = refineRect(toLuminance(oursPng), refFitImg, seed);
      const out = cropResize(PNG, refPng, refined.rect, oursPng.width, oursPng.height);
      writePng(PNG, path.join(outDir, `ref-${view.name}.png`), out);
      console.log(
        `matched ref-${view.name} (refine score ${refined.score.toFixed(1)})`,
      );
    }
  }

  writeContactSheet(outDir, requestedViews.map((view) => view.name));
  console.log("\nWrote", outDir);
  console.log("Open", path.join(outDir, "index.html"));
} finally {
  await browser.close();
  app.stop();
  reference.stop();
}
