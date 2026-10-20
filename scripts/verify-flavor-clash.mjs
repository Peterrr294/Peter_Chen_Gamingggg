import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { SeededRandom } from '../experiments/flavor-clash-prototype/world/SeededRandom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4176;
const base = `http://${host}:${port}`;
const pageUrl = `${base}/experiments/flavor-clash-prototype/`;
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

const rngA = new SeededRandom('verification');
const rngB = new SeededRandom('verification');
assert(Array.from({ length: 12 }, () => rngA.next()).join(',') === Array.from({ length: 12 }, () => rngB.next()).join(','), 'SeededRandom is not deterministic.');

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await findBrowser(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => errors.push(`page: ${error.message}`));

  await page.goto(`${base}/#home`, { waitUntil: 'networkidle' });
  assert(await page.locator('a[href="#flavor"]').count() >= 2, 'Homepage Flavor Clash navigation/card entry is missing.');
  await page.goto(pageUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__flavorClash?.ready === true);
  assert((await page.title()).includes('Flavor Clash'), 'Direct page title is missing.');

  const before = await page.evaluate(() => Object.fromEntries(Object.keys(window.__flavorClash.regionConfigs).map(id => [id, window.__flavorClash.signature(id)])));
  assert(Object.values(before).every(Boolean), 'One or more regions did not generate a signature.');
  await page.evaluate(() => window.__flavorClash.worldMap.generateAll());
  const repeated = await page.evaluate(() => Object.fromEntries(Object.keys(window.__flavorClash.regionConfigs).map(id => [id, window.__flavorClash.signature(id)])));
  assert(JSON.stringify(before) === JSON.stringify(repeated), 'Same configuration did not reproduce all region signatures.');

  const independence = await page.evaluate(() => {
    const api = window.__flavorClash;
    const original = Object.fromEntries(Object.keys(api.regionConfigs).map(id => [id, api.signature(id)]));
    const originalOffset = api.regionConfigs.iceland.seedOffset;
    api.regionConfigs.iceland.seedOffset += 1;
    api.regenerateRegion('iceland');
    const changed = Object.fromEntries(Object.keys(api.regionConfigs).map(id => [id, api.signature(id)]));
    const rootChildren = api.worldMap.root.children.length;
    api.regenerateRegion('iceland');
    const repeatedChildren = api.worldMap.root.children.length;
    api.regionConfigs.iceland.seedOffset = originalOffset;
    api.regenerateRegion('iceland');
    return { original, changed, rootChildren, repeatedChildren };
  });
  assert(independence.original.iceland !== independence.changed.iceland, 'Changing Iceland seed did not change Iceland.');
  for (const id of ['tokyo', 'venice', 'hawaii']) assert(independence.original[id] === independence.changed[id], `${id} changed while regenerating Iceland.`);
  assert(independence.rootChildren === independence.repeatedChildren, 'Repeated region regeneration accumulated scene groups.');

  const serialized = await page.evaluate(() => window.__flavorClash.serialize());
  assert(serialized.schemaVersion === 1 && Object.keys(serialized.regions).length === 4, 'Serialized configuration is incomplete.');
  const stats = await page.evaluate(() => Object.fromEntries([...window.__flavorClash.worldMap.regions].map(([id, region]) => [id, region.result.debugData])));
  assert(Object.values(stats).every(item => typeof item.wfcSuccess === 'boolean' && item.connectedRoadCells >= 1), 'WFC result reporting is incomplete.');

  const classification = await page.evaluate(() => {
    const api = window.__flavorClash;
    const signaturesBefore = Object.fromEntries(['tokyo', 'venice'].map(id => [id, api.signature(id)]));
    const summarize = id => {
      const terrain = api.worldMap.regions.get(id).result.terrain;
      const values = terrain.classification;
      return {
        count: values?.buildability.length ?? 0,
        rangesValid: values ? ['elevation', 'slope', 'buildability'].every(key => [...values[key]].every(value => value >= 0 && value <= 1)) : false,
        waterMaskValid: values ? [...values.waterMask].every(value => value === 0 || value === 1) : false,
        submergedNonBuildable: values ? [...values.waterMask].every((value, index) => value === 0 || values.buildability[index] === 0) : false,
        maskMatchesTerrain: values ? [...values.waterMask].every((value, index) => value === Number(api.regionConfigs[id].waterLevel >= 0 && terrain.mesh.geometry.attributes.position.getY(index) <= api.regionConfigs[id].waterLevel)) : false,
        waterMaskSignature: values ? [...values.waterMask].join('') : '',
        colorBefore: [...terrain.mesh.geometry.attributes.color.array.slice(0, 12)],
      };
    };
    const regions = { tokyo: summarize('tokyo'), venice: summarize('venice') };
    const excluded = ['iceland', 'hawaii'].every(id => api.worldMap.regions.get(id).result.terrain.classification === null);
    api.worldMap.setBuildabilityHeatmap(true);
    for (const id of ['tokyo', 'venice']) {
      const colorAfter = [...api.worldMap.regions.get(id).result.terrain.mesh.geometry.attributes.color.array.slice(0, 12)];
      regions[id].colorsChanged = JSON.stringify(regions[id].colorBefore) !== JSON.stringify(colorAfter);
    }
    const signaturesAfter = Object.fromEntries(['tokyo', 'venice'].map(id => [id, api.signature(id)]));
    api.worldMap.setBuildabilityHeatmap(false);
    api.worldMap.setWaterMaskOverlay(true);
    for (const id of ['tokyo', 'venice']) {
      const colorAfter = [...api.worldMap.regions.get(id).result.terrain.mesh.geometry.attributes.color.array.slice(0, 12)];
      regions[id].waterMaskColorsChanged = JSON.stringify(regions[id].colorBefore) !== JSON.stringify(colorAfter);
    }
    api.worldMap.setWaterMaskOverlay(false);
    for (const id of ['tokyo', 'venice']) {
      api.regenerateRegion(id);
      regions[id].waterMaskDeterministic = regions[id].waterMaskSignature === [...api.worldMap.regions.get(id).result.terrain.classification.waterMask].join('');
    }
    return { regions, excluded, signaturesUnchanged: JSON.stringify(signaturesBefore) === JSON.stringify(signaturesAfter) };
  });
  for (const id of ['tokyo', 'venice']) {
    assert(classification.regions[id].count > 0 && classification.regions[id].rangesValid, `${id} classification is missing or outside 0–1.`);
    assert(classification.regions[id].colorsChanged, `${id} heatmap did not update vertex colors.`);
    assert(classification.regions[id].waterMaskValid && classification.regions[id].maskMatchesTerrain, `${id} water mask does not match terrain water levels.`);
    assert(classification.regions[id].submergedNonBuildable, `${id} submerged terrain remained buildable.`);
    assert(classification.regions[id].waterMaskColorsChanged, `${id} water-mask overlay did not update vertex colors.`);
    assert(classification.regions[id].waterMaskDeterministic, `${id} water mask changed for the same seed.`);
  }
  assert(classification.excluded, 'Classification was unexpectedly added to non-target regions.');
  assert(classification.signaturesUnchanged, 'Heatmap toggle changed road or scatter signatures.');

  const buildingsDisabled = await page.evaluate(() => {
    const api = window.__flavorClash;
    return [...api.worldMap.regions.values()].every(region =>
      region.result.buildings.accepted.length === 0
      && region.result.buildings.object3D.children.length === 0);
  });
  assert(buildingsDisabled, 'Experimental building scatter leaked into the original Flavor Clash world.');
  assert(await page.locator('.lil-gui .title', { hasText: 'Buildings' }).count() === 0, 'Experimental building controls leaked into the original world.');

  await page.locator('[data-mode="Systems"]').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, canvasWidth: document.querySelector('#worldCanvas').clientWidth }));
  assert(mobile.overflow <= 1, `Mobile layout overflows horizontally by ${mobile.overflow}px.`);
  assert(mobile.canvasWidth > 300, 'World canvas collapsed on mobile.');
  for (const url of ['/experiments/cellular-noise/', '/experiments/voxel-terrain/', '/experiments/shader-basics/', '/experiments/pcg-terrain/']) {
    assert((await fetch(base + url)).ok, `${url} did not return HTTP 200.`);
  }
  await page.goto(`${base}/#files?file=./docs/projects/flavor-clash/README.md`, { waitUntil: 'networkidle' });
  assert(await page.locator('#fileSelect').inputValue() === './docs/projects/flavor-clash/README.md', 'Flavor Clash learning record did not open in Files & Notes.');
  await page.waitForFunction(() => document.querySelector('.mermaid-diagram svg, .mermaid-error'));
  assert(await page.locator('.mermaid-diagram svg').count() === 1, 'Flavor Clash Mermaid diagram did not render.');
  assert(await page.locator('.mermaid-error').count() === 0, 'Flavor Clash Mermaid diagram reported a parse/render error.');
  assert(errors.length === 0, `Browser errors detected:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ pageUrl, deterministic: true, independentRegionRegeneration: true, stableSceneChildren: independence.rootChildren, classification: { tokyo: classification.regions.tokyo.count, venice: classification.regions.venice.count, ranges: '0-1', heatmapToggle: true, waterMask: true, submergedNonBuildable: true }, experimentalBuildingsDisabled: buildingsDisabled, mermaidRendered: true, stats, browserErrors: errors }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
