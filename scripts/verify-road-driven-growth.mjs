// A City of Cities — G02c-01 Road-Driven Growth Integration verifier.
// Part A (Node):
//   0. regression: G01 cores and the default G02 path equal the saved 30-step state (the released film depends on them);
//   1. Test A, one city through the scheduler: Chicago (seed 6202), Manhattan (seed 6201), two steps each;
//   2. Test B, six cities, 12 real steps on seeds 6201 / 6202 / 6203: every event from a real port, graph reach, occupancy,
//      stability, crossings, morphology; final state of each city, including those with no valid road front;
//   3. reproducibility: twin run with the chunk registry order reversed before each step;
//   4. save after step 6 → load → signatures, joins → continue = uninterrupted run;
//   5. failure handling: generator error and failed validation leave no chunk; natural failures are counted by class.
// Part B (browser): the page reproduces the Node events; save → reload → load → continue; screenshots.
// Usage: node --max-old-space-size=8192 scripts/verify-road-driven-growth.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { MorphologicalGrowth, verifyConnections } = await mod('experiments/city-of-cities/MorphologicalGrowth.js');
const { FAILURE, cityRoadReach, roadCrossings } = await mod('experiments/city-of-cities/RoadGrowthFrontAdapter.js');
const { TerritoryModel } = await mod('experiments/city-of-cities/TerritoryModel.js');
const { CITY_IDS } = await mod('experiments/city-of-cities/originConfig.js');
const SEEDS = [6201, 6202, 6203]; const STEPS = 12;
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'road-driven-growth.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const strip = h => h.map(({ ms, ...e }) => e);
const mod90 = x => ((x % 90) + 90) % 90;
const angle90 = (a, b) => { const d = Math.abs(mod90(a) - mod90(b)); return +Math.min(d, 90 - d).toFixed(2); };
const result = { task: 'G02c-01 Road-Driven Growth Integration', testedAt: new Date().toISOString(), node: {}, browser: null };
if (browserOnly) result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;

function newWorld(seed) {
  const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise();
  assert(!rep.failures.length, `seed ${seed}: placement failed`);
  for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
  return w;
}
const reverseRegistry = w => { w.chunks = new Map([...w.chunks].reverse()); };
function gridPhaseError(parent, child) {
  const p = parent.outputs.grid; const c = child.outputs.grid; if (!p || !c) return null;
  const t = (p.axisDeg * Math.PI) / 180; const u = { x: Math.cos(t), z: Math.sin(t) }; const v = { x: -u.z, z: u.x };
  const m = (a, n) => ((a % n) + n) % n;
  const dA = m(c.phaseA - p.phaseA - ((p.originX - c.originX) * v.x + (p.originZ - c.originZ) * v.z), p.primarySpacing);
  const dB = m(c.phaseB - p.phaseB - ((p.originX - c.originX) * u.x + (p.originZ - c.originZ) * u.z), p.secondarySpacing);
  return { axisDiffDeg: Math.abs(c.axisDeg - p.axisDeg), phaseErrorM: +Math.max(Math.min(dA, p.primarySpacing - dA), Math.min(dB, p.secondarySpacing - dB)).toFixed(6), inherited: c.inherited };
}
// Checks one committed event against the world; returns its measured record.
function checkEvent(w, r, stable) {
  const e = r.event; const child = w.chunks.get(e.newChunkId); const parent = w.chunks.get(e.parentChunkId);
  const label = `step ${e.step} ${e.newChunkId}`;
  assert(e.scheduler === 'g02c-01' && child.cityId === e.cityId && parent.cityId === e.cityId, `${label}: city identity`);
  assert(e.connections.length > 0, `${label}: no road continued`);
  const rc = e.roadCandidate;
  for (const k of ['cityId', 'sourceChunkId', 'sourceRoadId', 'growthFrontId', 'targetChunkCoordinate', 'roadClass', 'roadDirection', 'roadElevation', 'terrainConstraints', 'inheritedMorphology', 'candidateScore']) assert(rc[k] !== undefined && rc[k] !== null, `${label}: candidate lacks ${k}`);
  const [, frontChunk, frontSide, frontPos] = rc.growthFrontId.split(':');
  const realPort = w.chunks.get(frontChunk).outputs.ports[frontSide].find(p => p.position === Number(frontPos));
  assert(frontChunk === parent.chunkId && realPort && `${frontChunk}:e${realPort.edgeId}` === rc.sourceRoadId && realPort.elevation === rc.roadElevation, `${label}: growth front is not a real port`);
  const dirs = []; const classes = { same: 0, different: 0 };
  for (const c of [...e.connections, ...e.neighbourConnections]) {
    const a = w.chunks.get(c.parent.chunkId); const b = w.chunks.get(c.child.chunkId);
    const side = c.connectionId.split(':')[2];
    const pa = a.outputs.ports[side].find(p => p.nodeId === c.parent.nodeId && p.edgeId === c.parent.edgeId);
    const pb = b.outputs.ports[{ minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' }[side]].find(p => p.nodeId === c.child.nodeId && p.edgeId === c.child.edgeId);
    assert(pa && pb, `${label}: join ${c.connectionId} names no real port`);
    assert(a.outputs.roadGraph.some(([f, t]) => f === c.parent.nodeId || t === c.parent.nodeId) && b.outputs.roadGraph.some(([f, t]) => f === c.child.nodeId || t === c.child.nodeId), `${label}: join outside the road graphs`);
    assert(c.positionErrorM <= 0.5, `${label}: position error`);
    // Both port directions point out of their chunk, so a road running straight through differs by exactly 180°.
    const turn = (pa.directionDeg - pb.directionDeg + 540) % 360;
    dirs.push(+Math.min(turn, 360 - turn).toFixed(1));
    if (pa.roadClass === pb.roadClass) classes.same += 1; else classes.different += 1;
  }
  for (const [id, sig] of stable) assert(json(w.chunks.get(id).outputs.signatures) === sig, `${label}: ${id} changed`);
  stable.set(child.chunkId, json(child.outputs.signatures));
  assert(w.occupancy.get(`${child.worldCoordinate.gx},${child.worldCoordinate.gy}`) === child.chunkId, `${label}: occupancy`);
  const crossings = roadCrossings(r.layers.city.network);
  assert(crossings === 0, `${label}: ${crossings} crossings`);
  const steps = e.connections.map(c => Math.abs(c.elevationStepM));
  const nb = e.neighbourConnections.map(c => Math.abs(c.elevationStepM));
  const m = e.morphology; const ratio = (a, b) => (a && b ? +(b / a).toFixed(3) : null);
  return {
    step: e.step, cityId: e.cityId, front: rc.growthFrontId, sourceRoadId: rc.sourceRoadId, roadClass: rc.roadClass, parent: e.parentChunkId, child: e.newChunkId, generation: e.generation, landform: child.terrainType, score: rc.candidateScore, joins: e.connections.length, neighbourJoins: e.neighbourConnections.length, neighbourUnjoined: e.neighbourUnjoined.length,
    unmatchedEntries: e.localAdaptations.unmatchedEntries.length, refusedEntries: rc.terrainConstraints.refusedEntries, positionErrorMaxM: Math.max(...e.connections.map(c => c.positionErrorM)), heightStepMaxM: Math.max(...steps), neighbourHeightStepMaxM: nb.length ? Math.max(...nb) : null,
    classKept: classes, directionDiffMaxDeg: Math.max(...dirs), crossings, grid: gridPhaseError(parent, child),
    counts: child.outputs.counts,
    morphology: { orientationDiffDeg: angle90(m.parent.dominantOrientationDeg, m.child.dominantOrientationDeg), roadDensityRatio: ratio(m.parent.roadDensityKmPerKm2, m.child.roadDensityKmPerKm2), blockMedianRatio: ratio(m.parent.blockAreaMedianM2, m.child.blockAreaMedianM2), frontageRatio: ratio(m.parent.parcelFrontageMedianM, m.child.parcelFrontageMedianM), coverageRatio: ratio(m.parent.buildingCoverage, m.child.buildingCoverage), heightMeanRatio: ratio(m.parent.heightMeanM, m.child.heightMeanM), heightMaxRatio: ratio(m.parent.heightMaxM, m.child.heightMaxM), centreSource: m.centreSource },
    failedAttempts: e.failedAttempts.map(f => ({ candidateId: f.candidateId, failureClass: f.failureClass, reason: f.reason })),
  };
}
function runSteps(w, g, n, { reverse = false } = {}) {
  const stable = new Map([...w.chunks.values()].map(c => [c.chunkId, json(c.outputs.signatures)]));
  const events = [];
  for (let i = 0; i < n; i += 1) {
    if (reverse) reverseRegistry(w);
    const r = g.step();
    if (r.stalled) { events.stalled = r.stalled; break; }
    events.push(checkEvent(w, r, stable));
  }
  return events;
}
const classify = reason => (/^occupied/.test(reason) ? 'occupied' : /waterfront growth mode/.test(reason) ? 'waterfront mode not implemented' : /no road port/.test(reason) ? 'no road front on that side' : /no road entry/.test(reason) ? 'road ends off the target terrain (> 3 m)' : /slope barrier/.test(reason) ? 'slope barrier' : /incompatible/.test(reason) ? 'landform incompatible' : /noContinuousLand|DNA conflict/.test(reason) ? 'DNA terrain conflict' : 'other');
function cityStates(w, g) {
  const frontier = g.evaluate(w.growth.step + 1);
  return Object.fromEntries(CITY_IDS.map(id => {
    const list = frontier[id]; const reach = cityRoadReach(w, id);
    const reasons = {}; const classes = {};
    for (const c of list.filter(x => x.status === 'rejected')) { const k = classify(c.rejectionReason); reasons[k] = (reasons[k] ?? 0) + 1; classes[c.failureClass] = (classes[c.failureClass] ?? 0) + 1; }
    return [id, { chunks: reach.chunks, grown: w.growth.history.filter(e => e.cityId === id).length, eligibleNow: list.filter(x => x.status === 'eligible').length, refusedNow: reasons, failureClasses: classes, reachableChunks: reach.reachableChunks, minRoadShareOnCoreNetwork: Math.min(...Object.values(reach.perChunk).map(x => x.roadLengthShareOnCoreNetwork)), farthestFromCoreM: Math.max(0, ...Object.values(reach.perChunk).map(x => x.farthestNodeFromCoreM ?? 0)) }];
  }));
}

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  // 0. Regression of the default path.
  {
    const saved = JSON.parse(await readFile(path.join(evidence, 'world-6201-g02-step30-state.json'), 'utf8'));
    const w = newWorld(6201); const g = new WorldGrowthController(w);
    assert(g.growthMode === 'chunk' && !('mode' in w.growth), 'default mode changed');
    const rs = g.grow(30);
    assert(rs.length === 30 && !rs.at(-1).stalled, 'G02: 30 steps expected');
    for (const c of saved.chunks) assert(json(w.chunks.get(c.chunkId)?.outputs.signatures) === json(c.expectedSignatures), `G02 chunk ${c.chunkId} changed`);
    assert(json(w.growth.history.map(e => e.newChunkId)) === json(saved.growth.history.map(e => e.newChunkId)), 'G02 order changed');
    result.node.regression = { g02StepsCompared: 30, chunksIdentical: saved.chunks.length, orderIdentical: true };
    console.log(`regression: default G02 path equals the saved 30-step state (${saved.chunks.length} chunks)`);
  }
  // 1. Test A.
  result.node.testA = {};
  for (const [cityId, seed] of [['chicagoGrid', 6202], ['manhattanGrid', 6201]]) {
    const w = newWorld(seed); const g = new WorldGrowthController(w, { growthMode: 'road', cities: [cityId] });
    const core = w.cities.get(cityId).originChunkId;
    const events = runSteps(w, g, 2);
    assert(events.length === 2, `Test A ${cityId}: expected 2 steps`);
    const m = new MorphologicalGrowth(w);
    const baselines = events.map(e => { const hist = w.growth.history.find(x => x.newChunkId === e.child); return { child: e.child, ...m.independentBaseline(cityId, hist.targetCoordinate.gx, hist.targetCoordinate.gy, hist.parentChunkId, hist.sourceGrowthFrontId.split(':')[2]) }; });
    const reach = cityRoadReach(w, cityId);
    assert(reach.reachableChunks === 3, `Test A ${cityId}: graph does not reach every chunk`);
    for (const c of [...w.chunks.values()].filter(x => x.cityId !== cityId)) assert(c.role === 'core', 'Test A: another city grew');
    result.node.testA[cityId] = { seed, core, events, reach, independent: baselines.map(b => ({ child: b.child, parentPorts: b.parentPorts, alignedWithin05m: b.alignedWithin05m })), metrics: [core, ...events.map(e => e.child)].map(id => { const c = w.chunks.get(id); return { chunkId: id, role: c.role, landform: c.terrainType, ...c.outputs.morph, counts: c.outputs.counts, centreSource: c.outputs.centreSource }; }) };
    console.log(`Test A ${cityId} seed ${seed}: ${events.map(e => `${e.parent} → ${e.child} (${e.joins} joins, ${e.heightStepMaxM} m)`).join('; ')}; graph ${reach.reachableChunks}/3 chunks; independent aligned ${baselines.map(b => `${b.alignedWithin05m}/${b.parentPorts}`).join(', ')}`);
  }
  // 2. Test B.
  result.node.testB = {};
  let keep = null;
  for (const seed of SEEDS) {
    const w = newWorld(seed); const g = new WorldGrowthController(w, { growthMode: 'road' });
    const events = runSteps(w, g, STEPS);
    const unique = new Set([...w.occupancy.values()]);
    assert(unique.size === w.occupancy.size && w.occupancy.size === w.chunks.size, `seed ${seed}: duplicate occupation`);
    const states = cityStates(w, g);
    for (const [id, s] of Object.entries(states)) assert(s.reachableChunks === s.chunks || s.grown === 0, `seed ${seed}: ${id} has an unreachable grown chunk`);
    const t = TerritoryModel.build(w); t.refresh(g);
    assert(t.derived.metrics.totalChunks === w.chunks.size, 'territory disagrees');
    const conflicts = w.growth.history.flatMap(e => e.conflicts);
    result.node.testB[seed] = {
      steps: events.length, stalled: events.stalled ?? null, events, cityStates: states, attempts: w.growth.roadAttempts,
      totals: { chunks: w.chunks.size, joins: events.reduce((s, e) => s + e.joins, 0), neighbourJoins: events.reduce((s, e) => s + e.neighbourJoins, 0), neighbourUnjoined: events.reduce((s, e) => s + e.neighbourUnjoined, 0), maxHeightStepM: Math.max(...events.map(e => e.heightStepMaxM)), maxDirectionDiffDeg: Math.max(...events.map(e => e.directionDiffMaxDeg)), crossings: events.reduce((s, e) => s + e.crossings, 0), interCityContacts: conflicts.filter(c => !c.sameCity).length, generation2Plus: events.filter(e => e.generation >= 2).length },
    };
    console.log(`Test B seed ${seed}: ${events.length} steps; grown ${json(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.grown])))}; failed attempts ${w.growth.roadAttempts.length}; max step ${result.node.testB[seed].totals.maxHeightStepM} m`);
    if (seed === 6202) { keep = json(strip(w.growth.history)); await writeFile(path.join(evidence, 'world-6202-g02c-step12-state.json'), `${json(w.serialise())}\n`); }
  }
  // 3. Reproducibility, with the registry order reversed before every step.
  {
    const w = newWorld(6202); const g = new WorldGrowthController(w, { growthMode: 'road' });
    runSteps(w, g, STEPS, { reverse: true });
    assert(json(strip(w.growth.history)) === keep, 'history depends on the registry order');
    result.node.reproducible = { seed: 6202, steps: STEPS, registryOrderReversed: true, identical: true };
    console.log('reproducibility: identical with the registry order reversed before every step');
  }
  // 4. Save → load → continue.
  {
    const a = newWorld(6202); const ga = new WorldGrowthController(a, { growthMode: 'road' }); runSteps(a, ga, 6);
    const saved = JSON.parse(json(a.serialise()));
    assert(saved.growth.mode === 'road', 'mode not saved');
    const b = WorldContext.restore(saved);
    for (const c of [...b.chunks.values()].sort((x, y) => x.growthStep - y.growthStep)) { const { chunk } = b.generateChunk(c.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `restored ${c.chunkId} differs`); }
    const vc = verifyConnections(b);
    assert(vc.length === 6 && vc.every(x => x.same), `restored joins differ ${json(vc)}`);
    const gb = new WorldGrowthController(b);
    assert(gb.growthMode === 'road', 'load did not restore the mode');
    const continued = runSteps(b, gb, STEPS - 6);
    assert(json(strip(b.growth.history)) === keep, 'save / load / continue differs from the uninterrupted run');
    result.node.saveLoad = { seed: 6202, savedAtStep: 6, chunksRegeneratedWithSavedSignatures: saved.chunks.length, joinEventsReproduced: vc.length, continuedSteps: continued.length, identicalToUninterrupted: true };
    console.log(`save / load: ${saved.chunks.length} chunks reproduced, ${vc.length} join events reproduced, ${continued.length} further steps equal the uninterrupted run`);
  }
  // 5. Failure handling.
  {
    const w = newWorld(6202); const g = new WorldGrowthController(w, { growthMode: 'road' });
    const original = w.generateChunk.bind(w); let thrown = 0;
    w.generateChunk = id => { if (w.chunks.get(id).role === 'growth' && !thrown) { thrown += 1; throw new Error('injected'); } return original(id); };
    const sizeBefore = w.chunks.size;
    const r = g.step(); w.generateChunk = original;
    const first = r.event.failedAttempts[0];
    assert(first?.failureClass === FAILURE.generation && w.chunks.size === sizeBefore + 1 && !w.chunks.has(`c_${first.candidateId.split(':')[2]}_${first.candidateId.split(':')[3]}`) && !w.occupancy.has(`${first.candidateId.split(':')[2]},${first.candidateId.split(':')[3]}`), 'generator error left state behind');
    assert(r.event.step === 1 && w.growth.history.length === 1, 'failed attempt entered the history');
    const v = newWorld(6202); const gv = new WorldGrowthController(v, { growthMode: 'road' });
    gv.adapter.validate = () => ({ failureClass: FAILURE.network, reason: 'injected' });
    const size = v.chunks.size; const rv = gv.step();
    assert(rv.stalled?.failureClass === FAILURE.stalled && v.chunks.size === size && v.occupancy.size === size && v.growth.step === 0 && v.growth.history.length === 0, 'stall left state behind');
    const natural = Object.fromEntries(SEEDS.map(s => [s, result.node.testB[s].attempts.map(a => ({ step: a.step, candidateId: a.candidateId, failureClass: a.failureClass, reason: a.reason }))]));
    result.node.failure = { generatorError: { failedCandidate: first.candidateId, failureClass: first.failureClass, grewInstead: r.event.newChunkId, leftNoChunk: true }, allValidationFail: { failureClass: rv.stalled.failureClass, attempts: rv.stalled.attempts.length, chunksUnchanged: true }, natural };
    console.log(`failure: generator error → ${r.event.newChunkId} instead of ${first.candidateId}; all candidates refused → stalled after ${rv.stalled.attempts.length} attempts, no chunk`);
  }
  result.nodeMs = Date.now() - started;
  await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4218; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
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
    const fit = async ids => { const cs = (await lab(() => window.__originLab.chunks())).filter(c => ids.includes(c.chunkId)).map(c => c.worldCoordinate); await lab(b => window.__originLab.fitRegion(...b), [Math.min(...cs.map(c => c.gx)), Math.min(...cs.map(c => c.gy)), Math.max(...cs.map(c => c.gx)), Math.max(...cs.map(c => c.gy))]); };
    const off = { morphFronts: false, inheritedRoads: false, connectivity: false, growthFrontier: false, history: false, chunkBorders: true, ownership: true };
    const b = { screenshots: {} };
    // Test A in the page: Chicago, seed 6202.
    const A = result.node.testA.chicagoGrid; const [e1, e2] = A.events;
    await page.goto(`${base}${entry}?start=0&growthMode=road`, { waitUntil: 'networkidle' }); await waitReady();
    await call(x => window.__originLab.generate(x), A.seed);
    await lab(() => window.__originLab.roadCities(['chicagoGrid']));
    await lab(l => window.__originLab.setLayers(l), off);
    await fit([A.core]); b.screenshots.core = await shot('g02c-01-chicago-core-before.png');
    await lab(() => { window.__originLab.setLayers({ morphCity: 'chicagoGrid', morphFronts: true, growthFrontier: true }); window.__originLab.select('chicagoGrid'); });
    await lab(b0 => window.__originLab.fitRegion(...b0), await lab(id => { const c = window.__originLab.chunks().find(x => x.chunkId === id).worldCoordinate; return [c.gx - 1, c.gy - 1, c.gx + 1, c.gy + 1]; }, A.core));
    b.screenshots.fronts = await shot('g02c-01-road-fronts-debug.png');
    await lab(l => window.__originLab.setLayers(l), off);
    await call(() => window.__originLab.growSteps(1));
    await lab(() => window.__originLab.setLayers({ inheritedRoads: true, connectivity: true, history: true }));
    await fit([e1.parent, e1.child]); b.screenshots.first = await shot('g02c-01-first-growth-after.png');
    const chunks = await lab(() => window.__originLab.chunks());
    const pa = chunks.find(c => c.chunkId === e1.parent); const ch = chunks.find(c => c.chunkId === e1.child);
    await lab(f => window.__originLab.focusPoint(f.x, f.z, 850), { x: (pa.worldOrigin.x + ch.worldOrigin.x) / 2, z: (pa.worldOrigin.z + ch.worldOrigin.z) / 2 });
    b.screenshots.boundary = await shot('g02c-01-boundary-closeup-debug.png');
    await lab(l => window.__originLab.setLayers(l), off);
    await call(() => window.__originLab.growSteps(1));
    const pageA = await lab(() => window.__originLab.history().map(e => [e.newChunkId, e.connections.length]));
    assert(json(pageA) === json(A.events.map(e => [e.child, e.joins])), `browser Test A differs ${json(pageA)}`);
    await lab(() => window.__originLab.setLayers({ chunkBorders: false, ownership: false }));
    await fit([A.core, e1.child, e2.child]); b.screenshots.noBorders = await shot('g02c-01-chicago-no-borders-after.png');
    // Test B in the page: six cities, seed 6202.
    const B = result.node.testB[6202];
    await page.goto(`${base}${entry}?start=0&growthMode=road`, { waitUntil: 'networkidle' }); await waitReady();
    await lab(() => window.__originLab.setAutoFit(false));
    await call(x => window.__originLab.generate(x), 6202);
    await call(() => window.__originLab.growSteps(6));
    await lab(() => window.__originLab.saveLocal());
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await lab(() => window.__originLab.setAutoFit(false));
    await call(() => window.__originLab.loadLocal());
    assert(/reproduced/.test(await lab(() => window.__originLab.morphRestore())), 'browser: joins not reproduced after load');
    assert(!(await lab(() => window.__originLab.mismatches())).length, 'browser: signatures differ after load');
    await call(() => window.__originLab.growSteps(6));
    const pageB = await lab(() => window.__originLab.history().map(e => [e.step, e.cityId, e.newChunkId, e.connections.length, e.neighbourConnections.length]));
    assert(json(pageB) === json(B.events.map(e => [e.step, e.cityId, e.child, e.joins, e.neighbourJoins])), 'browser Test B differs from Node');
    await lab(l => window.__originLab.setLayers(l), { ...off, history: true, growthFrontier: false });
    await lab(() => window.__originLab.overview('top'));
    b.screenshots.world = await shot('g02c-01-six-city-scheduler-after.png');
    b.pageEqualsNode = true; b.saveReloadLoadContinue = true; b.errors = errors;
    assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G02c-01 verification passed. Record: experiments/city-of-cities/evidence/road-driven-growth.json');
