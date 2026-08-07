#!/usr/bin/env node
// Edge-parity screenshot utility: captures matched views of the local
// Atelier-based PackCAD app and the offline reference mirror, then writes the
// raw frames plus an HTML contact sheet for side-by-side comparison.
//
//   pnpm shots:parity            capture both apps
//   APP_URL=... REF_URL=...      override server autodetection
//   OUT_DIR=...                  override the output directory
//
// Servers: an already-running vite dev server (ports 5173-5175) and reference
// mirror (port 4179) are reused; otherwise the script starts its own and shuts
// them down afterwards. Chrome is driven headless via puppeteer-core, which is
// bootstrapped into ~/.cache/packcad-parity-shots on first run so the pnpm
// workspace stays untouched.

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadPuppeteer() {
  const require = createRequire(import.meta.url);
  for (const base of [PACKCAD_ROOT, CACHE_DIR]) {
    try {
      return require(require.resolve("puppeteer-core", { paths: [base] }));
    } catch {
      // keep looking
    }
  }
  console.log("Bootstrapping puppeteer-core into", CACHE_DIR);
  mkdirSync(CACHE_DIR, { recursive: true });
  execSync("npm install puppeteer-core --no-audit --no-fund --prefix .", {
    cwd: CACHE_DIR,
    stdio: "inherit",
  });
  return require(require.resolve("puppeteer-core", { paths: [CACHE_DIR] }));
}

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!chrome) {
    throw new Error(
      "No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH to a browser binary.",
    );
  }
  return chrome;
}

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

/** Reuse a live server or start our own; returns { url, stop }. */
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
    detached: false,
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

async function clickByText(page, selector, text) {
  return page.evaluate(({ selector, text }) => {
    const target = [...document.querySelectorAll(selector)]
      .find((element) => (element.innerText || "").trim().includes(text));
    if (!target) return false;
    // Radix-style menu rows react to pointer events rather than click().
    const rect = target.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      pointerId: 1,
    };
    target.dispatchEvent(new PointerEvent("pointermove", options));
    target.dispatchEvent(new PointerEvent("pointerdown", options));
    target.dispatchEvent(new PointerEvent("pointerup", options));
    target.dispatchEvent(new MouseEvent("click", options));
    return true;
  }, { selector, text });
}

async function canvasRect(page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")]
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  });
}

async function zoomAt(page, fractionX, fractionY, steps) {
  const rect = await canvasRect(page);
  await page.mouse.move(rect.x + rect.w * fractionX, rect.y + rect.h * fractionY);
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel({ deltaY: -120 });
    await sleep(120);
  }
  await sleep(900);
}

async function shoot(page, outDir, name) {
  const rect = await canvasRect(page);
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  });
  console.log("captured", name);
}

const VIEWS = [
  { name: "full", zoom: null },
  { name: "corner", zoom: { x: 0.68, y: 0.55, steps: 7 } },
  { name: "edge", zoom: { x: 0.5, y: 0.5, steps: 4 } },
];

async function captureViews(page, outDir, prefix) {
  for (const view of VIEWS) {
    if (view.zoom) await zoomAt(page, view.zoom.x, view.zoom.y, view.zoom.steps);
    await shoot(page, outDir, `${prefix}-${view.name}`);
  }
}

function writeContactSheet(outDir) {
  const rows = VIEWS.map(({ name }) => `
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

const outDir = process.env.OUT_DIR
  ?? path.join(PACKCAD_ROOT, "artifacts", `parity-shots-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(outDir, { recursive: true });

const puppeteer = await loadPuppeteer();
const app = await ensureAppServer();
const reference = await ensureReferenceServer();
const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "new",
  defaultViewport: { width: 1440, height: 940 },
});

try {
  const ours = await browser.newPage();
  await ours.goto(app.url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2500);
  // A fresh profile seeds the bundled Mailer Box draft; loading it opens the
  // project at its active step (Keyframe 5).
  if (!(await clickByText(ours, "button", "Mailer Box"))) {
    throw new Error("Mailer Box entry not found in the app sidebar");
  }
  await sleep(12000);
  await captureViews(ours, outDir, "ours");

  const ref = await browser.newPage();
  await ref.goto(reference.url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(4000);
  // The mirror boots its embedded MailerBox; stepping to a keyframe (when the
  // sidebar is present) runs the folding pipeline, otherwise the default
  // folded state is captured.
  await clickByText(ref, "div,button,li", "Folding Keyframe 5");
  await sleep(15000);
  await captureViews(ref, outDir, "ref");

  writeContactSheet(outDir);
  console.log("\nWrote", outDir);
  console.log("Open", path.join(outDir, "index.html"));
} finally {
  await browser.close();
  app.stop();
  reference.stop();
}
