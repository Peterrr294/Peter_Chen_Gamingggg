import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4178;
const base = `http://${host}:${port}`;
const pageUrl = `${base}/experiments/road-projection/`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };

async function findBrowser() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome or Edge was not found. Set PLAYWRIGHT_CHROME_PATH.');
}

async function startServer() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ready(pageUrl)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await findBrowser(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => errors.push(`page: ${error.message}`));

  await page.goto(`${base}/#home`, { waitUntil: 'networkidle' });
  assert(await page.locator('a[href="#flavor"]').count() >= 2, 'Homepage Flavor Clash parent entry is missing.');
  assert(await page.locator('a[href="#roadProjection"]').count() === 0, 'Road Projection should be grouped under Flavor Clash, not shown as a top-level entry.');
  await page.goto(`${base}/experiments/flavor-clash-prototype/`, { waitUntil: 'networkidle' });
  assert(await page.locator('a[href="../road-projection/"]').count() === 1, 'Flavor Clash Road Projection child entry is missing.');
  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__roadProjectionLab?.ready === true);

  const result = await page.evaluate(() => {
    const api = window.__roadProjectionLab;
    const initial = api.snapshot();
    const firstOutput = JSON.parse(api.snapshot().projectionJson);
    api.project();
    const repeated = api.snapshot();
    const paths = api.projection.paths;
    const samples = paths.flatMap(path => path.samples);
    const grounded = samples.every(sample => {
      const query = api.surfaceQuery.querySurface(sample.position.x, sample.position.z);
      return !query.inBounds || Math.abs(sample.position.y - (query.height + api.options.heightOffset)) < 0.00001;
    });
    const debugTypes = [];
    let roadMeshFound = false;
    api.debug.root.traverse(object => {
      if (object !== api.debug.root) debugTypes.push(object.type);
      if (object.isMesh) roadMeshFound = true;
    });
    api.options.sampleSpacing = 0.9;
    api.options.maximumSlope = 24;
    api.options.enableSlopeAvoidance = false;
    api.project();
    const changedParameters = api.snapshot();
    return {
      initial,
      repeated,
      changedParameters,
      firstOutput,
      grounded,
      debugTypes,
      roadMeshFound,
      invalidRanges: paths.reduce((total, item) => total + item.invalidRanges.length, 0),
      invalidSegments: paths.reduce((total, item) => total + item.samples.slice(1).filter((sample, index) => !sample.valid || !item.samples[index].valid).length, 0),
      sampleCount: samples.length,
    };
  });

  assert(result.initial.terrainSignature === '5F61302E', 'Existing Iceland terrain signature changed.');
  assert(result.initial.projectionJson === result.repeated.projectionJson, 'Same input did not produce the same projection output.');
  assert(result.initial.roadJson === result.repeated.roadJson && result.initial.roadJson === result.changedParameters.roadJson, 'Projection mutated the original road JSON.');
  assert(result.initial.terrainGenerationCount === result.changedParameters.terrainGenerationCount, 'Projection parameter changes regenerated terrain.');
  assert(result.initial.debugChildren === result.repeated.debugChildren && result.repeated.disposedDebugLayers > result.initial.disposedDebugLayers, 'Repeated projection accumulated or failed to dispose debug layers.');
  assert(result.grounded, 'Smoothed samples were not re-queried against the terrain surface.');
  assert(!result.roadMeshFound, 'Debug output contains a formal road Mesh.');
  assert(result.debugTypes.filter(type => type === 'LineSegments').length >= 3 && result.debugTypes.includes('Points'), 'Required raw/projected/normal debug primitives are missing.');
  const sample = result.firstOutput.paths[0].samples[0];
  for (const key of ['position', 'normal', 'slopeDegrees', 'distance', 'valid', 'reason']) assert(Object.hasOwn(sample, key), `Projected sample is missing ${key}.`);
  assert(Array.isArray(result.firstOutput.paths[0].invalidRanges), 'invalidRanges is missing.');
  assert(result.sampleCount > 2, 'Projection did not create fixed-spacing samples.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `Mobile layout overflows horizontally by ${overflow}px.`);
  assert((await fetch(`${base}/experiments/iceland-region/`)).ok, 'Iceland Region Lab no longer returns HTTP 200.');
  assert(errors.length === 0, `Browser errors detected:\n${errors.join('\n')}`);

  console.log(JSON.stringify({ pageUrl, terrainSignature: result.initial.terrainSignature, deterministic: true, roadInputUnchanged: true, terrainRegenerationCount: result.initial.terrainGenerationCount, sampleCount: result.sampleCount, invalidSegments: result.invalidSegments, invalidRanges: result.invalidRanges, debugDisposalVerified: true, browserErrors: errors }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
