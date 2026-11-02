// A City of Cities — G03a Urban Territory & Spatial Relationships verifier.
// Part A (Node; seeds 6201 / 6202 / 6203; 0 → 10 → 30 growth steps): after every step the territory model is checked
//   against independent recomputation from coordinates and probes — City IDs never change, territory statistics equal
//   the real occupancy and generated outputs, boundary classes, inter-city adjacencies and corner contacts, ecological
//   cells only where an explicit rule holds (never unexplored cells). Incremental ownership = full replay; the same seed
//   twice = identical analysis; save at 10 → load → continue to 30 = uninterrupted; G02 history unchanged; static scan.
// Part B (browser, seed 6201): the page reproduces the Node analysis, save → reload → load restores it exactly, and the
//   six G03a screenshots are taken.  Usage: node scripts/verify-city-territory.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { TerritoryModel, constraintOf } = await mod('experiments/city-of-cities/TerritoryModel.js');
const { CITY_IDS } = await mod('experiments/city-of-cities/originConfig.js');
const { DIRECTIONS } = await mod('experiments/city-of-cities/growthDNA.js');

const seedArg = process.argv.find(a => a.startsWith('--seeds='));
const SEEDS = seedArg ? seedArg.split('=')[1].split(',').map(Number) : [6201, 6202, 6203];
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'city-territory.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const key = (gx, gy) => `${gx},${gy}`;
const result = { task: 'G03a — Urban Territory & Spatial Relationships', testedAt: new Date().toISOString(), seeds: SEEDS, node: {}, browser: null };
if (browserOnly) Object.assign(result, (({ node, staticScan }) => ({ node, staticScan }))(JSON.parse(await readFile(recordFile, 'utf8'))));

// Independent checks of one analysed state.
function check(w, t, owners, label) {
  const d = t.derived;
  // 1. City IDs of existing chunks never change.
  for (const [id, city] of owners) assert(w.chunks.get(id)?.cityId === city, `${label}: ${id} changed City ID`);
  for (const c of w.chunks.values()) owners.set(c.chunkId, c.cityId);
  // 2. Territory statistics = real occupancy and generated outputs.
  for (const tt of d.territories) {
    const mine = [...w.chunks.values()].filter(c => c.cityId === tt.cityId);
    assert(json([...tt.occupiedChunkIds].sort()) === json(mine.map(c => c.chunkId).sort()), `${label}: ${tt.cityId} territory ≠ occupancy`);
    assert(Math.abs(tt.territoryArea.chunkCoverageKm2 - mine.length * 1.048576) < 0.002, `${label}: ${tt.cityId} coverage area`);
    assert(Math.abs(tt.territoryArea.builtFootprintKm2 - mine.reduce((s, c) => s + c.outputs.areas.builtFootprintM2, 0) / 1e6) < 0.002, `${label}: ${tt.cityId} built area`);
    assert(tt.territoryArea.builtFootprintKm2 <= tt.territoryArea.chunkCoverageKm2, `${label}: built area exceeds coverage`);
  }
  // 3. Boundary classes recomputed independently.
  const eligible = new Set(); for (const list of Object.values(d.frontier)) for (const c of list) if (c.status === 'eligible') eligible.add(key(c.gx, c.gy));
  const expectState = (gx, gy) => { const p = w.probes.get(key(gx, gy)); if (!p) return 'unexplored'; if (constraintOf(p)) return 'ecological'; return 'evaluated'; };
  let segments = 0;
  for (const tt of d.territories) for (const s of tt.boundarySegments) {
    const o = w.chunkAt(s.neighbour.gx, s.neighbour.gy);
    const want = o ? (o.cityId === tt.cityId ? 'urbanSameCity' : 'urbanOtherCity') : { unexplored: 'urbanUnexplored', ecological: 'urbanEcological', evaluated: 'urbanEvaluated' }[expectState(s.neighbour.gx, s.neighbour.gy)];
    assert(s.type === want, `${label}: boundary ${s.chunkId} ${s.direction} is ${s.type}, expected ${want}`);
    assert(s.frontier === (!o && eligible.has(key(s.neighbour.gx, s.neighbour.gy)) && expectState(s.neighbour.gx, s.neighbour.gy) !== 'ecological'), `${label}: frontier flag ${s.chunkId} ${s.direction}`);
    segments += 1;
  }
  assert(segments === w.chunks.size * 4, `${label}: ${segments} boundary segments for ${w.chunks.size} chunks`);
  // 4. Ecological cells only where an explicit rule holds; never unexplored.
  for (const c of d.cells.values()) {
    if (c.state === 'ecologicalConstraint') { const p = w.probes.get(key(c.gx, c.gy)); assert(p && constraintOf(p), `${label}: ${c.gx},${c.gy} constraint without rule / probe`); }
    if (c.state !== 'urbanTerritory') assert(w.probes.has(key(c.gx, c.gy)), `${label}: non-urban state on an unexplored cell ${c.gx},${c.gy}`);
  }
  // 5. Adjacencies and relationships recomputed from coordinates.
  const pairs = new Set();
  for (const a of w.chunks.values()) for (const [dx, dy] of Object.values(DIRECTIONS)) { const b = w.chunkAt(a.worldCoordinate.gx + dx, a.worldCoordinate.gy + dy); if (b && b.cityId !== a.cityId) pairs.add([a.chunkId, b.chunkId].sort().join('|')); }
  assert(json([...pairs].sort()) === json(d.adjacencies.map(x => [x.chunkA, x.chunkB].sort().join('|')).sort()), `${label}: adjacency set differs`);
  for (const r of d.relationships) {
    const [A, B] = r.cities;
    const ca = [...w.chunks.values()].filter(c => c.cityId === A); const cb = [...w.chunks.values()].filter(c => c.cityId === B);
    const edge = ca.some(a => cb.some(b => Math.abs(a.worldCoordinate.gx - b.worldCoordinate.gx) + Math.abs(a.worldCoordinate.gy - b.worldCoordinate.gy) === 1));
    assert((r.relation === 'directAdjacency') === edge, `${label}: ${A}-${B} relation ${r.relation}`);
    if (edge) assert(r.verifiedConnection.startsWith('unknown') || r.verifiedConnection.startsWith('none'), `${label}: adjacency claimed as connection`);
  }
  return { segments };
}

async function grownWorld(seed) {
  const w = new WorldContext({ worldSeed: seed });
  const rep = w.initialise();
  assert(!rep.failures.length, `seed ${seed}: G01 placement failure ${json(rep.failures)}`);
  for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
  return { w, g: new WorldGrowthController(w) };
}
async function run(seed, steps, { checks = true } = {}) {
  const { w, g } = await grownWorld(seed);
  const t = new TerritoryModel(w); t.refresh(g);
  const owners = new Map(); const snaps = { 0: t.snapshot() }; const timing = [];
  if (checks) check(w, t, owners, `seed ${seed} step 0`);
  for (let k = 1; k <= steps; k += 1) {
    const t0 = Date.now(); const r = g.step(); assert(!r.stalled, `seed ${seed}: stalled at ${k}`);
    const t1 = Date.now(); t.applyEvent(r.event); t.refresh(g); timing.push({ step: k, growMs: t1 - t0, analysisMs: Date.now() - t1 });
    if (checks) check(w, t, owners, `seed ${seed} step ${k}`);
    if (k === 10 || k === 30) snaps[k] = t.snapshot();
  }
  return { w, g, t, snaps, timing };
}

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  const forbidden = ['new WorldGrid', 'fuseNetwork', 'stitchRoads', 'coordinateTerrain', 'harmonizeWorld', 'coordinateWorld', 'influenceField', 'setInfluence', 'mixedRules'];
  const hits = [];
  for (const f of ['TerritoryModel.js', 'TerritoryView.js', 'main.js', 'WorldContext.js', 'WorldGrowthController.js']) { const text = await readFile(path.join(root, 'experiments/city-of-cities', f), 'utf8'); for (const tok of forbidden) if (text.includes(tok)) hits.push(`${f}: ${tok}`); }
  assert(!hits.length, `forbidden call path ${hits.join(', ')}`);
  result.staticScan = { forbidden, hits: 0 };
  const g02 = JSON.parse(await readFile(path.join(evidence, 'city-growth.json'), 'utf8'));
  for (const seed of SEEDS) {
    const t0 = Date.now();
    const main = await run(seed, 30);
    // G02 unchanged by the analysis layer.
    const hist = main.w.growth.history.map(e => `${e.step}:${e.newChunkId}:${e.cityId}<${e.parentChunkId}:${e.selectionScore}:${e.outputs.counts.buildings}`);
    const ref = g02.node[seed]?.steps.map(s => `${s.step}:${s.chunkId}:${s.cityId}<${s.parent}:${s.score}:${s.buildings}`);
    assert(!ref || json(hist) === json(ref), `seed ${seed}: growth history differs from the G02 record`);
    // Incremental = full replay.
    const replay = TerritoryModel.build(main.w); replay.refresh(main.g);
    assert(json(replay.snapshot()) === json(main.snaps[30]), `seed ${seed}: incremental ≠ replay`);
    // Same seed twice.
    const twin = await run(seed, 30, { checks: false });
    for (const k of [0, 10, 30]) assert(json(twin.snaps[k]) === json(main.snaps[k]), `seed ${seed}: twin differs at step ${k}`);
    // Save at 10 → load → continue to 30.
    const half = await run(seed, 10, { checks: false });
    const saved = JSON.parse(json({ ...half.w.serialise(), territory: half.snaps[10] }));
    const w2 = WorldContext.restore(saved);
    for (const c of [...w2.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) w2.generateChunk(c.chunkId);
    const g2 = new WorldGrowthController(w2);
    const t2 = TerritoryModel.restore(w2, g2, saved.territory); // throws unless the saved analysis is reproduced
    for (let k = 11; k <= 30; k += 1) { const r = g2.step(); t2.applyEvent(r.event); t2.refresh(g2); }
    assert(json(t2.snapshot()) === json(main.snaps[30]), `seed ${seed}: save / load / continue differs`);
    const s = main.snaps;
    const brief = snap => ({ metrics: snap.metrics, territories: snap.territories.map(x => ({ cityId: x.cityId, chunks: x.chunkCount, area: x.territoryArea, active: x.active, blocked: x.blocked, status: x.status, stopReason: x.stopReason, neighbours: x.neighboringCities, boundaryKm: +(x.boundaryLengthM.external / 1000).toFixed(3), byType: x.boundaryLengthM.byType })), adjacencies: snap.adjacencies, relationships: snap.relationships.map(r => ({ cities: r.cities, relation: r.relation, corner: r.cornerContact, nearest: r.nearest, barrier: r.barrierStatus, connection: r.verifiedConnection })) });
    result.node[seed] = { origins: brief(s[0]), step10: brief(s[10]), step30: brief(s[30]), analysisMs: { max: Math.max(...main.timing.map(x => x.analysisMs)), mean: Math.round(main.timing.reduce((n, x) => n + x.analysisMs, 0) / main.timing.length) }, checksPerStep: 'ownership, statistics, boundaries, constraints, adjacencies, relationships', incrementalEqualsReplay: true, twinIdentical: true, saveLoadContinue: true, g02HistoryUnchanged: !!ref, ms: Date.now() - t0 };
    if (seed === SEEDS[0]) await writeFile(path.join(evidence, `world-${seed}-g03a-step30-territory.json`), `${JSON.stringify(s[30], null, 2)}\n`);
    console.log(`seed ${seed}: OK · step 30 shared edges ${s[30].metrics.interCityAdjacencies.sharedEdges}, corner contacts ${s[30].metrics.interCityAdjacencies.cornerContactPairs}, ecological ${s[30].metrics.cells.ecologicalConstraint}, stopped ${s[30].metrics.stoppedCities.join(',') || 'none'} · ${Date.now() - t0} ms`);
  }
  result.nodeMs = Date.now() - started;
  console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4216; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
  const exists = async f => { try { await access(f); return true; } catch { return false; } };
  const ready = async u => { try { return (await fetch(u, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } };
  const server = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', host, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let browser;
  try {
    for (let i = 0; i < 60 && !(await ready(`${base}${entry}`)); i += 1) await new Promise(r => setTimeout(r, 250));
    let exe = process.env.PLAYWRIGHT_CHROME_PATH; for (const c of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) if (!exe && await exists(c)) exe = c;
    browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(e.message));
    const lab = (fn, arg) => page.evaluate(fn, arg);
    const waitReady = () => page.waitForFunction(() => window.__originLab?.ready === true, null, { timeout: 900000 });
    const call = async (fn, arg) => { await lab(fn, arg); await page.waitForTimeout(50); await waitReady(); const e = await lab(() => window.__originLab.error()); assert(!e, `page error ${e}`); };
    const shot = async name => { await page.waitForTimeout(800); const f = path.join(shots, name); await page.locator('#worldCanvas').screenshot({ path: f }); return path.relative(root, f).replaceAll('\\', '/'); };
    const fitCells = async () => { const snap = await lab(() => window.__originLab.territorySnapshot()); const xy = snap.cellStates.map(s => s.split(':')[0].split(',').map(Number)); await lab(b => window.__originLab.fitRegion(...b), [Math.min(...xy.map(p => p[0])), Math.min(...xy.map(p => p[1])), Math.max(...xy.map(p => p[0])), Math.max(...xy.map(p => p[1]))]); };
    const seed = SEEDS[0]; const b = { seed, screenshots: {} };
    const node = JSON.parse(await readFile(recordFile, 'utf8').catch(() => 'null')) ?? result;
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await call(x => window.__originLab.generate(x), seed);
    await lab(() => window.__originLab.setLayers({ territory: true, boundaries: true, constraints: true, ownership: false }));
    await fitCells(); b.screenshots.origins = await shot('g03a-territory-origins.png');
    await call(() => window.__originLab.growSteps(10));
    await fitCells(); b.screenshots.step10 = await shot('g03a-territory-step10.png');
    await call(() => window.__originLab.growSteps(20));
    const snap30 = await lab(() => window.__originLab.territorySnapshot());
    const nodeSnap = JSON.parse(await readFile(path.join(evidence, `world-${seed}-g03a-step30-territory.json`), 'utf8'));
    assert(json(snap30) === json(nodeSnap), 'browser territory analysis differs from Node');
    await fitCells(); b.screenshots.step30 = await shot('g03a-territory-step30.png');
    // Frontier + ecological constraints around the Manhattan core (labels readable).
    const core = (await lab(() => window.__originLab.chunks())).find(c => c.cityId === 'manhattanGrid' && c.role === 'core').worldCoordinate;
    await lab(([gx, gy]) => { window.__originLab.setLayers({ territory: false, boundaries: false, constraints: true, growthFrontier: true }); window.__originLab.fitRegion(gx - 3, gy - 3, gx + 3, gy + 3); }, [core.gx, core.gy]);
    b.screenshots.frontier = await shot('g03a-frontier-constraints-debug.png');
    // Boundary close-up: an inter-city shared edge if one exists, else the longest ecological boundary of a city.
    const adj = snap30.adjacencies[0];
    const chunks = await lab(() => window.__originLab.chunks());
    const focus = adj ? (() => { const a = chunks.find(c => c.chunkId === adj.chunks[0]); const c2 = chunks.find(c => c.chunkId === adj.chunks[1]); return { x: (a.worldOrigin.x + c2.worldOrigin.x) / 2, z: (a.worldOrigin.z + c2.worldOrigin.z) / 2, what: `${adj.cities.join(' | ')} ${adj.chunks.join(' | ')}` }; })() : { x: chunks[0].worldOrigin.x, z: chunks[0].worldOrigin.z, what: 'no inter-city edge; first core' };
    await lab(f => { window.__originLab.setLayers({ territory: true, boundaries: true, constraints: true, growthFrontier: false }); window.__originLab.focusPoint(f.x, f.z, 2600); }, focus);
    b.screenshots.boundary = await shot('g03a-boundary-closeup.png'); b.boundaryFocus = focus.what;
    await lab(() => { window.__originLab.setLayers({ territory: true, boundaries: false, constraints: false, relationships: true }); });
    await fitCells(); b.screenshots.relationships = await shot('g03a-city-relationships.png');
    // Save → reload → load: the saved analysis must be reproduced exactly.
    await lab(() => window.__originLab.saveLocal());
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await call(() => window.__originLab.loadLocal());
    assert((await lab(() => window.__originLab.territoryRestore())).startsWith('exact'), 'browser: territory not restored exactly');
    assert(json(await lab(() => window.__originLab.territorySnapshot())) === json(snap30), 'browser: restored analysis differs');
    b.restore = 'exact'; b.errors = errors; assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b; void node;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await mkdir(evidence, { recursive: true });
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G03a verification passed. Record: experiments/city-of-cities/evidence/city-territory.json');
