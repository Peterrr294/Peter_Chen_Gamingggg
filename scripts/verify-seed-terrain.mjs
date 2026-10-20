import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4185;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/02-4-landforms-overall.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/02-4-transition-debug.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/seed-validation.json');
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
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true);
    return page.evaluate(() => window.__seedTerrainLab.stats());
  };

  // 1. Landform rules, same-config reproducibility, width invariance.
  const runs = [];
  for (const landform of landforms) {
    for (const seed of seeds) {
      const id = `${landform} ${seed}`;
      const query = width => `landform=${landform}&seed=${seed}&transitionWidth=${width}`;
      const first = await open(query(128));
      const repeat = await open(query(128));
      assert(first.heightSignature === repeat.heightSignature && first.waterSignature === repeat.waterSignature, `${id} not reproducible.`);
      for (const width of [32, 256]) {
        const other = await open(query(width));
        assert(other.heightSignature === first.heightSignature && other.waterSignature === first.waterSignature, `${id}: width ${width} changed height or water.`);
        assert(other.weightSignature !== first.weightSignature, `${id}: width ${width} did not change the weight field.`);
      }
      assert(first.samples === 257 * 257, `${id}: wrong sample count.`);
      if (landform === 'plain') assert(first.water === 0 && first.slopeP95 < 5, `${id}: plain rule failed.`);
      if (landform === 'riverValley') {
        const river = first.river;
        assert(first.water > 0 && river.offChannelWater === 0 && river.bankBelowSurface === 0, `${id}: river water outside channel.`);
        assert(river.maxDepth <= 3.001 && (river.crossesX || river.crossesZ), `${id}: river bed or continuity failed.`);
      }
      if (landform === 'coast') assert(first.water > 0 && first.coast.landSeaMismatch === 0, `${id}: coast land/sea boundary inconsistent.`);
      if (landform === 'mountain') assert(first.water === 0 && first.meanLandSlope > 20 && first.meanLandSlope < 40, `${id}: mountain slope out of range.`);
      runs.push({ landform, seed, stats: first });
    }
  }
  assert(new Set(runs.map(run => run.stats.heightSignature)).size === runs.length, 'Duplicate height fields across landform/seed pairs.');

  // 2. Transition weight continuity, corners, symmetry, boundary samples.
  const transitionChecks = [];
  for (const width of [32, 128, 256]) {
    await open(`landform=coast&seed=${seeds[0]}&transitionWidth=${width}`);
    const result = await page.evaluate(() => {
      const data = window.__seedTerrainLab.fields();
      const { columns, segments, spacing } = data.grid;
      const w = data.transitionWeight;
      const at = (row, col) => w[row * columns + col];
      let maxStep = 0;
      let maxDiagonal = 0;
      let asymmetry = 0;
      for (let row = 0; row <= segments; row += 1) {
        for (let col = 0; col <= segments; col += 1) {
          if (col < segments) maxStep = Math.max(maxStep, Math.abs(at(row, col + 1) - at(row, col)));
          if (row < segments) maxStep = Math.max(maxStep, Math.abs(at(row + 1, col) - at(row, col)));
          if (row < segments && col < segments) maxDiagonal = Math.max(maxDiagonal, Math.abs(at(row + 1, col + 1) - at(row, col)));
          asymmetry = Math.max(asymmetry, Math.abs(at(row, col) - at(col, row)), Math.abs(at(row, col) - at(segments - row, segments - col)));
        }
      }
      const zone = Math.round(data.config.transitionWidth / spacing);
      let outerEdgeMin = 1;
      let interiorMax = 0;
      for (let step = 0; step <= segments; step += 1) {
        outerEdgeMin = Math.min(outerEdgeMin, at(0, step), at(segments, step), at(step, 0), at(step, segments));
      }
      for (let row = zone; row <= segments - zone; row += 1) {
        for (let col = zone; col <= segments - zone; col += 1) interiorMax = Math.max(interiorMax, at(row, col));
      }
      const boundary = data.boundarySamples;
      const lines = Object.values(boundary.edges).flatMap(edge => [edge.outer.heights.length, edge.inner.heights.length]);
      return {
        width: data.config.transitionWidth, spacing, maxStep, maxDiagonal, asymmetry, outerEdgeMin, interiorMax,
        corners: boundary.corners.map(corner => corner.weight),
        innerOffsets: Object.values(boundary.edges).map(edge => edge.inner.offsetMetres),
        lineLengths: [...new Set(lines)],
      };
    });
    const bound = 1.5 * result.spacing / result.width;
    // Per-axis bound is the smoothstep slope; a diagonal step near a corner can move both edge weights. 1e-4 covers export rounding.
    assert(result.maxStep <= bound + 1e-4 && result.maxDiagonal <= 2 * bound + 1e-4, `width ${width}: weight jump ${result.maxStep}/${result.maxDiagonal} exceeds bound ${bound}.`);
    assert(result.asymmetry < 1e-6 && result.outerEdgeMin === 1 && result.interiorMax === 0, `width ${width}: edge/interior/symmetry check failed.`);
    assert(result.corners.every(weight => weight === 1) && result.innerOffsets.every(offset => offset === width), `width ${width}: corner or inner line wrong.`);
    assert(result.lineLengths.length === 1 && result.lineLengths[0] === 257, `width ${width}: boundary lines incomplete.`);
    transitionChecks.push({ ...result, bound });
  }

  // 3. Neighbour interface: identity without neighbours, explicit refusal with them.
  const neighbourCheck = await page.evaluate(() => {
    const identity = window.__seedTerrainLab.neighbors({});
    let refused = '';
    try { window.__seedTerrainLab.neighbors({ minX: { heights: [], water: [] } }); } catch (error) { refused = error.message; }
    return { applied: identity.applied, refused };
  });
  assert(neighbourCheck.applied.length === 0 && neighbourCheck.refused.includes('reserved'), 'Neighbour interface check failed.');
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // 4. Evidence: overall 2 × 2 landform view and transition debug view at three widths.
  const capture = async query => {
    await open(query);
    await page.waitForTimeout(250);
    return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64');
  };
  const composite = async (tiles, columns, file) => {
    const html = tiles.map(tile => `<figure><img src="data:image/png;base64,${tile.image}"><figcaption>${tile.caption}</figcaption></figure>`).join('');
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(${columns},1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:10px;bottom:8px;color:#edf5f2;font:13px Consolas,monospace;background:#081014cc;padding:4px 8px}</style>${html}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  const overall = [];
  for (const landform of landforms) {
    const stats = runs.find(run => run.landform === landform && run.seed === seeds[0]).stats;
    overall.push({ image: await capture(`landform=${landform}&seed=${seeds[0]}`), caption: `${landform} · seed ${seeds[0]} · water ${(stats.waterRatio * 100).toFixed(1)}% · buildable ${(stats.buildableRatio * 100).toFixed(1)}% · slope ${stats.meanLandSlope.toFixed(1)}°` });
  }
  await composite(overall, 2, overallShot);
  const debug = [];
  for (const width of [32, 128, 256]) {
    debug.push({ image: await capture(`landform=coast&seed=${seeds[0]}&transitionWidth=${width}&view=transition`), caption: `transition weight · ${width} m · coast ${seeds[0]}` });
  }
  await composite(debug, 3, debugShot);

  const evidence = {
    task: '02.4',
    experiment: entry,
    testedAt: new Date().toISOString(),
    runs,
    transitionChecks,
    neighbourCheck,
    browserErrors,
    screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')),
  };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} ${run.stats.heightSignature}/${run.stats.waterSignature}`),
    transition: transitionChecks.map(check => `${check.width}m step ${check.maxStep.toFixed(4)} <= ${check.bound.toFixed(4)}`),
    neighbourCheck,
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
