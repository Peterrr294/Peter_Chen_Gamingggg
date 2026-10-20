import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4184;
const base = `http://${host}:${port}`;
const entry = '/experiments/manhattan-terrain-greybox/';
const seeds = ['MANHATTAN-1101', 'MANHATTAN-2202', 'MANHATTAN-3303'];
const screenshot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/manhattan-terrain-greybox.png');
const record = path.join(root, 'experiments/manhattan-terrain-greybox/evidence/seed-validation.json');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };

async function browserPath() {
  const candidates = [process.env.PLAYWRIGHT_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error('Chrome or Edge was not found.');
}

async function startServer() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, '--host', host, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await ready(`${base}${entry}`)) return server;
    if (server.exitCode !== null) throw new Error(`Vite stopped early.\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error(`Vite start timed out.\n${output}`);
}

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({ executablePath: await browserPath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const browserErrors = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
  page.on('pageerror', error => browserErrors.push(`page: ${error.message}`));
  const runs = [];
  for (const seed of seeds) {
    const signatures = [];
    let snapshot;
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await page.goto(`${base}${entry}?seed=${encodeURIComponent(seed)}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__manhattanTerrainLab?.ready === true);
      snapshot = await page.evaluate(() => window.__manhattanTerrainLab.snapshot());
      signatures.push(snapshot.signature);
    }
    assert(signatures[0] === signatures[1], `${seed} was not reproducible.`);
    assert(snapshot.buildableVertices > 0, `${seed} has no buildable samples.`);
    assert(snapshot.waterVertices > 0, `${seed} has no water samples.`);
    assert(snapshot.blockedVertices > 0, `${seed} has no shore/slope buffer samples.`);
    runs.push({ seed, signatures, reproducible: true, snapshot });
  }
  assert(new Set(runs.map(run => run.signatures[0])).size === seeds.length, 'Different seeds produced duplicate signatures.');
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  await page.goto(`${base}${entry}?seed=${encodeURIComponent(seeds[0])}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__manhattanTerrainLab?.ready === true);
  await page.waitForTimeout(250);
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.locator('.workspace').screenshot({ path: screenshot, animations: 'disabled' });
  const evidence = {
    task: '02.1',
    experiment: entry,
    testedAt: new Date().toISOString(),
    seeds: runs,
    uniqueSignatures: true,
    browserErrors,
    screenshot: path.relative(root, screenshot).replaceAll('\\', '/'),
  };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    entry: `${base}${entry}`,
    seeds: runs.map(run => ({ seed: run.seed, signature: run.signatures[0], reproducible: run.reproducible })),
    screenshot: evidence.screenshot,
    record: path.relative(root, record).replaceAll('\\', '/'),
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
