// A City of Cities — G01 Multi-Origin Initialization verifier.
// Part A (Node, WorldContext): identity, determinism (repeat, input order, chunk generation order), generation chain,
//   spatial checks, explainable suitability + rejections, growth interface is read-only, save / load, non-zero
//   origin regression — world seeds 6201 / 1234 / 4242.
// Part B (browser): the page reproduces the Node world, renders six real cores, timings + memory, visibility toggle
//   without regeneration, regenerate = same world, save → reload → load, five screenshots.
// Usage: node scripts/verify-city-of-cities.mjs [--node-only | --browser-only] (--browser-only reuses the last Part A record)
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = file => import(pathToFileURL(path.join(root, file)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { CITY_IDS, CHUNK_SIZE } = await mod('experiments/city-of-cities/originConfig.js');
const { evaluateSite } = await mod('experiments/city-of-cities/OriginPlacement.js');
const { terrainOf, networkOf } = await mod('experiments/growing-world/WorldGrowthController.js');
const { generateUrbanLayer } = await mod('experiments/world-grid/WorldGrid.js');

const SEEDS = [6201, 6202, 6203]; // G01 fix (placement v2): the G02 seeds; 1234 / 4242 were the original G01 seeds
const nodeOnly = process.argv.includes('--node-only');
const browserOnly = process.argv.includes('--browser-only');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const evidenceDir = path.join(root, 'experiments/city-of-cities/evidence');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const json = v => JSON.stringify(v);
const cheb = (a, b) => Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy));
const placementOnly = s => json({ ...s, chunks: s.chunks.map(({ expectedSignatures, ...c }) => c) });
const result = { task: 'G01 (A City of Cities) — Multi-Origin Initialization', experiment: 'experiments/city-of-cities/', testedAt: new Date().toISOString(), seeds: SEEDS, node: {}, regression: null, browser: null };

// ---------- Part A ----------
const started = Date.now();
if (browserOnly) { const last = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(evidenceDir, 'city-origins.json'), 'utf8')); Object.assign(result, { node: last.node, regression: last.regression, nodeMs: last.nodeMs, nodeTestedAt: last.testedAt }); }
for (const seed of browserOnly ? [] : SEEDS) {
  const t0 = Date.now();
  const w = new WorldContext({ worldSeed: seed });
  const report = w.initialise();
  const placementMs = Date.now() - t0;
  const origins = [...w.cities.values()];
  // Identity.
  assert(report.failures.length === 0, `seed ${seed}: placement failures ${json(report.failures)}`);
  assert(origins.length === 6 && w.chunks.size === 6, `seed ${seed}: ${origins.length} origins / ${w.chunks.size} chunks`);
  assert(json(origins.map(o => o.cityId).sort()) === json([...CITY_IDS].sort()), `seed ${seed}: wrong City IDs`);
  assert(new Set(origins.map(o => o.citySeed)).size === 6, `seed ${seed}: city seeds not distinct`);
  assert(new Set([...w.chunks.values()].map(c => `${c.worldCoordinate.gx},${c.worldCoordinate.gy}`)).size === 6, `seed ${seed}: duplicate cells`);
  // Spatial.
  let minDistance = Infinity;
  for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) minDistance = Math.min(minDistance, cheb(origins[i].worldCoordinate, origins[j].worldCoordinate));
  assert(minDistance >= w.params.minOriginDistance, `seed ${seed}: origins closer than ${w.params.minOriginDistance}`);
  for (const c of w.chunks.values()) {
    assert(c.worldOrigin.x === c.worldCoordinate.gx * CHUNK_SIZE && c.worldOrigin.z === c.worldCoordinate.gy * CHUNK_SIZE, `seed ${seed}: ${c.chunkId} world origin wrong`);
    assert(c.role === 'core' && c.generation === 0 && c.parentChunkId === null, `seed ${seed}: ${c.chunkId} is not a generation-0 core`);
  }
  // Explainable suitability: stored score = weighted mean of stored terms; recomputed evaluation equals the record.
  for (const o of origins) {
    const r = o.placementReason;
    const total = Object.values(r.weights).reduce((a, b) => a + b, 0);
    const mean = Object.entries(r.terms).reduce((s, [k, v]) => s + r.weights[k] * v, 0) / total;
    assert(Math.abs(mean - r.score) < 2e-3, `seed ${seed}: ${o.cityId} score ${r.score} ≠ weighted mean ${mean}`);
    const again = evaluateSite(w, o.cityId, w.probe(o.worldCoordinate.gx, o.worldCoordinate.gy));
    assert(again.score === r.score && !again.rejected, `seed ${seed}: ${o.cityId} evaluation not reproducible`);
  }
  const rejections = Object.values(report.candidates).flatMap(c => [...c.screened.filter(s => s.rejected).map(s => s.rejected), ...c.probed.filter(p => p.rejected).map(p => p.rejected)]);
  const rejectedKinds = rejections.reduce((acc, r) => { const k = r.replace(/[\d.]+/g, '#'); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  const distanceRejected = Object.values(report.candidates).flatMap(c => c.probed.filter(p => p.distanceRejectedBy).map(p => p.distanceRejectedBy)).length;
  // Determinism: repeat; reversed input order.
  const again = new WorldContext({ worldSeed: seed }); again.initialise();
  assert(placementOnly(again.serialise()) === placementOnly(w.serialise()), `seed ${seed}: repeat changed the placement`);
  const reversed = new WorldContext({ worldSeed: seed }); reversed.initialise([...CITY_IDS].reverse());
  assert(placementOnly(reversed.serialise()) === placementOnly(w.serialise()), `seed ${seed}: input order changed the placement`);
  // Generation chain, sorted order vs reversed order.
  const chunkTimes = [];
  for (const id of [...w.chunks.keys()].sort()) { const { chunk } = w.generateChunk(id); chunkTimes.push({ chunkId: id, cityId: chunk.cityId, ...chunk.outputs.ms }); }
  for (const id of [...again.chunks.keys()].sort().reverse()) again.generateChunk(id);
  for (const c of w.chunks.values()) {
    assert(c.outputs.resolvedDNA === c.cityId, `seed ${seed}: ${c.chunkId} resolved ${c.outputs.resolvedDNA}, expected ${c.cityId}`);
    assert(json(c.outputs.signatures) === json(again.chunks.get(c.chunkId).outputs.signatures), `seed ${seed}: generation order changed ${c.chunkId}`);
  }
  // Growth interface is read-only.
  for (const id of CITY_IDS) w.frontierOf(id);
  w.dependenciesOf(CITY_IDS[0]);
  assert(w.chunks.size === 6 && w.growth.generation === 0 && w.growth.history.length === 0, `seed ${seed}: growth interface changed the world`);
  // Save / load.
  const saved = JSON.parse(json(w.serialise()));
  const restored = WorldContext.restore(saved);
  assert(placementOnly(restored.serialise()) === placementOnly(saved), `seed ${seed}: restore changed the configuration`);
  for (const id of [...restored.chunks.keys()]) { const { chunk } = restored.generateChunk(id); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `seed ${seed}: restored ${id} differs`); }
  assert(saved.schemaVersion >= 1 && saved.growth.generation === 0 && Array.isArray(saved.growth.history), `seed ${seed}: state schema`);
  if (seed === SEEDS[0]) { await mkdir(evidenceDir, { recursive: true }); await writeFile(path.join(evidenceDir, `world-${seed}-g01-state.json`), `${JSON.stringify(saved, null, 2)}\n`); }
  result.node[seed] = {
    origins: origins.map(o => ({ cityId: o.cityId, chunkId: o.originChunkId, cell: o.worldCoordinate, worldPosition: o.worldPosition, citySeed: o.citySeed, terrainSeed: w.chunks.get(o.originChunkId).terrainSeed, urbanSeed: w.chunks.get(o.originChunkId).generationParameters.urbanSeed, landform: w.chunks.get(o.originChunkId).terrainType, score: o.placementReason.score, terms: o.placementReason.terms, rank: o.placementReason.rankInWeightedOrder, qualified: o.placementReason.qualified, constrainedBy: o.placementReason.constrainedBy, counts: w.chunks.get(o.originChunkId).outputs.counts })),
    claimOrder: report.order, minDistance, probes: w.stats.probes, placementMs, rejections: rejections.length, rejectedKinds, distanceRejected, chunkTimes, totalMs: Date.now() - t0,
  };
  console.log(`seed ${seed}: 6 origins, min distance ${minDistance}, ${w.stats.probes} probes, placement ${placementMs} ms, ${rejections.length} rejected sites, total ${Date.now() - t0} ms`);
}
if (!browserOnly) {
const layouts = SEEDS.map(s => json(result.node[s].origins.map(o => [o.cityId, o.cell])));
assert(new Set(layouts).size === SEEDS.length, 'different seeds gave identical origin layouts');

// Non-zero origin regression: the same cell generated at world origin 0 and at its world position.
{
  const o = result.node[SEEDS[0]].origins.find(x => x.cityId === 'manhattanGrid');
  const w = new WorldContext({ worldSeed: SEEDS[0] });
  const cell = w.cell(o.cell.gx, o.cell.gy);
  const run = (c, identity) => { const terrain = terrainOf(c); const net = networkOf(c, 'manhattanGrid', terrain); return { terrain, net, city: generateUrbanLayer(terrain, net, net.network, null, identity) }; };
  const at0 = run({ ...cell, worldOrigin: { x: 0, z: 0 } }, null); const atW = run(cell, null);
  const dx = cell.worldOrigin.x; const dz = cell.worldOrigin.z;
  let maxDev = 0;
  at0.net.network.edges.forEach((e, i) => e.points.forEach((p, j) => { const q = atW.net.network.edges[i].points[j]; maxDev = Math.max(maxDev, Math.abs(q.x - p.x - dx), Math.abs(q.z - p.z - dz)); }));
  const heights = b => b.buildings.buildings.map(x => +x.height.toFixed(3));
  result.regression = {
    cell: o.cell, worldOrigin: cell.worldOrigin, heightSignatureEqual: at0.terrain.fields.stats.heightSignature === atW.terrain.fields.stats.heightSignature,
    networkEdges: [at0.net.network.edges.length, atW.net.network.edges.length], maxPointDeviationM: +maxDev.toFixed(6),
    legacyIds: { blocks: [at0.city.blocks.stats.blocks, atW.city.blocks.stats.blocks], parcels: [at0.city.parcels.stats.parcels, atW.city.parcels.stats.parcels], buildings: [at0.city.buildings.stats.buildings, atW.city.buildings.stats.buildings], heightsEqual: json(heights(at0.city)) === json(heights(atW.city)) },
  };
  assert(result.regression.heightSignatureEqual && at0.net.network.edges.length === atW.net.network.edges.length && maxDev < 1e-3, `non-zero origin regression failed ${json(result.regression)}`);
  console.log(`non-zero origin regression: ${json(result.regression)}`);
}
// Placement v2: failure is classified and atomic (no partially initialised world). Forced by an impossible spacing.
{
  const w = new WorldContext({ worldSeed: SEEDS[0], minOriginDistance: 8, searchRadius: 3 });
  const report = w.initialise();
  assert(report.failures.length > 0 && report.failures.every(f => ['noSuitableLandform', 'insufficientWater', 'buildConditions', 'spacingConflict'].includes(f.kind)), 'forced failure not classified');
  assert(w.cities.size === 0 && w.chunks.size === 0 && w.occupancy.size === 0, 'failed placement left a partial world');
  result.failureTest = { params: { minOriginDistance: 8, searchRadius: 3 }, failures: report.failures.map(f => ({ cityId: f.cityId, kind: f.kind, reason: f.reason })), registered: 0 };
  console.log(`forced failure: ${report.failures.map(f => `${f.cityId} [${f.kind}]`).join(', ')}; registered 0`);
}
// Compatibility: a World State saved before the fix (schema v1, placement v1, commit 69b3a1f) loads unchanged.
{
  const legacy = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(evidenceDir, 'legacy/world-6201-g01-state.placement-v1.json'), 'utf8'));
  const w = WorldContext.restore(legacy);
  for (const id of [...w.chunks.keys()]) { const { chunk } = w.generateChunk(id); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `legacy state: ${id} differs`); }
  assert(json(legacy.cities.map(c => [c.cityId, c.worldCoordinate])) === json([...w.cities.values()].sort((a, b) => a.cityId.localeCompare(b.cityId)).map(c => [c.cityId, c.worldCoordinate])), 'legacy state: origins moved');
  result.legacyState = { schemaVersion: legacy.schemaVersion, placementVersion: w.placement.placementVersion, chunks: w.chunks.size, signaturesMatch: true, originsUnchanged: true };
  console.log('legacy v1 state: loads unchanged, all signatures match');
}
result.nodeMs = Date.now() - started;
console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4212; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
  const exists = async file => { try { await access(file); return true; } catch { return false; } };
  const ready = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
  const browserPath = async () => {
    for (const c of [process.env.PLAYWRIGHT_CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean)) if (await exists(c)) return c;
    throw new Error('Chrome or Edge was not found.');
  };
  const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
  let browser;
  try {
    for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) { if (server.exitCode !== null) throw new Error(`Vite stopped.\n${output}`); await new Promise(r => setTimeout(r, 250)); }
    browser = await chromium.launch({ executablePath: await browserPath(), headless: true, args: ['--enable-precise-memory-info'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`page: ${e.message}`));
    const lab = (fn, arg) => page.evaluate(fn, arg);
    const waitReady = () => page.waitForFunction(() => window.__originLab?.ready === true, null, { timeout: 600000 });
    const call = async (fn, arg) => { await lab(fn, arg); await page.waitForTimeout(50); await waitReady(); const e = await lab(() => window.__originLab.error()); assert(!e, `page error: ${e}`); };
    const shot = async name => { await page.waitForTimeout(700); const file = path.join(shots, name); await page.locator('#worldCanvas').screenshot({ path: file }); return file; };
    const seed = SEEDS[0];
    const b = { seed, screenshots: {} };

    const tLoad = Date.now();
    await page.goto(`${base}${entry}?worldSeed=${seed}`, { waitUntil: 'networkidle' });
    await waitReady();
    b.pageLoadMs = Date.now() - tLoad;
    b.timing = await lab(() => window.__originLab.timing());
    b.memoryMB = b.timing.memoryMB;
    const s1 = await lab(() => window.__originLab.state());
    const nodeState = (await import('node:fs/promises')).readFile(path.join(evidenceDir, `world-${seed}-g01-state.json`), 'utf8');
    assert(placementOnly(s1) === placementOnly(JSON.parse(await nodeState)), 'browser placement differs from Node');
    // Across runtimes (Node vs Chrome) terrain, water, blocks, parcels and buildings must match exactly. The network
    // signature hashes full-precision metadata (axisDeg from Math.atan2), which can differ by 1 ulp between V8
    // builds; it is reported, and within one runtime every signature must match exactly (regenerate, restore).
    const nodeChunks = JSON.parse(await nodeState).chunks;
    b.crossRuntime = s1.chunks.map(c => {
      const n = nodeChunks.find(x => x.chunkId === c.chunkId).expectedSignatures;
      const differs = Object.keys(c.expectedSignatures).filter(k => c.expectedSignatures[k] !== n[k]);
      assert(differs.every(k => k === 'network'), `browser ${c.chunkId} differs from Node in ${differs.join(', ')}`);
      return { chunkId: c.chunkId, cityId: c.cityId, differs };
    });
    assert(await lab(() => window.__originLab.sceneChunkCount()) === 6, 'browser: scene does not hold six chunks');
    b.screenshots.overview = await shot('g01-origins-overview-after.png');
    await lab(() => window.__originLab.setLayers({ debug: true, ownership: true }));
    b.screenshots.debug = await shot('g01-origins-ids-debug.png');
    await lab(() => { window.__originLab.setLayers({ debug: false, candidates: true }); window.__originLab.select('manhattanGrid'); window.__originLab.fitCandidates('manhattanGrid'); });
    b.screenshots.suitability = await shot('g01-origins-suitability-debug.png');
    await lab(() => window.__originLab.setLayers({ candidates: false }));
    await lab(() => { window.__originLab.select('manhattanGrid'); window.__originLab.focus('manhattanGrid'); });
    b.screenshots.closeup = await shot('g01-origins-city-closeup-after.png');
    // Display state: hiding / showing one city does not regenerate anything.
    const buildsBefore = await lab(() => window.__originLab.builds());
    await lab(() => window.__originLab.setVisible('chicagoGrid', false));
    await page.waitForTimeout(200);
    await lab(() => window.__originLab.setVisible('chicagoGrid', true));
    assert(json(await lab(() => window.__originLab.builds())) === json(buildsBefore), 'visibility toggle regenerated a chunk');
    // Regenerate with the same seed.
    await lab(() => window.__originLab.overview('top'));
    const firstPng = await page.locator('#worldCanvas').screenshot();
    await call(() => window.__originLab.regenerate());
    const s2 = await lab(() => window.__originLab.state());
    assert(json(s2) === json(s1), 'regenerate with the same seed changed the world');
    const secondPng = await page.locator('#worldCanvas').screenshot();
    // Save → reload page (new document) → load from browser storage.
    await lab(() => window.__originLab.saveLocal());
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' });
    await waitReady();
    const tRestore = Date.now();
    await call(() => window.__originLab.loadLocal());
    b.restoreMs = Date.now() - tRestore;
    const s3 = await lab(() => window.__originLab.state());
    assert(json(await lab(() => window.__originLab.mismatches())) === '[]', 'restored chunks differ from the saved signatures');
    assert(placementOnly(s3) === placementOnly(s1) && json(s3.chunks.map(c => c.expectedSignatures)) === json(s1.chunks.map(c => c.expectedSignatures)), 'restored world differs');
    // Comparison sheet: first generation vs regeneration (same seed).
    const sheet = await context.newPage();
    await sheet.setViewportSize({ width: 2200, height: 820 });
    await sheet.setContent(`<body style="margin:0;background:#081014;color:#f4f1ea;font:16px system-ui"><div style="display:flex;gap:12px;padding:12px">${[['First generation', firstPng], ['Regenerated, same world seed', secondPng]].map(([t, png]) => `<figure style="margin:0;flex:1"><figcaption style="padding:6px 0">${t} · world seed ${seed}</figcaption><img src="data:image/png;base64,${png.toString('base64')}" style="width:100%;display:block"/></figure>`).join('')}</div></body>`);
    b.screenshots.compare = path.join(shots, 'g01-origins-regenerate-compare.png');
    await sheet.screenshot({ path: b.screenshots.compare, fullPage: true });
    b.regenerateIdentical = true; b.restore = { mismatches: 0, sameState: true };
    b.screenshots = Object.fromEntries(Object.entries(b.screenshots).map(([k, f]) => [k, path.relative(root, f).replaceAll('\\', '/')]));
    b.errors = errors;
    assert(!errors.length, `browser errors:\n${errors.join('\n')}`);
    result.browser = b;
    console.log(`Part B passed: page ${b.pageLoadMs} ms, placement ${b.timing.placementMs} ms, first city rendered ${b.timing.firstRenderMs} ms, all six ${b.timing.totalMs} ms, heap ${b.memoryMB} MB, restore ${b.restoreMs} ms`);
  } finally {
    await browser?.close();
    server.kill();
  }
}

await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, 'city-origins.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log('G01 Multi-Origin Initialization verification passed. Record: experiments/city-of-cities/evidence/city-origins.json');
