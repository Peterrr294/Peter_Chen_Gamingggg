import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4186;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const screenshot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/02-5-suitability-debug.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/terrain-analysis.json');
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
  };
  // Independent checks run in the page against the exported fields + analysis.
  const inspect = () => page.evaluate(() => {
    const fields = window.__seedTerrainLab.fields();
    const analysis = window.__seedTerrainLab.analysis();
    const { columns, segments, spacing, size } = fields.grid;
    const weight = index => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      return (row === 0 || row === segments ? 0.5 : 1) * (col === 0 || col === segments ? 0.5 : 1) * spacing * spacing;
    };
    const countComponents = mask => {
      const seen = new Uint8Array(mask.length);
      let count = 0;
      for (let start = 0; start < mask.length; start += 1) {
        if (!mask[start] || seen[start]) continue;
        count += 1;
        const queue = [start];
        seen[start] = 1;
        while (queue.length) {
          const index = queue.shift();
          const row = Math.floor(index / columns);
          const col = index % columns;
          for (const [r, c] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
            if (r < 0 || c < 0 || r > segments || c > segments) continue;
            const next = r * columns + c;
            if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
          }
        }
      }
      return count;
    };
    const labelArea = (labels, id) => labels.reduce((sum, label, index) => (label === id ? sum + weight(index) : sum), 0);
    let labelMismatch = 0;
    let suitabilityMismatch = 0;
    for (let index = 0; index < fields.waterMask.length; index += 1) {
      if ((analysis.waterRegions.labels[index] > 0) !== (fields.waterMask[index] === 1)) labelMismatch += 1;
      if ((analysis.buildableRegions.labels[index] > 0) !== (fields.buildableMask[index] === 1)) labelMismatch += 1;
      const suit = analysis.suitabilityMask[index];
      if ((suit >= 2) !== (fields.buildableMask[index] === 1) || (fields.waterMask[index] && suit !== 0)) suitabilityMismatch += 1;
    }
    const regionAreaError = ['waterRegions', 'buildableRegions'].flatMap(key => analysis[key].regions
      .map(region => Math.abs(labelArea(analysis[key].labels, region.id) - region.area)));
    const edgeWaterLength = Object.fromEntries(Object.entries(fields.boundarySamples.edges).map(([edge, line]) => [edge,
      line.outer.water.reduce((sum, wet, step) => sum + (wet ? (step === 0 || step === segments ? spacing / 2 : spacing) : 0), 0)]));
    const regionEdgeMismatch = ['waterRegions', 'buildableRegions'].flatMap(key => analysis[key].regions.map(region => {
      const runsKey = key === 'waterRegions' ? 'waterRuns' : 'buildableRuns';
      const fromRuns = Object.entries(analysis.boundaryConnections.edges).filter(([, edge]) => edge[runsKey].some(run => run.regionIds.includes(region.id))).map(([name]) => name).sort().join();
      return fromRuns === [...region.touchesEdges].sort().join() ? 0 : 1;
    })).reduce((a, b) => a + b, 0);
    const { suitabilityMask, waterRegions, buildableRegions, ...summary } = analysis;
    return {
      summary,
      waterRegionSummary: { ...waterRegions, labels: undefined },
      buildableRegionSummary: { ...buildableRegions, labels: undefined },
      checks: {
        size,
        waterComponents: countComponents(fields.waterMask),
        buildableComponents: countComponents(fields.buildableMask),
        labelMismatch,
        suitabilityMismatch,
        maxRegionAreaError: Math.max(0, ...regionAreaError),
        edgeWaterLength,
        regionEdgeMismatch,
      },
    };
  });

  const runs = [];
  const opposite = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' };
  const outward = { minX: [-1, 0], maxX: [1, 0], minZ: [0, -1], maxZ: [0, 1] };
  for (const landform of landforms) {
    for (const seed of seeds) {
      const id = `${landform} ${seed}`;
      await open(`landform=${landform}&seed=${seed}`);
      const first = await inspect();
      await open(`landform=${landform}&seed=${seed}`);
      const repeat = await inspect();
      const a = first.summary;
      const c = first.checks;
      const water = first.waterRegionSummary;
      const chunkArea = c.size * c.size;
      assert(a.signature === repeat.summary.signature && JSON.stringify(a) === JSON.stringify(repeat.summary), `${id}: analysis not reproducible.`);
      // Areas.
      assert(a.areaCheck.weightedArea === chunkArea, `${id}: weighted area ${a.areaCheck.weightedArea} ≠ ${chunkArea}.`);
      assert(Math.abs(a.waterCoverage.area + a.waterCoverage.landArea - chunkArea) < 1e-6, `${id}: water + land ≠ chunk.`);
      assert(Math.abs(a.suitability.area.reduce((s, v) => s + v, 0) - chunkArea) < 1e-6, `${id}: suitability areas ≠ chunk.`);
      assert(Math.abs(a.slopeStats.histogram.reduce((s, bin) => s + bin.area, 0) - chunkArea) < 1e-6, `${id}: slope histogram ≠ chunk.`);
      // Connectivity (independent BFS) and labels.
      assert(c.waterComponents === water.count && c.buildableComponents === first.buildableRegionSummary.count, `${id}: component counts differ from independent BFS.`);
      assert(c.labelMismatch === 0 && c.maxRegionAreaError < 1e-3 && c.regionEdgeMismatch === 0, `${id}: region labels, areas, or edge contacts inconsistent.`);
      // Suitability vs absolute buildability.
      assert(c.suitabilityMismatch === 0, `${id}: suitability classes 2–3 do not match buildableMask.`);
      // Boundary samples vs analysis.
      assert(a.boundaryConnections.sampleMismatches === 0, `${id}: boundary samples differ from waterMask.`);
      for (const [edge, length] of Object.entries(c.edgeWaterLength)) {
        assert(Math.abs(a.boundaryConnections.edges[edge].waterLength - length) < 1e-6, `${id}: ${edge} water length differs from boundary samples.`);
      }
      // Direction: never claimed without passing evidence.
      const direction = a.dominantDirection;
      if (direction.primary !== 'unknown') assert(direction.selected.pass && direction.selected.value >= direction.selected.threshold, `${id}: direction claimed without evidence.`);
      // Landform-specific water/land relations.
      const wetEdges = Object.entries(a.boundaryConnections.edges).filter(([, edge]) => edge.waterLength > 0).map(([edge]) => edge);
      if (landform === 'plain' || landform === 'mountain') assert(water.count === 0 && a.waterCoverage.area === 0, `${id}: unexpected water.`);
      if (landform === 'riverValley') {
        const river = water.regions[0];
        assert(water.count === 1 && river.touchesEdges.length === 2 && opposite[river.touchesEdges[0]] === river.touchesEdges[1], `${id}: river is not one body crossing opposite edges.`);
        assert(direction.primary === 'waterAxis', `${id}: river axis not detected.`);
        const expected = river.touchesEdges.includes('minX') ? 0 : 90;
        const difference = Math.min(Math.abs(direction.selected.axisDeg - expected), 180 - Math.abs(direction.selected.axisDeg - expected));
        assert(difference <= 30, `${id}: river axis ${direction.selected.axisDeg}° does not follow the crossing (${expected}°).`);
      }
      if (landform === 'coast') {
        const sea = water.regions[0];
        assert(sea.chunkFraction > 0.05 && water.largestShareOfMask > 0.9, `${id}: no dominant sea body.`);
        assert([...sea.touchesEdges].sort().join() === [...wetEdges].sort().join() || water.count > 1, `${id}: sea edges differ from wet boundary edges.`);
        if (direction.primary === 'shoreline') {
          const angle = direction.selected.seawardDeg * Math.PI / 180;
          const normal = sea.touchesEdges.reduce((sum, edge) => [sum[0] + outward[edge][0], sum[1] + outward[edge][1]], [0, 0]);
          assert(Math.cos(angle) * normal[0] + Math.sin(angle) * normal[1] > 0, `${id}: seaward direction points away from the sea edges.`);
        }
        if (sea.touchesEdges.length === 0) assert(direction.primary === 'unknown' || direction.primary === 'reliefGrain' || direction.primary === 'regionalSlope', `${id}: enclosed bay given a shoreline axis.`);
      }
      runs.push({
        landform, seed, signature: a.signature,
        elevation: a.elevationStats, slope: { mean: a.slopeStats.mean, meanLand: a.slopeStats.meanLand, ...a.slopeStats.land },
        water: { fraction: a.waterCoverage.fraction, regions: water.count, largestShare: water.largestShareOfMask, edges: water.regions[0]?.touchesEdges ?? [] },
        buildable: { fraction: a.waterCoverage.buildableFraction, regions: first.buildableRegionSummary.count, significant: first.buildableRegionSummary.significantCount, largestShare: first.buildableRegionSummary.largestShareOfMask },
        suitability: a.suitability.fraction,
        direction: direction.selected ? { type: direction.primary, axisDeg: direction.selected.axisDeg, seawardDeg: direction.selected.seawardDeg, downslopeDeg: direction.selected.downslopeDeg, value: direction.selected.value } : { type: 'unknown', best: direction.candidates.map(candidate => [candidate.type, candidate.value, candidate.threshold]) },
      });
    }
  }
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: suitability debug view for the four landforms (seed 1101).
  const tiles = [];
  for (const landform of landforms) {
    await open(`landform=${landform}&seed=${seeds[0]}&view=suitability`);
    await page.waitForTimeout(250);
    const run = runs.find(item => item.landform === landform && item.seed === seeds[0]);
    const image = (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64');
    const direction = run.direction.type === 'unknown' ? 'direction unknown' : `${run.direction.type} ${run.direction.axisDeg ?? run.direction.downslopeDeg}°`;
    tiles.push(`<figure><img src="data:image/png;base64,${image}"><figcaption>${landform} · seed ${seeds[0]} · high+medium ${((run.suitability[3] + run.suitability[2]) * 100).toFixed(1)}% · low ${(run.suitability[1] * 100).toFixed(1)}% · ${direction}</figcaption></figure>`);
  }
  const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
  await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:1fr 1fr;gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:10px;bottom:8px;color:#edf5f2;font:13px Consolas,monospace;background:#081014cc;padding:4px 8px}</style>${tiles.join('')}`);
  await mkdir(path.dirname(screenshot), { recursive: true });
  await compositePage.screenshot({ path: screenshot, fullPage: true });
  await compositePage.close();

  const evidence = { task: '02.5', experiment: entry, testedAt: new Date().toISOString(), runs, browserErrors, screenshot: path.relative(root, screenshot).replaceAll('\\', '/') };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} ${run.signature} W${(run.water.fraction * 100).toFixed(1)}% r${run.water.regions} B${(run.buildable.fraction * 100).toFixed(1)}% r${run.buildable.significant}/${run.buildable.regions} dir ${run.direction.type}${run.direction.axisDeg !== undefined ? ` ${run.direction.axisDeg}°` : ''}${run.direction.seawardDeg !== undefined ? ` sea ${run.direction.seawardDeg}°` : ''}`),
    screenshot: evidence.screenshot,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
