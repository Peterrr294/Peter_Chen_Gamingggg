import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4201;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/05-1b-solid-terrain-overall.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/05-1b-solid-terrain-side.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/solid-terrain.json');
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
  const open = async query => {
    await page.goto(`${base}${entry}?${query}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true, null, { timeout: 180000 });
  };
  const report = () => page.evaluate(() => ({ solid: window.__seedTerrainLab.solid(), heightSignature: window.__seedTerrainLab.stats().heightSignature }));
  const earlier = JSON.parse(await readFile(path.join(root, 'experiments/seed-terrain/evidence/seed-validation.json'), 'utf8'));
  const cases = [['plain', 1101, 0.5], ['riverValley', 2202, 0.5], ['coast', 3303, 0.5], ['mountain', 1101, 0.5], ['coast', 1101, 1], ['mountain', 3303, 1]];
  const runs = [];
  for (const [landform, seed, variation] of cases) {
    const id = `${landform} ${seed} v${variation}`;
    await open(`landform=${landform}&seed=${seed}&variation=${variation}`);
    const first = await report();
    await open(`landform=${landform}&seed=${seed}&variation=${variation}`);
    const repeat = await report();
    const s = first.solid;
    assert(JSON.stringify(first) === JSON.stringify(repeat), `${id}: solid not reproducible.`);
    assert(s.watertight && s.openEdges === 0 && s.nonManifoldEdges === 0 && s.inconsistentEdges === 0, `${id}: not a closed manifold.`);
    assert(s.degenerateFaces === 0 && s.duplicateFaces === 0 && s.eulerCharacteristic === 2, `${id}: degenerate / duplicate faces or wrong Euler characteristic.`);
    assert(s.signedVolume > 0 && s.volumeRelativeError < 1e-9, `${id}: volume ${s.signedVolume} vs prism ${s.prismVolume}.`);
    assert(s.minThickness >= 20 - 1e-9 && s.baseY < s.minHeight, `${id}: base not far enough below terrain.`);
    assert(s.surfaceHeightMismatch === 0, `${id}: rendered surface differs from the height field.`);
    const old = variation === 0.5 ? earlier.runs.find(run => run.landform === landform && run.seed === seed) : null;
    if (old) assert(old.stats.heightSignature === first.heightSignature, `${id}: terrain heights changed since 02.4.`);
    runs.push({ landform, seed, variation, heightSignature: first.heightSignature, matches024: old ? true : 'n/a (non-default variation)', solid: s });
  }
  // Synthetic low-elevation case: terrain dipping to -75 m must push the base to -95 m and stay closed.
  const synthetic = await page.evaluate(async () => {
    const { shellBase, surfaceTriangles, buildShell, checkClosedMesh, heightfieldVolume } = await import('/experiments/seed-terrain/TerrainShell.js');
    const segments = 4; const columns = 5;
    const heights = Array.from({ length: 25 }, (_, i) => (i === 12 ? -75 : -10 + (i % 5)));
    const top = new Float32Array(75);
    heights.forEach((h, i) => { top[i * 3] = (i % columns) * 10; top[i * 3 + 1] = h; top[i * 3 + 2] = Math.floor(i / columns) * 10; });
    const tris = surfaceTriangles(segments);
    const baseY = shellBase(heights);
    const shell = buildShell(top, tris, baseY);
    const check = checkClosedMesh([{ positions: top, indices: tris }, shell]);
    return { baseY, ...check, prism: heightfieldVolume(top, tris, baseY) };
  });
  assert(synthetic.baseY === -95 && synthetic.watertight && synthetic.eulerCharacteristic === 2 && Math.abs(synthetic.signedVolume - synthetic.prism) < 1e-6, `synthetic low case failed: ${JSON.stringify(synthetic)}`);
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: (1) overall solid chunks; (2) side views showing thickness and base.
  const capture = async query => { await open(query); await page.waitForTimeout(400); return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64'); };
  const composite = async (tiles, file, columns) => {
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(${columns},1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px}</style>${tiles.join('')}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  const label = run => `${run.landform} ${run.seed} v${run.variation} · terrain ${run.solid.minHeight.toFixed(0)} to ${run.solid.maxHeight.toFixed(0)} m · base ${run.solid.baseY} m · min thickness ${run.solid.minThickness.toFixed(0)} m · chi ${run.solid.eulerCharacteristic}`;
  const overall = [];
  for (const run of runs.slice(0, 4)) overall.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${run.landform}&seed=${run.seed}&variation=${run.variation}`)}"><figcaption>${label(run)}</figcaption></figure>`);
  await composite(overall, overallShot, 2);
  const side = [];
  for (const run of [runs[4], runs[5], runs[0]]) side.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${run.landform}&seed=${run.seed}&variation=${run.variation}&camera=side`)}"><figcaption>side view · ${label(run)}</figcaption></figure>`);
  await composite(side, debugShot, 3);

  const evidence = { task: '05.1b-1', experiment: entry, testedAt: new Date().toISOString(), runs, synthetic, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} v${run.variation}: V ${run.solid.vertices} E ${run.solid.edges} F ${run.solid.faces} chi ${run.solid.eulerCharacteristic} · open ${run.solid.openEdges} · nonManifold ${run.solid.nonManifoldEdges} · inconsistent ${run.solid.inconsistentEdges} · degenerate ${run.solid.degenerateFaces} · volume rel err ${run.solid.volumeRelativeError.toExponential(1)} · terrain ${run.solid.minHeight.toFixed(1)}..${run.solid.maxHeight.toFixed(1)} base ${run.solid.baseY} thick ${run.solid.minThickness.toFixed(1)} · heights = 02.4 ${run.matches024}`),
    synthetic: `base ${synthetic.baseY} · chi ${synthetic.eulerCharacteristic} · watertight ${synthetic.watertight}`,
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
