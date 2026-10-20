import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4177;
const base = `http://${host}:${port}`;
const pageUrl = `${base}/experiments/iceland-region/`;
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
  assert(await page.locator('a[href="#iceland"]').count() === 0, 'Iceland should be grouped under Flavor Clash, not shown as a top-level entry.');
  await page.goto(`${base}/experiments/flavor-clash-prototype/`, { waitUntil: 'networkidle' });
  assert(await page.locator('a[href="../iceland-region/"]').count() === 1, 'Flavor Clash Iceland child entry is missing.');
  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__icelandRegionLab?.ready === true);
  assert((await page.title()).includes('Iceland Region Lab'), 'Direct page title is missing.');

  const result = await page.evaluate(() => {
    const api = window.__icelandRegionLab;
    const initial = api.snapshot();
    const repeated = api.regenerate();
    const afterRepeat = api.snapshot();
    api.config.seed = 'ICELAND-02';
    const different = api.regenerate();
    api.config.seed = 'ICELAND-01';
    const restored = api.regenerate();
    const beforeIndependentUpdates = api.snapshot();
    api.terrain.updateWaterLevel(1.15);
    api.terrain.updateWireframe(true);
    const afterIndependentUpdates = api.snapshot();
    return { initial, repeated, afterRepeat, different, restored, beforeIndependentUpdates, afterIndependentUpdates };
  });
  assert(result.initial.signature === result.repeated.signature, 'Same seed and parameters did not reproduce the same terrain signature.');
  assert(result.initial.signature !== result.different.signature, 'Different seed did not change terrain signature.');
  assert(result.initial.signature === result.restored.signature, 'Restoring the seed did not restore the terrain signature.');
  assert(result.afterRepeat.disposedGeometryCount > result.initial.disposedGeometryCount, 'Regeneration did not dispose old geometries.');
  assert(result.initial.sceneChildren === result.afterRepeat.sceneChildren, 'Regeneration accumulated scene objects.');
  assert(result.beforeIndependentUpdates.geometryUuid === result.afterIndependentUpdates.geometryUuid, 'Water or wireframe update rebuilt terrain geometry.');
  assert(result.beforeIndependentUpdates.generationCount === result.afterIndependentUpdates.generationCount, 'Water or wireframe update triggered regeneration.');

  const roadResult = await page.evaluate(() => {
    const api = window.__icelandRegionLab;
    const terrainBefore = api.snapshot();
    const center = api.querySurface(0, 0);
    const outside = api.querySurface(api.config.mapWidth, api.config.mapDepth);
    const samples = api.samplePath([{ x: 0.25, z: 0.5 }, { x: 0.75, z: 0.5 }]);
    const exported = api.exportRoadData();
    const original = JSON.parse(JSON.stringify(api.roadDocument));
    const invalid = api.setRoadDocument({
      schemaVersion: 1,
      region: 'iceland',
      roads: [
        { id: 'duplicate', type: 'test', width: 1, controlPoints: [{ x: 0.5, z: 0.5 }, { x: 0.8, z: 0.5 }] },
        { id: 'duplicate', type: 'test', width: 1, controlPoints: [{ x: -0.1, z: 0.5 }, { x: 1.1, z: 0.5 }] },
      ],
    });
    api.roadOptions.maxRoadSlope = 60;
    api.roadOptions.waterSafetyDistance = 0;
    api.setRoadDocument({ schemaVersion: 1, region: 'iceland', roads: [{
      id: 'color-check', type: 'test', width: 1,
      controlPoints: [{ x: 0.5, z: 0.5 }, { x: 0.98, z: 0.5 }],
    }] });
    const colors = [];
    api.terrain.root.parent.children.find(child => child.name === 'Iceland road input debug')?.traverse(child => {
      const color = child.geometry?.getAttribute?.('color');
      if (color) for (let index = 0; index < color.count; index += 1) colors.push([color.getX(index), color.getY(index), color.getZ(index)]);
    });
    api.setRoadDocument(original);
    const terrainAfter = api.snapshot();
    return { center, outside, sampleCount: samples.length, exported, invalidCodes: invalid.errors.map(error => error.code), terrainBefore, terrainAfter, colors };
  });
  assert(roadResult.center.inBounds && Number.isFinite(roadResult.center.height), 'Center height query failed.');
  assert(roadResult.center.normal && Math.abs(Math.hypot(roadResult.center.normal.x, roadResult.center.normal.y, roadResult.center.normal.z) - 1) < 0.001, 'Surface normal is not normalized.');
  assert(Number.isFinite(roadResult.center.slope), 'Surface slope query failed.');
  assert(!roadResult.outside.inBounds, 'Out-of-bounds query was not rejected.');
  assert(roadResult.sampleCount > 2, 'Batch path sampling did not create intermediate samples.');
  assert(roadResult.invalidCodes.includes('duplicate-id') && roadResult.invalidCodes.includes('out-of-bounds'), 'Road validation did not report duplicate IDs and out-of-bounds points.');
  assert(roadResult.exported.roads[0].controlPoints.every(point => Object.keys(point).sort().join(',') === 'x,z'), 'Exported control points contain derived height data.');
  assert(roadResult.terrainBefore.signature === roadResult.terrainAfter.signature && roadResult.terrainBefore.generationCount === roadResult.terrainAfter.generationCount, 'Editing road data regenerated or changed terrain.');
  const hasGreen = roadResult.colors.some(([r, g, b]) => g > r * 2 && g > b);
  const hasRed = roadResult.colors.some(([r, g, b]) => r > g * 2 && r > b * 2);
  assert(hasGreen && hasRed, 'Road preview did not contain both passable green and invalid red segments.');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__icelandRegionLab?.ready === true);
  const canvas = page.locator('#terrainCanvas');
  const canvasBounds = await canvas.boundingBox();
  await page.mouse.click(canvasBounds.x + canvasBounds.width * 0.5, canvasBounds.y + canvasBounds.height * 0.5);
  await page.waitForTimeout(100);
  assert(await page.locator('#queryHeight').textContent() !== '—', 'Click-to-query surface readout did not update.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, canvasWidth: document.querySelector('#terrainCanvas').clientWidth }));
  assert(mobile.overflow <= 1, `Mobile layout overflows horizontally by ${mobile.overflow}px.`);
  assert(mobile.canvasWidth > 300, 'Terrain canvas collapsed on mobile.');
  assert(errors.length === 0, `Browser errors detected:\n${errors.join('\n')}`);

  for (const url of ['/experiments/cellular-noise/', '/experiments/voxel-terrain/', '/experiments/flavor-clash-prototype/']) {
    assert((await fetch(base + url)).ok, `${url} did not return HTTP 200.`);
  }
  console.log(JSON.stringify({ pageUrl, deterministicSignature: result.initial.signature, differentSeedSignature: result.different.signature, surfaceQueryVerified: true, roadValidationVerified: true, roadEditsPreserveTerrain: true, geometryDisposalVerified: true, independentMaterialAndWaterUpdates: true, browserErrors: errors }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
