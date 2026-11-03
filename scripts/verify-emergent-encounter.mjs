// A City of Cities — G03c-01 Emergent Urban Encounter verifier.
// Part A (Node):
//   0. gate: the G02c-02 record (ramps continuous in XY, height and graph; save / load) must hold
//   1. real growth on seeds 6201 / 6202 / 6203 with the 6 % ramp plan and encounter detection, budget 60 steps
//      (milestones 12 / 30 / 60 recorded; a stall ends a run); every encounter checked against the world
//   2. detection on / off: identical growth; time per detection
//   3. determinism (registry order reversed), save → load → continue, encounter ids stable
//   4. UrbanEncounter.path reads parent, neighbour and cross-city joins, only valid ones
//   5. reference run without the ramp plan (G02c-01 joins, not continuous in height), 30 steps, labelled as such
//   6. seed search record (scripts/search-emergent-encounters.mjs), summarised
// Part B (browser): real captures of the encounter states.
// Usage: node --max-old-space-size=8192 scripts/verify-emergent-encounter.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { TerritoryModel } = await mod('experiments/city-of-cities/TerritoryModel.js');
const { UrbanEncounter } = await mod('experiments/city-of-cities/UrbanEncounter.js');
const { PROPOSAL, EMERGENT_RULES } = await mod('experiments/city-of-cities/EmergentEncounter.js');
const { CITY_IDS } = await mod('experiments/city-of-cities/originConfig.js');
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'emergent-encounter.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const strip = h => h.map(({ ms, failedAttempts, ...e }) => ({ ...e, failedAttempts: failedAttempts.map(({ cached, ...f }) => f) }));
const dist = (a, b) => Math.abs(a.worldCoordinate.gx - b.worldCoordinate.gx) + Math.abs(a.worldCoordinate.gy - b.worldCoordinate.gy);
const result = { task: 'G03c-01 Emergent Urban Encounter', testedAt: new Date().toISOString(), rules: EMERGENT_RULES, node: {}, browser: null };
if (browserOnly) result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;
// The seed search runs on its own; its latest record is read in either part.
const readSearch = async () => { try { const x = JSON.parse(await readFile(path.join(evidence, 'emergent-encounter-search.json'), 'utf8')); return { settings: x.settings, summary: x.summary ?? 'not finished', seeds: x.seeds.map(({ segments, ...r }) => ({ ...r, segments: segments?.map(g => ({ encounterId: g.encounterId, origin: g.origin, firstStep: g.firstStep, relationshipStatus: g.relationshipStatus })) })) }; } catch { return 'not run'; } };
if (browserOnly) result.node.search = await readSearch();

function newWorld(seed) {
  const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise();
  assert(!rep.failures.length, `seed ${seed}: placement failed`);
  for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
  return w;
}
function grow(w, g, n, { reverse = false, milestones = [] } = {}) {
  const t0 = Date.now(); const marks = {}; let stalled = null; const detectMs = [];
  for (let i = 0; i < n; i += 1) {
    if (reverse) w.chunks = new Map([...w.chunks].reverse());
    const r = g.step();
    if (r.stalled) { stalled = { step: r.stalled.step, reason: r.stalled.reason }; break; }
    if (r.event.ms.encounters !== undefined) detectMs.push(r.event.ms.encounters);
    if (milestones.includes(w.growth.step)) marks[w.growth.step] = snapshot(w);
  }
  return { ms: Date.now() - t0, stalled, marks, detectMs };
}
const snapshot = w => ({ step: w.growth.step, chunks: w.chunks.size, segments: (w.growth.encounters ?? []).map(s => ({ encounterId: s.encounterId, states: Object.entries(s.states).filter(([, v]) => v).map(([k]) => k), relationshipStatus: s.relationshipStatus })) });
// The verification list of the task, item by item, for every encounter of a world.
function checkEncounters(w, coresAtStart) {
  const t = TerritoryModel.build(w);
  const owned = new Map(); for (const tt of t.territories.values()) for (const id of tt.occupiedChunkIds) owned.set(id, tt.cityId);
  const occ = [...w.occupancy.values()]; assert(new Set(occ).size === occ.length && occ.length === w.chunks.size, 'duplicate occupation');
  for (const [id, sig] of coresAtStart) assert(json(w.chunks.get(id).outputs.signatures) === sig, `core ${id} changed`);
  const ids = w.growth.encounters.map(s => s.encounterId); assert(new Set(ids).size === ids.length, 'duplicate encounter ids');
  const items = { cityIds: 0, territory: 0, adjacency: 0, roadFronts: 0, roadPorts: 0, elevationTrace: 0, proposalNotConnected: 0 };
  for (const s of w.growth.encounters) {
    assert(CITY_IDS.includes(s.cityA) && CITY_IDS.includes(s.cityB) && s.cityA < s.cityB, `${s.encounterId}: city ids`); items.cityIds += 1;
    for (const id of s.involvedChunkIds) assert(w.chunks.has(id) && owned.get(id) === w.chunks.get(id).cityId && [s.cityA, s.cityB].includes(w.chunks.get(id).cityId), `${s.encounterId}: ${id} not in a territory of the pair`);
    items.territory += 1;
    // Adjacency again from the registry, independent of the tracker.
    const near = (city, others) => [...w.chunks.values()].filter(c => c.cityId === city && others.some(o => dist(c, o) <= EMERGENT_RULES.approachCells));
    const inv = s.involvedChunkIds.map(id => w.chunks.get(id));
    const A = near(s.cityA, inv.filter(c => c.cityId === s.cityB)); const B = near(s.cityB, inv.filter(c => c.cityId === s.cityA));
    const shared = []; for (const a of A) for (const b of B) if (dist(a, b) === 1) shared.push(`${a.chunkId}|${b.chunkId}`);
    assert(json(shared.sort()) === json(s.territoryBoundary.sharedEdges) && s.states.adjacent === shared.length > 0, `${s.encounterId}: adjacency not reproduced`); items.adjacency += 1;
    for (const f of s.relatedRoadFronts ?? []) if (f.growthFrontId) { const [, chunk, side, pos] = f.growthFrontId.split(':'); assert(w.chunks.get(chunk).outputs.ports[side].some(p => p.position === Number(pos)), `${s.encounterId}: front ${f.growthFrontId} is not a real port`); items.roadFronts += 1; }
    for (const e of s.edgeEvaluations.filter(x => x.evaluated)) for (const p of e.ports) {
      const port = w.chunks.get(p.chunkId).outputs.ports[p.side].find(q => q.position === p.position);
      assert(port && port.elevation === p.elevation, `${s.encounterId}: port ${p.connectionId} not real`); items.roadPorts += 1;
      if (p.elevationDifferenceM !== null) { const q = w.chunks.get(p.otherChunkId).outputs.ports[e.sideNewer].find(x => Math.abs(x.position - p.position) <= 0.05); assert(q && Math.abs(+(q.elevation - p.elevation).toFixed(2) - p.elevationDifferenceM) <= 0.011, `${s.encounterId}: height difference of ${p.connectionId} not traceable`); items.elevationTrace += 1; }
    }
    if (!s.states.connected) { assert(!/^verified/.test(s.validationStatus), `${s.encounterId}: proposal reported as connected`); items.proposalNotConnected += 1; }
    else { const p = new UrbanEncounter(w, null).path(s.cityA, s.cityB); assert(p.reachable && p.crossings > 0, `${s.encounterId}: connected without a path`); }
  }
  return items;
}
const tally = (list, key) => list.reduce((o, x) => { const k = key(x); o[k] = (o[k] ?? 0) + 1; return o; }, {});

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  // 0. Gate.
  const gate = JSON.parse(await readFile(path.join(evidence, 'grade-aware-growth.json'), 'utf8')).node;
  const g0 = gate.testB.checks;
  assert(g0.graphOk === g0.checked && g0.maxResidualM <= 0.05 && g0.maxXYM <= 0.05 && gate.stability.saveLoad.rampRecordsReproduced && gate.diagnosis.rows.length === 97, 'G02c-02 gate failed');
  result.node.gate = { g02c02: 'pass', joinsChecked: g0.checked, graphJoins: g0.graphOk, maxResidualM: g0.maxResidualM, maxXYM: g0.maxXYM, maxGrade: g0.maxGrade, saveLoad: gate.stability.saveLoad, seamDiagnosis: gate.diagnosis.seamIsTheStep, freeGrowthStalls: Object.fromEntries(Object.entries(gate.testC.free).map(([s, v]) => [s, v.baseline.events])) };
  console.log(`gate: G02c-02 pass (${g0.graphOk} of ${g0.checked} joins, residual ${g0.maxResidualM} m)`);
  // 1. Real growth.
  result.node.runs = {};
  for (const seed of [6201, 6202, 6203]) {
    const w = newWorld(seed); const cores = new Map([...w.chunks.values()].map(c => [c.chunkId, json(c.outputs.signatures)]));
    const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', encounters: true });
    const initial = snapshot(w);
    const r = grow(w, g, 60, { milestones: [12, 30, 60] });
    const items = checkEncounters(w, cores);
    const segs = w.growth.encounters;
    result.node.runs[seed] = {
      initial, milestones: r.marks, steps: w.growth.history.length, stalled: r.stalled, ms: r.ms, grown: Object.fromEntries(CITY_IDS.map(id => [id, w.growth.history.filter(e => e.cityId === id).length])),
      detection: { calls: r.detectMs.length, meanMs: r.detectMs.length ? Math.round(r.detectMs.reduce((a, b) => a + b, 0) / r.detectMs.length) : 0, maxMs: Math.max(0, ...r.detectMs) },
      checks: items,
      encounters: segs.map(s => ({ encounterId: s.encounterId, origin: s.origin, firstStep: s.firstStep, lastStep: s.growthStep, cities: [s.cityA, s.cityB], minDistanceCells: s.minDistanceCells, states: s.states, relationshipStatus: s.relationshipStatus, decisionReason: s.decisionReason, validationStatus: s.validationStatus, sharedEdges: s.territoryBoundary.sharedEdges, gapCells: s.territoryBoundary.gapCells, proposalCounts: s.proposalCounts, relatedGrowthEventIds: s.relatedGrowthEventIds, relatedRoadFronts: s.relatedRoadFronts, terrainConditions: s.terrainConditions, timeline: s.timeline, edgeEvaluations: s.edgeEvaluations.map(({ boundaryContext, ...e }) => e) })),
      counts: { segments: segs.length, emergedByGrowth: segs.filter(s => s.origin === 'growth').length, adjacent: segs.filter(s => s.states.adjacent).length, connectionCandidate: segs.filter(s => s.states.connectionCandidate).length, connected: segs.filter(s => s.states.connected).length, byDecision: tally(segs, s => s.relationshipStatus) },
    };
    if (seed === 6201) await writeFile(path.join(evidence, 'world-6201-g03c-state.json'), `${json(w.serialise())}\n`);
    console.log(`seed ${seed}: ${w.growth.history.length} steps${r.stalled ? ` (stalled at ${r.stalled.step})` : ''}, ${segs.length} encounter(s): ${segs.map(s => `${s.encounterId} [${s.origin}${s.origin === 'growth' ? ` step ${s.firstStep}` : ''}] ${Object.entries(s.states).filter(([, v]) => v).map(([k]) => k).join('+')} → ${s.relationshipStatus}`).join('; ')}; detection mean ${result.node.runs[seed].detection.meanMs} ms`);
  }
  // 2. Detection on / off: same growth.
  {
    const on = newWorld(6202); const gOn = new WorldGrowthController(on, { growthMode: 'road', gradeProfile: 'baseline', encounters: true }); const a = grow(on, gOn, 12);
    const off = newWorld(6202); const gOff = new WorldGrowthController(off, { growthMode: 'road', gradeProfile: 'baseline' }); const b = grow(off, gOff, 12);
    const plain = h => strip(h).map(({ encounterUpdates, ...e }) => e);
    assert(json(plain(on.growth.history)) === json(plain(off.growth.history)), 'detection changed the growth');
    result.node.detectionNeutral = { seed: 6202, steps: 12, identicalGrowth: true, msWith: a.ms, msWithout: b.ms, overheadShare: +((a.ms - b.ms) / b.ms).toFixed(3) };
    // 3. Determinism and save / load.
    const tw = newWorld(6202); const gt = new WorldGrowthController(tw, { growthMode: 'road', gradeProfile: 'baseline', encounters: true }); grow(tw, gt, 12, { reverse: true });
    assert(json(tw.growth.encounters) === json(on.growth.encounters) && json(plain(tw.growth.history)) === json(plain(on.growth.history)), 'encounters depend on the registry order');
    const half = newWorld(6202); const gh = new WorldGrowthController(half, { growthMode: 'road', gradeProfile: 'baseline', encounters: true }); grow(half, gh, 6);
    const saved = JSON.parse(json(half.serialise()));
    const back = WorldContext.restore(saved);
    for (const c of [...back.chunks.values()].sort((x, y) => x.growthStep - y.growthStep)) { const { chunk } = back.generateChunk(c.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `restored ${c.chunkId} differs`); }
    assert(json(back.growth.encounters) === json(half.growth.encounters), 'encounters not restored');
    const gb = new WorldGrowthController(back); assert(gb.encounters, 'load lost encounter detection');
    grow(back, gb, 6);
    assert(json(back.growth.encounters) === json(on.growth.encounters) && json(plain(back.growth.history)) === json(plain(on.growth.history)), 'save / load / continue differs');
    result.node.stability = { registryOrderReversed: 'identical encounters and growth (seed 6202, 12 steps)', saveLoad: { savedAtStep: 6, encountersRestored: half.growth.encounters.length, continuedEqualsUninterrupted: true, encounterIdsStable: true } };
    console.log(`detection neutral (${a.ms} vs ${b.ms} ms); determinism and save / load pass`);
    // 4. Path joins.
    const ue = new UrbanEncounter(on, null);
    const p = ue.path('chicagoGrid', 'manhattanGrid');
    const expected = on.growth.history.filter(e => ['chicagoGrid', 'manhattanGrid'].includes(e.cityId)).reduce((s, e) => s + e.connections.length + (e.neighbourConnections?.length ?? 0), 0);
    assert(p.joinsUsed === expected && !p.invalidJoins.length && !p.reachable, `path joins ${p.joinsUsed} vs ${expected}`);
    result.node.path = { seed: 6202, cities: ['chicagoGrid', 'manhattanGrid'], joinsRecorded: expected, joinsUsed: p.joinsUsed, invalidJoins: p.invalidJoins.length, reachable: p.reachable, note: 'parent and neighbour joins enter the graph; no cross-city join exists, so no path' };
  }
  // 5. Reference run without ramp plan.
  result.node.reference = {};
  for (const seed of [6201, 6202, 6203]) {
    const w = newWorld(seed); const g = new WorldGrowthController(w, { growthMode: 'road', encounters: true }); const r = grow(w, g, 30, { milestones: [12, 30] });
    const segs = w.growth.encounters;
    result.node.reference[seed] = { mode: 'G02c-01 joins (height steps up to 3 m, not continuous); reference only', steps: w.growth.history.length, stalled: r.stalled, ms: r.ms, milestones: r.marks, encounters: segs.map(s => ({ encounterId: s.encounterId, origin: s.origin, firstStep: s.firstStep, states: s.states, relationshipStatus: s.relationshipStatus, proposalCounts: s.proposalCounts, sharedEdges: s.territoryBoundary.sharedEdges, edgeEvaluations: s.edgeEvaluations.map(({ boundaryContext, ...e }) => e) })) };
    console.log(`reference ${seed}: ${w.growth.history.length} steps, ${segs.map(s => `${s.encounterId} ${Object.entries(s.states).filter(([, v]) => v).map(([k]) => k).join('+')} → ${s.relationshipStatus}`).join('; ')}`);
  }
  // 6. Seed search.
  result.node.search = await readSearch();
  result.nodeMs = Date.now() - started;
  await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4220; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
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
    const shot = async name => { await page.waitForTimeout(900); const f = path.join(shots, name); await page.locator('#worldCanvas').screenshot({ path: f }); return path.relative(root, f).replaceAll('\\', '/'); };
    const fitCells = async ids => { const cs = (await lab(() => window.__originLab.chunks())).filter(c => ids.includes(c.chunkId)).map(c => c.worldCoordinate); await lab(b => window.__originLab.fitRegion(...b), [Math.min(...cs.map(c => c.gx)) - 1, Math.min(...cs.map(c => c.gy)) - 1, Math.max(...cs.map(c => c.gx)) + 1, Math.max(...cs.map(c => c.gy)) + 1]); };
    const enc = { encBoundary: true, encPorts: true, encLabels: true };
    const b = { screenshots: {}, captions: {} };
    // Seed 6201: origins, then real growth to its end.
    const R = result.node.runs[6201];
    await page.goto(`${base}${entry}?start=0&growthMode=road&grade=baseline&emergent=1`, { waitUntil: 'networkidle' }); await waitReady();
    await lab(() => window.__originLab.setAutoFit(false));
    await call(x => window.__originLab.generate(x), 6201);
    await lab(l => window.__originLab.setLayers(l), enc); await lab(() => window.__originLab.overview('top'));
    b.screenshots.origins = await shot('g03c-01-seed6201-origins.png'); b.captions.origins = 'seed 6201, step 0, six cores; layers: encounter boundary / proposals / states; camera: overview top';
    await call(n => window.__originLab.growSteps(n), R.steps);
    const pageEnc = await lab(() => window.__originLab.emergentEncounters().map(s => [s.encounterId, s.relationshipStatus, s.states]));
    assert(json(pageEnc) === json(R.encounters.map(s => [s.encounterId, s.relationshipStatus, s.states])), 'browser encounters differ from Node');
    await lab(() => window.__originLab.overview('top'));
    b.screenshots.grown = await shot('g03c-01-seed6201-grown.png'); b.captions.grown = `seed 6201, step ${R.steps}${R.stalled ? ' (stalled)' : ''}; same layers; overview top`;
    const growthEnc = R.encounters.find(s => s.origin === 'growth');
    if (growthEnc) {
      const pair = await lab(id => window.__originLab.emergentEncounters().find(s => s.encounterId === id).territoryBoundary.closestPair, growthEnc.encounterId);
      await fitCells(growthEnc.sharedEdges.length ? growthEnc.sharedEdges.flatMap(k => k.split('|')) : pair);
      b.screenshots.local = await shot('g03c-01-seed6201-encounter-local.png'); b.captions.local = `${growthEnc.encounterId}, ${Object.entries(growthEnc.states).filter(([, v]) => v).map(([k]) => k).join(' + ')}, ${growthEnc.relationshipStatus}`;
      await lab(l => window.__originLab.setLayers(l), { encBoundary: false, encPorts: false, encLabels: false, chunkBorders: false, ownership: false });
      b.screenshots.noBorders = await shot('g03c-01-seed6201-encounter-no-borders.png'); b.captions.noBorders = 'same camera, all debug layers and chunk borders hidden';
    }
    // Save → reload → load: the encounters come back.
    await lab(() => window.__originLab.saveLocal());
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await call(() => window.__originLab.loadLocal());
    assert(json(await lab(() => window.__originLab.emergentEncounters().map(s => [s.encounterId, s.relationshipStatus]))) === json(R.encounters.map(s => [s.encounterId, s.relationshipStatus])), 'browser load lost encounters');
    // An adjacency found by growth (seed search state or a run), if any, with its road ends.
    const adjacentRun = Object.entries(result.node.runs).find(([, r]) => r.encounters.some(s => s.states.adjacent && s.origin === 'growth'));
    const searchState = result.node.search?.summary?.firstSavedState ?? null;
    if (adjacentRun || searchState) {
      const saved = adjacentRun ? null : JSON.parse(await readFile(path.join(evidence, searchState), 'utf8'));
      if (saved) { await page.evaluate(s => { localStorage.setItem('procedural-mini-world/a-city-of-cities/world-state', JSON.stringify(s)); }, saved); await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady(); await call(() => window.__originLab.loadLocal()); }
      else { await page.goto(`${base}${entry}?start=0&growthMode=road&grade=baseline&emergent=1`, { waitUntil: 'networkidle' }); await waitReady(); await lab(() => window.__originLab.setAutoFit(false)); await call(x => window.__originLab.generate(x), Number(adjacentRun[0])); await call(n => window.__originLab.growSteps(n), adjacentRun[1].steps); }
      const seg = (await lab(() => window.__originLab.emergentEncounters())).find(s => s.states.adjacent && s.origin === 'growth');
      await lab(l => window.__originLab.setLayers(l), { ...enc, rampAccepted: true, chunkBorders: true, ownership: true });
      await fitCells(seg.territoryBoundary.sharedEdges.flatMap(k => k.split('|')));
      b.screenshots.adjacent = await shot('g03c-01-adjacent-road-proposals.png'); b.captions.adjacent = `world seed ${saved ? saved.worldSeed : adjacentRun[0]}, step ${seg.growthStep}, ${seg.encounterId}: ${seg.relationshipStatus}; ${json(seg.proposalCounts)}`;
    }
    b.errors = errors; assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G03c-01 verification passed. Record: experiments/city-of-cities/evidence/emergent-encounter.json');
