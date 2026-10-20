import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4175;
const base = `http://${host}:${port}`;

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function ready(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; }
}
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
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await ready(`${base}/experiments/pcg-terrain/`)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}

function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitForGeneration(page) {
  await page.waitForFunction(() => document.querySelector('#generationState')?.textContent !== 'GENERATING');
}
async function stats(page) {
  return page.evaluate(() => ({
    requested: document.querySelector('#statRequested').textContent,
    attempts: document.querySelector('#statAttempts').textContent,
    accepted: document.querySelector('#statAccepted').textContent,
    rejected: document.querySelector('#statRejected').textContent,
    rate: document.querySelector('#statRate').textContent,
    time: document.querySelector('#statTime').textContent,
    groups: document.body.dataset.generatedGroups,
  }));
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
  assert(await page.locator('a[href="#pcg"]').count() >= 2, 'Homepage navigation/card entry is missing.');
  await page.goto(`${base}/#files?file=./docs/learning/pcg-terrain/random-scattering.md`, { waitUntil: 'networkidle' });
  assert(await page.locator('#fileSelect').inputValue() === './docs/learning/pcg-terrain/random-scattering.md', 'PCG learning-record deep link did not select the document.');
  await page.goto(`${base}/experiments/pcg-terrain/`, { waitUntil: 'networkidle' });
  await waitForGeneration(page);
  assert((await page.title()).includes('PCG Terrain Lab'), 'Direct page title is missing.');
  await page.reload({ waitUntil: 'networkidle' });
  await waitForGeneration(page);

  const signatureOne = await page.locator('body').getAttribute('data-scatter-signature');
  await page.locator('#regenerateButton').click();
  await waitForGeneration(page);
  const signatureTwo = await page.locator('body').getAttribute('data-scatter-signature');
  assert(signatureOne === signatureTwo, 'Same seed did not reproduce the same placements.');

  await page.locator('#seed').fill('CLASS-07');
  await page.locator('#seed').dispatchEvent('change');
  await waitForGeneration(page);
  const signatureThree = await page.locator('body').getAttribute('data-scatter-signature');
  assert(signatureThree !== signatureOne, 'Different seed did not change placements.');
  await page.locator('#seed').fill('CLASS-06');
  await page.locator('#seed').dispatchEvent('change');
  await waitForGeneration(page);

  const presetStats = {};
  for (const name of ['Sparse', 'Medium', 'Dense']) {
    await page.locator(`[data-preset="${name}"]`).click();
    await waitForGeneration(page);
    presetStats[name] = await stats(page);
    assert(presetStats[name].groups === '2', `${name} accumulated generated groups.`);
  }

  await page.locator('#showCandidates').check();
  assert(await page.locator('body').getAttribute('data-candidates-visible') === 'true', 'Candidate debug points did not turn on.');
  await page.locator('#showAccepted').uncheck();
  assert(await page.locator('body').getAttribute('data-accepted-visible') === 'false', 'Accepted debug points did not turn off.');
  await page.locator('#showRejected').uncheck();
  assert(await page.locator('body').getAttribute('data-rejected-visible') === 'false', 'Rejected debug points did not turn off.');

  for (const tab of ['paths', 'fields']) {
    await page.locator(`[data-lab-tab="${tab}"]`).click();
    assert(await page.locator(`[data-lab-panel="${tab}"]`).isVisible(), `${tab} placeholder is not visible.`);
    assert((await page.locator(`[data-lab-panel="${tab}"]`).textContent()).includes('Coming in a later experiment.'), `${tab} placeholder text is missing.`);
  }
  await page.locator('[data-lab-tab="scattering"]').click();

  const canvas = page.locator('#terrainCanvas');
  const box = await canvas.boundingBox();
  assert(box, 'Terrain canvas has no visible bounds.');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, canvasWidth: document.querySelector('#terrainCanvas').clientWidth }));
  assert(mobile.overflow <= 1, `Mobile layout overflows horizontally by ${mobile.overflow}px.`);
  assert(mobile.canvasWidth > 300, 'Terrain canvas collapsed on mobile.');
  assert(errors.length === 0, `Browser errors detected:\n${errors.join('\n')}`);

  const oldPages = ['/experiments/cellular-noise/', '/experiments/voxel-terrain/', '/experiments/shader-basics/'];
  for (const url of oldPages) assert((await fetch(base + url)).ok, `${url} did not return HTTP 200.`);
  console.log(JSON.stringify({ directUrl: `${base}/experiments/pcg-terrain/`, sameSeed: true, differentSeed: true, presetStats, errors }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
