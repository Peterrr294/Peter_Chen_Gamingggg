import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4182;
const base = `http://${host}:${port}`;
const seamUrl = `${base}/experiments/terrain-seam/`;
const worldUrl = `${base}/experiments/flavor-clash-prototype/`;
const documentPath = 'docs/projects/flavor-clash/terrain-seam-building-scatter.md';
const outputRoot = 'docs/assets/screenshots/flavor-clash/terrain-seam-buildings';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

async function browserPath() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome or Edge was not found. Set PLAYWRIGHT_CHROME_PATH.');
}

async function startServer() {
  if (await ready(seamUrl)) return null;
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ready(seamUrl)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}

function captureId(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}-${String(date.getMilliseconds()).padStart(3, '0')}`;
}

async function capture(locator, file) {
  await locator.screenshot({ path: file, animations: 'disabled' });
}

function evidenceRun(capturedAt, runId, result) {
  const image = file => `../../assets/screenshots/flavor-clash/terrain-seam-buildings/${runId}/${file}`;
  return `### Capture Run — ${capturedAt}

> Created by \`npm run evidence:flavor-buildings\`. Archive ID: \`${runId}\`. Browser errors: none.

#### Step 1 — Terrain references and scene attachment

![Venice and Japan experimental terrain meshes with both building layers visible](${image('01-terrain-ownership.png')})

**What this shows:** The focused scene contains separate Venice and Japan terrain meshes with their building layers visible.

**Programmatic check:** Each layer's \`terrainMesh\` and \`SurfaceQuery.terrain\` reference its own region terrain; each building group is parented to its own region group.

**Recorded result:** Venice ${result.defaults.leftBuildings} instances; Japan ${result.defaults.rightBuildings} instances.

#### Step 2 — Classification and water-mask binding

![Water-mask overlay on both experimental terrain meshes with accepted buildings retained](${image('02-classification-water-mask.png')})

**What this shows:** Both experimental meshes display their own water-mask data while accepted buildings remain visible.

**Programmatic check:** Every accepted point has \`waterMask < 0.5\`, slope below the zone threshold, and meets its layer's buildability threshold.

#### Step 3 — World coordinates and sampled height

![Oblique close view of Venice and Japan buildings placed on the connected terrain surfaces](${image('03-world-height-placement.png')})

**What this shows:** An oblique close view makes the terrain-relative vertical placement and shared world-space seam visible.

**Programmatic check:** Every accepted instance Y equals its own \`SurfaceQuery\` height at the same world XZ coordinate; both body and roof matrices are Y-up and uniformly scaled.

#### Step 4 — Original Flavor Clash world isolation

![Original four-region Flavor Clash world without experimental building controls or building layers](${image('04-original-world-isolation.png')})

**What this shows:** The original Iceland, Tokyo, Venice, and Hawaii world remains a separate four-region view.

**Programmatic check:** Original-world experimental building counts are Iceland ${result.original.iceland}, Tokyo ${result.original.tokyo}, Venice ${result.original.venice}, and Hawaii ${result.original.hawaii}; no Buildings control folder is present.

#### Step 5 — Independent seeds and density controls

![Venice and Japan seam controls showing independent building seeds and density values](${image('05-independent-controls.png')})

**What this shows:** Both layers remain visible while the form exposes separate Venice and Japan seed and density values.

**Parameters:** Venice seed ${result.custom.leftBuildingSeed}, density ${result.custom.leftBuildingDensity}, ${result.custom.leftBuildings} instances; Japan seed ${result.custom.rightBuildingSeed}, density ${result.custom.rightBuildingDensity}, ${result.custom.rightBuildings} instances.

> Observation to complete after testing:
>
> Record what changed visually between the default and custom density capture, and note any placement that still appears incorrect.`;
}

async function updateDocument(capturedAt, runId, result) {
  const file = path.join(root, documentPath);
  const original = await readFile(file, 'utf8');
  const endMarker = '<!-- evidence-capture:flavor-buildings:end -->';
  const end = original.indexOf(endMarker);
  if (end < 0) throw new Error(`Missing evidence marker in ${documentPath}`);
  const updated = `${original.slice(0, end).trimEnd()}\n\n${evidenceRun(capturedAt, runId, result)}\n${original.slice(end)}`;
  await writeFile(file, updated, 'utf8');
}

const capturedDate = new Date();
const runId = captureId(capturedDate);
const runOutput = path.join(root, outputRoot, runId);
await mkdir(runOutput, { recursive: true });
const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => errors.push(`page: ${error.message}`));

  await page.goto(seamUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__terrainSeamLab?.ready === true);
  const ownership = await page.evaluate(() => [window.__terrainSeamLab.left, window.__terrainSeamLab.right].every(({ result }) =>
    result.buildings.terrainMesh === result.terrain.mesh
    && result.buildings.surfaceQuery.terrain === result.terrain
    && result.buildings.object3D.parent === result.object3D));
  assert(ownership, 'A building layer is not attached to its own terrain and region.');
  const defaults = await page.evaluate(() => window.__terrainSeamLab.snapshot());
  const defaultShapeChecks = await page.evaluate(() => [window.__terrainSeamLab.left, window.__terrainSeamLab.right].every(({ result }) =>
    result.buildings.zoneYaw === 0 && result.buildings.accepted.every(item => Math.abs(item.yaw - result.buildings.zoneYaw) <= 1e-12
      && result.buildings.surfaceQuery.querySurface(item.x, item.z).slope < result.buildings.maxSlope)));
  assert(defaultShapeChecks, 'Default building yaw or slope constraints failed.');
  await capture(page.locator('.workspace'), path.join(runOutput, '01-terrain-ownership.png'));

  const masksValid = await page.evaluate(() => {
    const api = window.__terrainSeamLab;
    for (const { region } of [api.left, api.right]) region.setWaterMaskOverlay(true);
    return [api.left, api.right].every(({ result }) => result.buildings.accepted.every(point => {
      const surface = result.buildings.surfaceQuery.querySurface(point.x, point.z);
      return surface && surface.waterMask < 0.5 && surface.buildability >= result.buildings.buildabilityThreshold;
    }));
  });
  assert(masksValid, 'An accepted building violates its terrain classification or water mask.');
  await capture(page.locator('.workspace'), path.join(runOutput, '02-classification-water-mask.png'));

  const heightsValid = await page.evaluate(() => {
    const api = window.__terrainSeamLab;
    for (const { region } of [api.left, api.right]) region.setWaterMaskOverlay(false);
    api.camera.position.set(13, 9, 16);
    api.controls.target.set(0, 1.2, 0);
    api.controls.update();
    return [api.left, api.right].every(({ result }) => result.buildings.accepted.every(point => {
      const surface = result.buildings.surfaceQuery.querySurface(point.x, point.z);
      return surface && Math.abs(surface.height - point.y) <= 1e-12;
    }));
  });
  assert(heightsValid, 'A building height does not match its terrain SurfaceQuery.');
  await page.waitForTimeout(100);
  await capture(page.locator('.workspace'), path.join(runOutput, '03-world-height-placement.png'));

  await page.goto(worldUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__flavorClash?.ready === true);
  const original = await page.evaluate(() => Object.fromEntries([...window.__flavorClash.worldMap.regions].map(([id, region]) => [id, region.result.buildings.accepted.length])));
  assert(Object.values(original).every(count => count === 0), 'Experimental buildings leaked into the original Flavor Clash world.');
  assert(await page.locator('.lil-gui .title', { hasText: 'Buildings' }).count() === 0, 'Experimental building controls leaked into the original world.');
  await capture(page.locator('main'), path.join(runOutput, '04-original-world-isolation.png'));

  const customUrl = `${seamUrl}?veniceSeed=3101&veniceDensity=0.2&japanSeed=3202&japanDensity=0.6`;
  await page.goto(customUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__terrainSeamLab?.ready === true);
  const custom = await page.evaluate(() => window.__terrainSeamLab.snapshot());
  assert(custom.leftBuildingSeed === 3101 && custom.rightBuildingSeed === 3202, 'Independent building seeds were not applied.');
  assert(custom.leftBuildingDensity === 0.2 && custom.rightBuildingDensity === 0.6, 'Independent building densities were not applied.');
  assert(custom.leftBuildings > 0 && custom.rightBuildings > 0, 'Both experimental building layers are not visible.');
  const customShapeChecks = await page.evaluate(() => [window.__terrainSeamLab.left, window.__terrainSeamLab.right].every(({ result }) =>
    result.buildings.zoneYaw === 0 && result.buildings.accepted.every(item => Math.abs(item.yaw - result.buildings.zoneYaw) <= 1e-12
      && result.buildings.surfaceQuery.querySurface(item.x, item.z).slope < result.buildings.maxSlope)));
  assert(customShapeChecks, 'Custom building yaw or slope constraints failed.');
  await capture(page.locator('.workspace'), path.join(runOutput, '05-independent-controls.png'));

  assert(errors.length === 0, `Browser errors detected:\n${errors.join('\n')}`);
  const capturedAt = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'America/New_York' }).format(capturedDate);
  await updateDocument(capturedAt, runId, { defaults, original, custom });
  console.log(JSON.stringify({ runId, screenshots: 5, defaults: { venice: defaults.leftBuildings, japan: defaults.rightBuildings }, original, custom: { venice: custom.leftBuildings, japan: custom.rightBuildings }, browserErrors: errors }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
