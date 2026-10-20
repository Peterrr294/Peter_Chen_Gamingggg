import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4179;
const base = `http://${host}:${port}`;
const pageUrl = `${base}/experiments/road-mesh/`;
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
  assert(await page.locator('a[href="#roadMesh"]').count() === 0, 'Road Mesh should be grouped under Flavor Clash, not shown as a top-level entry.');
  await page.goto(`${base}/experiments/flavor-clash-prototype/`, { waitUntil: 'networkidle' });
  assert(await page.locator('a[href="../road-mesh/"]').count() === 1, 'Flavor Clash Road Mesh child entry is missing.');
  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__roadMeshLab?.ready === true);

  const result = await page.evaluate(() => {
    const api = window.__roadMeshLab;
    const initial = api.snapshot();
    const originalInput = api.projectedInputSnapshot;
    const road = api.output.roads[0];
    const geometry = road.mesh.geometry;
    const attributes = Object.keys(geometry.attributes);
    const uv = Array.from(geometry.attributes.uv.array);
    const finiteUv = uv.every(Number.isFinite);
    const meshTypes = api.output.roads.map(item => item.mesh.type);
    const invalidDebug = api.builder.debugRoot.getObjectByName('Invalid road breaks');
    api.rebuild();
    const repeated = api.snapshot();
    api.options.roadWidth = 1.75;
    api.options.surfaceOffset = 0.11;
    api.options.uvScale = 0.24;
    api.options.miterLimit = 1.6;
    api.rebuild();
    const changed = api.snapshot();
    api.builder.setWireframe(true);
    api.builder.setCenterlineVisible(false);
    api.builder.setInvalidVisible(false);
    return {
      initial,
      repeated,
      changed,
      originalInput,
      currentInput: JSON.stringify(api.projectedRoadData),
      attributes,
      indexed: Boolean(geometry.index),
      finiteUv,
      meshTypes,
      outputKeys: Object.keys(road),
      invalidDebugType: invalidDebug?.type,
      invalidDebugVertices: invalidDebug?.geometry.attributes.position.count ?? 0,
      visibility: {
        wireframe: api.output.roads.every(item => item.mesh.material.wireframe),
        centerline: api.builder.debugRoot.getObjectByName('Valid road centerline')?.visible,
        invalid: api.builder.debugRoot.getObjectByName('Invalid road breaks')?.visible,
      },
    };
  });

  assert(result.initial.terrainSignature === '5F61302E', 'Existing Iceland terrain signature changed.');
  assert(result.initial.projectionRuns === 1 && result.changed.projectionRuns === 1, 'Mesh rebuild re-ran path projection.');
  assert(result.initial.terrainGenerationCount === result.changed.terrainGenerationCount, 'Mesh parameter changes regenerated terrain.');
  assert(result.originalInput === result.currentInput, 'Road mesh generation mutated ProjectedRoadData.');
  assert(JSON.stringify(result.initial.geometrySignatures) === JSON.stringify(result.repeated.geometrySignatures), 'Same input did not create the same road geometry.');
  assert(result.initial.vertexCount === result.repeated.vertexCount && result.initial.triangleCount === result.repeated.triangleCount, 'Repeated build changed mesh topology.');
  assert(result.repeated.disposedGeometries > result.initial.disposedGeometries && result.repeated.disposedMaterials > result.initial.disposedMaterials, 'Rebuild did not dispose old geometry and materials.');
  assert(result.initial.rootChildren === result.repeated.rootChildren && result.initial.debugChildren === result.repeated.debugChildren, 'Rebuild accumulated scene objects.');
  assert(result.changed.maxMiterRatio <= 1.60001, 'Miter join exceeded the configured limit.');
  for (const key of ['id', 'mesh', 'vertexCount', 'triangleCount', 'length']) assert(result.outputKeys.includes(key), `Road output is missing ${key}.`);
  for (const key of ['position', 'normal', 'uv']) assert(result.attributes.includes(key), `Road geometry is missing ${key}.`);
  assert(result.indexed && result.finiteUv, 'Road geometry lacks indexed triangles or finite UV values.');
  assert(result.meshTypes.every(type => type === 'Mesh'), 'Road output does not contain drawable Mesh objects.');
  assert(result.invalidDebugType === 'LineSegments' && result.invalidDebugVertices > 0, 'Invalid path breaks are not rendered as red line segments.');
  assert(result.visibility.wireframe && result.visibility.centerline === false && result.visibility.invalid === false, 'Debug or wireframe visibility controls failed.');
  assert(result.initial.invalidSegments === 2, `Expected 2 invalid projected segments, found ${result.initial.invalidSegments}.`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `Mobile layout overflows horizontally by ${overflow}px.`);
  assert((await fetch(`${base}/experiments/road-projection/`)).ok, 'Road Projection Lab no longer returns HTTP 200.');
  assert((await fetch(`${base}/experiments/iceland-region/`)).ok, 'Iceland Region Lab no longer returns HTTP 200.');
  assert(errors.length === 0, `Browser errors detected:\n${errors.join('\n')}`);

  console.log(JSON.stringify({
    pageUrl,
    terrainSignature: result.initial.terrainSignature,
    projectionRuns: result.initial.projectionRuns,
    deterministic: true,
    projectedInputUnchanged: true,
    vertexCount: result.initial.vertexCount,
    triangleCount: result.initial.triangleCount,
    length: Number(result.initial.length.toFixed(3)),
    invalidSegments: result.initial.invalidSegments,
    maxMiterRatio: Number(result.initial.maxMiterRatio.toFixed(3)),
    disposalVerified: true,
    browserErrors: errors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
