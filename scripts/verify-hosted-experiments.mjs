// Smoke-check every public experiment entry, the grouped hub navigation, and the
// runtime-ready hooks for the Flavor Clash labs. Usage:
// node scripts/verify-hosted-experiments.mjs [baseUrl]
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const base = (process.argv[2] ?? 'https://gameeeee-zc626.web.app').replace(/\/$/, '');
const screenshotPath = process.argv[3];
const entries = [
  ['/experiments/cellular-noise/', null],
  ['/experiments/voxel-terrain/', null],
  ['/experiments/shader-basics/', null],
  ['/experiments/pcg-terrain/', null],
  ['/experiments/flavor-clash-prototype/', '__flavorClash'],
  ['/experiments/iceland-region/', '__icelandRegionLab'],
  ['/experiments/road-projection/', '__roadProjectionLab'],
  ['/experiments/road-mesh/', '__roadMeshLab'],
  ['/experiments/terrain-seam/', '__terrainSeamLab'],
  ['/experiments/manhattan-terrain-greybox/', '__manhattanTerrainLab'],
  ['/experiments/seed-terrain/', '__seedTerrainLab'],
  ['/experiments/world-grid/', null],
];

const exists = async file => { try { await access(file); return true; } catch { return false; } };
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
let executablePath;
for (const candidate of browserCandidates) if (await exists(candidate)) { executablePath = candidate; break; }
if (!executablePath) throw new Error('Chrome or Edge was not found.');

const report = { base, entries: {}, navigation: {}, errors: [] };
for (const [route] of entries) {
  const response = await fetch(base + route, { cache: 'no-store' });
  const html = await response.text();
  const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  const asset = script ? await fetch(new URL(script, base + route)) : null;
  report.entries[route] = {
    status: response.status,
    title: html.match(/<title>([^<]*)/)?.[1] ?? null,
    script,
    assetStatus: asset?.status ?? null,
  };
  if (!response.ok || !script || !asset?.ok || !/javascript/.test(asset.headers.get('content-type') ?? '')) {
    report.errors.push(`${route} is not a distinct runnable HTML entry.`);
  }
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const hub = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  hub.on('pageerror', error => report.errors.push(`hub page: ${error.message}`));
  await hub.goto(`${base}/#flavor`, { waitUntil: 'domcontentloaded' });
  await hub.waitForSelector('.experiment-switcher');
  const flavorFrame = await (await hub.waitForSelector('iframe.project-frame')).contentFrame();
  await flavorFrame.waitForFunction(() => window.__flavorClash?.ready === true, null, { timeout: 120000 });
  report.navigation.flavor = await hub.locator('.experiment-switcher a').allTextContents();
  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await hub.screenshot({ path: screenshotPath, fullPage: true });
    report.screenshot = screenshotPath;
  }
  await hub.locator('.experiment-switcher a[href="#roadMesh"]').click();
  await hub.waitForFunction(() => location.hash === '#roadMesh');
  report.navigation.roadMeshFrame = await hub.locator('iframe.project-frame').getAttribute('src');

  await hub.goto(`${base}/#miniWorld`, { waitUntil: 'domcontentloaded' });
  await hub.waitForSelector('.experiment-switcher');
  report.navigation.miniWorld = await hub.locator('.experiment-switcher a').allTextContents();
  await hub.locator('.experiment-switcher a[href="#manhattanTerrain"]').click();
  await hub.waitForFunction(() => location.hash === '#manhattanTerrain');
  report.navigation.manhattanFrame = await hub.locator('iframe.project-frame').getAttribute('src');
  await hub.close();

  if (report.navigation.flavor.length !== 5 || report.navigation.miniWorld.length !== 3
    || !report.navigation.roadMeshFrame?.includes('/road-mesh/')
    || !report.navigation.manhattanFrame?.includes('/manhattan-terrain-greybox/')) {
    report.errors.push('Grouped experiment navigation is incomplete.');
  }

  for (const [route, hook] of entries.filter(([, hook]) => hook && !hook.includes('seedTerrain'))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`); });
    page.on('pageerror', error => pageErrors.push(`page: ${error.message}`));
    page.on('response', response => { if (response.status() >= 400) pageErrors.push(`http ${response.status()}: ${response.url()}`); });
    await page.goto(base + route, { waitUntil: 'load' });
    await page.waitForFunction(name => window[name]?.ready === true, hook, { timeout: 120000 });
    report.entries[route].runtimeReady = true;
    report.entries[route].browserErrors = pageErrors;
    report.errors.push(...pageErrors.map(error => `${route} ${error}`));
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.errors.length ? 1 : 0);
