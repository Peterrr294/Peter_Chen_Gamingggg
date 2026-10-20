import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = 4198;
const base = `http://${host}:${port}`;
const entry = '/experiments/seed-terrain/';
const seeds = [1101, 2202, 3303];
const landforms = ['plain', 'riverValley', 'coast', 'mountain'];
const overallShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/04-2-parcels-strategies.png');
const debugShot = path.join(root, 'docs/assets/screenshots/procedural-mini-world/04-2-parcels-frontage-closeup.png');
const record = path.join(root, 'experiments/seed-terrain/evidence/parcels.json');
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
    await page.waitForFunction(() => window.__seedTerrainLab?.ready === true, null, { timeout: 120000 });
  };
  const inspect = () => page.evaluate(async () => {
    const { CHUNK } = await import('/experiments/seed-terrain/config.js');
    const { BLOCK_RULES } = await import('/experiments/seed-terrain/blockRules.js');
    const { PARCEL_RULES } = await import('/experiments/seed-terrain/parcelRules.js');
    const { ringsIntersect } = await import('/experiments/seed-terrain/BlockGenerator.js');
    const lab = window.__seedTerrainLab;
    const fields = lab.fields();
    const graph = lab.network();
    const blocks = lab.blocks();
    const result = lab.parcels();
    const target = result.rules.target;
    const { columns, segments, spacing, size, originX, originZ } = fields.grid;
    const half = size / 2;
    const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p.x * q.z - q.x * p.z; }, 0) / 2;
    const inside = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
    const inPoly = (poly, x, z) => inside(poly.polygon, x, z) && !poly.holes.some(hole => inside(hole, x, z));
    const segDist = (x, z, a, b) => { const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
    const ringDist = (ring, x, z) => ring.reduce((best, p, i) => Math.min(best, segDist(x, z, p, ring[(i + 1) % ring.length])), Infinity);
    const bilinear = map => (x, z) => {
      const gx = Math.min(segments, Math.max(0, (x - originX + half) / spacing)); const gz = Math.min(segments, Math.max(0, (z - originZ + half) / spacing));
      const c0 = Math.min(segments - 1, Math.floor(gx)); const r0 = Math.min(segments - 1, Math.floor(gz)); const tx = gx - c0; const tz = gz - r0;
      const at = (r, c) => map(r * columns + c);
      return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - tz) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * tz;
    };
    const slopeAt = bilinear(i => fields.slope[i]);
    const freeboardAt = bilinear(i => (Number.isFinite(fields.waterSurface[i]) ? Math.max(-3, Math.min(3, fields.height[i] - fields.waterSurface[i] - CHUNK.shoreFreeboard)) : 3));
    const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
    const blockById = new Map(blocks.blocks.map(block => [block.id, block]));
    const issues = { invalidRing: 0, badOrientation: 0, smallArea: 0, outOfChunk: 0, fakeFrontage: 0, nonRoadFrontage: 0, notInBlockRoads: 0, overlapSamples: 0, outsideBuildable: 0, wet: 0, steep: 0, onRoad: 0 };
    const frontageTolerance = BLOCK_RULES.buildable.edgeMargin + PARCEL_RULES.inset + 1.5;
    for (const parcel of result.parcels) {
      const rings = [parcel.polygon, ...parcel.holes];
      if (rings.some(ring => ring.length < 3) || ringsIntersect(rings)) issues.invalidRing += 1;
      if (area(parcel.polygon) <= 0 || parcel.holes.some(ring => area(ring) >= 0)) issues.badOrientation += 1;
      if (parcel.area < target.minArea) issues.smallArea += 1;
      if (rings.some(ring => ring.some(p => Math.abs(p.x - originX) > half + 1e-6 || Math.abs(p.z - originZ) > half + 1e-6))) issues.outOfChunk += 1;
      // Topological frontage: the fronting edge is a surface road of this block, and the parcel actually reaches its road edge.
      const edge = edges.get(parcel.frontageRoadId);
      if (!edge || edge.kind !== 'road') { issues.nonRoadFrontage += 1; continue; }
      if (!blockById.get(parcel.blockId).adjacentRoads.some(road => road.edgeId === edge.id)) issues.notInBlockRoads += 1;
      const gap = Math.min(...parcel.polygon.map(p => edge.points.slice(1).reduce((best, b, i) => Math.min(best, segDist(p.x, p.z, edge.points[i], b)), Infinity))) - edge.width / 2;
      if (gap > frontageTolerance) issues.fakeFrontage += 1;
    }
    // Stratified jitter sampling (one point per 2 m cell).
    let seedState = 4242;
    const random = () => { seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0; return seedState / 4294967296; };
    const boxes = result.parcels.map(parcel => ({ parcel, minX: Math.min(...parcel.polygon.map(p => p.x)), maxX: Math.max(...parcel.polygon.map(p => p.x)), minZ: Math.min(...parcel.polygon.map(p => p.z)), maxZ: Math.max(...parcel.polygon.map(p => p.z)) }));
    const grid = new Map();
    boxes.forEach(box => { for (let gx = Math.floor(box.minX / 32); gx <= Math.floor(box.maxX / 32); gx += 1) for (let gz = Math.floor(box.minZ / 32); gz <= Math.floor(box.maxZ / 32); gz += 1) { const key = `${gx},${gz}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(box); } });
    const roadSegs = graph.edges.filter(edge => ['road', 'bridgeCandidate'].includes(edge.kind)).flatMap(edge => edge.points.slice(1).map((b, i) => ({ a: edge.points[i], b, w: edge.width / 2 })));
    const roadGrid = new Map();
    roadSegs.forEach(seg => { for (let gx = Math.floor((Math.min(seg.a.x, seg.b.x) - seg.w - 1) / 32); gx <= Math.floor((Math.max(seg.a.x, seg.b.x) + seg.w + 1) / 32); gx += 1) for (let gz = Math.floor((Math.min(seg.a.z, seg.b.z) - seg.w - 1) / 32); gz <= Math.floor((Math.max(seg.a.z, seg.b.z) + seg.w + 1) / 32); gz += 1) { const key = `${gx},${gz}`; if (!roadGrid.has(key)) roadGrid.set(key, []); roadGrid.get(key).push(seg); } });
    let sampled = 0;
    for (let cz = originZ - half; cz < originZ + half; cz += 2) for (let cx = originX - half; cx < originX + half; cx += 2) {
      const x = cx + random() * 2; const z = cz + random() * 2;
      const owners = (grid.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []).filter(box => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ && inPoly(box.parcel, x, z));
      if (!owners.length) continue;
      sampled += 4;
      if (owners.length > 1) issues.overlapSamples += 1;
      const parcel = owners[0].parcel;
      const block = blockById.get(parcel.blockId);
      if (!block.buildablePolygons.some(piece => inPoly(piece, x, z)) && !block.buildablePolygons.some(piece => [piece.polygon, ...piece.holes].some(ring => ringDist(ring, x, z) <= 0.6))) issues.outsideBuildable += 1;
      if (freeboardAt(x, z) < -0.3) issues.wet += 1;
      if (slopeAt(x, z) > CHUNK.maxBuildableSlope + 0.75) issues.steep += 1;
      if ((roadGrid.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []).some(seg => segDist(x, z, seg.a, seg.b) - seg.w < -0.6)) issues.onRoad += 1;
    }
    const parcelArea = result.stats.parcelArea;
    const abnormal = blocks.blocks.filter(block => block.buildableArea > 1000 && !result.parcels.some(parcel => parcel.blockId === block.id)).map(block => ({ id: block.id, buildableArea: block.buildableArea, reason: result.reserve.find(item => item.blockId === block.id)?.reason ?? 'unknown' }));
    const reasons = {};
    result.residuals.forEach(item => { const key = item.reason.replace(/[0-9.]+/g, '#'); reasons[key] = (reasons[key] ?? 0) + 1; });
    return {
      strategy: graph.strategy, signature: result.signature, json: JSON.stringify(result.parcels), issues, stats: result.stats, reasons, abnormal,
      areaRel: Math.abs(sampled - parcelArea) / Math.max(1, parcelArea),
      validFrontage: result.parcels.length ? (result.parcels.length - issues.fakeFrontage - issues.nonRoadFrontage - issues.notInBlockRoads) / result.parcels.length : 0,
    };
  });

  const plan = [['plain', 'manhattanGrid'], ['coast', 'fezOrganicCore'], ['riverValley', 'veniceWaterNetwork']];
  const runs = [];
  for (const [landform, dna] of plan) {
    for (const seed of seeds) {
      const id = `${landform} ${seed} ${dna}`;
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const first = await inspect();
      await open(`landform=${landform}&seed=${seed}&dna=${dna}`);
      const repeat = await inspect();
      assert(first.signature === repeat.signature && first.json === repeat.json, `${id}: parcels not reproducible.`);
      const bad = Object.entries(first.issues).filter(([, count]) => count > 0);
      assert(bad.length === 0, `${id}: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      assert(first.areaRel < 0.01, `${id}: parcel area vs samples ${first.areaRel}.`);
      assert(first.stats.parcels > 0, `${id}: no parcels.`);
      runs.push({ landform, seed, dna, strategy: first.strategy, stats: first.stats, reasons: first.reasons, abnormal: first.abnormal, areaRel: first.areaRel, validFrontage: first.validFrontage });
    }
  }
  assert(browserErrors.length === 0, `Browser errors detected:\n${browserErrors.join('\n')}`);

  // Evidence: (1) overall parcels view per strategy; (2) local frontage close-ups.
  const capture = async query => { await open(query); await page.waitForTimeout(400); return (await page.locator('#terrainCanvas').screenshot({ animations: 'disabled' })).toString('base64'); };
  const composite = async (tiles, file, columns) => {
    const compositePage = await browser.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 1 });
    await compositePage.setContent(`<link rel="icon" href="data:,"><style>body{margin:0;background:#081014;display:grid;grid-template-columns:repeat(${columns},1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;bottom:6px;color:#edf5f2;font:12px Consolas,monospace;background:#081014cc;padding:4px 6px}</style>${tiles.join('')}`);
    await mkdir(path.dirname(file), { recursive: true });
    await compositePage.screenshot({ path: file, fullPage: true });
    await compositePage.close();
  };
  const caption = run => `${run.strategy} · ${run.landform} ${run.seed} · ${run.stats.parcels} parcels · mean frontage ${run.stats.meanFrontage.toFixed(1)} m · uses ${(run.stats.utilisation * 100).toFixed(0)}% of buildable`;
  const overall = [];
  for (const [landform, dna] of plan) {
    const run = runs.find(item => item.landform === landform && item.dna === dna && item.seed === seeds[0]);
    overall.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${landform}&seed=${seeds[0]}&dna=${dna}&view=parcels`)}"><figcaption>${caption(run)}</figcaption></figure>`);
  }
  await composite(overall, overallShot, 3);
  const local = [];
  for (const [landform, dna, focus, note] of [['plain', 'manhattanGrid', '-451,-366,230', 'grid block B15: frontage lots, corner lots'], ['riverValley', 'veniceWaterNetwork', '-120,40,260', 'canal-street: lots on lanes and quays']]) {
    local.push(`<figure><img src="data:image/png;base64,${await capture(`landform=${landform}&seed=${seeds[0]}&dna=${dna}&view=parcels&focus=${focus}`)}"><figcaption>${note} · yellow frontage · orange corner frontage · cyan inward tick · magenta reserve</figcaption></figure>`);
  }
  await composite(local, debugShot, 2);

  const evidence = { task: '04.2', experiment: entry, testedAt: new Date().toISOString(), runs, browserErrors, screenshots: [overallShot, debugShot].map(file => path.relative(root, file).replaceAll('\\', '/')) };
  await mkdir(path.dirname(record), { recursive: true });
  await writeFile(record, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runs: runs.map(run => `${run.landform} ${run.seed} ${run.strategy}: ${run.stats.parcels} parcels (corner ${run.stats.corner}, canal ${run.stats.withCanalFrontage}) · valid frontage ${(run.validFrontage * 100).toFixed(0)}% · mean frontage ${run.stats.meanFrontage.toFixed(1)} m · mean ${run.stats.meanArea.toFixed(0)} m² · depth ${run.stats.meanDepth.toFixed(1)} m · utilisation ${(run.stats.utilisation * 100).toFixed(1)}% · reserve ${(run.stats.reserveArea / 1e4).toFixed(1)} ha · area err ${(run.areaRel * 100).toFixed(2)}% · in band ${run.stats.inTransition} · unresolved ${JSON.stringify(run.reasons)} · abnormal blocks ${JSON.stringify(run.abnormal.map(item => `${item.id}:${item.reason}`))}`),
    screenshots: evidence.screenshots,
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
}
