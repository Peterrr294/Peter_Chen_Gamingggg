// A City of Cities — G03c-02 Inter-City Road Connection verifier.
// Part A (Node):
//   0. gate: G02c-02 and G03c-01 records
//   1. Test A, controlled (TEST ONLY, cores placed by hand as in G03b): four scenarios under the scheduler's rule (a grown
//      chunk must join a parent road); then a construction check with that rule off, which shows what the planner builds
//      and that a join without a core-to-core path is not Connected; save / load of that world
//   2. Test B, natural: seeds 6202 / 6209 / 6215 regrown with inter-city connection on (the adjacencies of G03c-01 and the
//      seed search); every interface and cross-city ramp outcome; growth compared with the run without it
//   3. determinism and save / load with inter-city connection on
//   4. regressions touched by this task: G02c-02 replay statuses, G03c-01 encounters (snap tolerance, path)
// Part B (browser): seed 6202 at the encounter with the inter-city layers; long section of the controlled cross-city ramp.
// Usage: node --max-old-space-size=8192 scripts/verify-inter-city-connection.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { MorphologicalGrowth, verifyConnections, portPoint } = await mod('experiments/city-of-cities/MorphologicalGrowth.js');
const { UrbanEncounter } = await mod('experiments/city-of-cities/UrbanEncounter.js');
const { INTERCITY_RULES, interCityPlan, connectionRecords } = await mod('experiments/city-of-cities/InterCityConnectionPlanner.js');
const { RAMP_RULES, RAMP_STATUS: S } = await mod('experiments/city-of-cities/RoadRampPlanner.js');
const { ENCOUNTER_FIXTURES, createFixtureWorld } = await mod('experiments/city-of-cities/encounterFixture.js');
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'inter-city-connection.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const strip = h => h.map(({ ms, failedAttempts, encounterUpdates, ...e }) => ({ ...e, failedAttempts: failedAttempts.map(({ cached, ...f }) => f) }));
const result = { task: 'G03c-02 Inter-City Road Connection', testedAt: new Date().toISOString(), rules: { interCity: INTERCITY_RULES, ramp: RAMP_RULES }, node: {}, browser: null };
if (browserOnly) result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;
// TEST ONLY scenario of this task: Fez grows west twice and reaches the Chicago core (same hand-placed row as G03b 1 and 2).
const SCENARIOS = { ...ENCOUNTER_FIXTURES, rampConnection: { title: 'Ramp connection (G03c-02, test only)', worldSeed: 6201, row: ENCOUNTER_FIXTURES.compatible.row, steps: [['fezOrganicCore', 2], ['fezOrganicCore', 1]] } };

function newWorld(seed) {
  const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise();
  assert(!rep.failures.length, `seed ${seed}: placement failed`);
  for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
  return w;
}
function fixtureWorld(name) {
  const w = name in ENCOUNTER_FIXTURES ? createFixtureWorld(name) : (() => { const x = createFixtureWorld('compatible'); x.fixture = name; return x; })();
  for (const id of [...w.chunks.keys()]) w.generateChunk(id);
  return w;
}
// One controlled step: the newcomer reads the other city's road ends, then the chain runs with the 6 % ramp plan.
function controlledStep(w, m, cityId, target, schedulerRule) {
  const ic = interCityPlan(w, m, cityId, target);
  const r = m.grow(cityId, { target, vertical: 'baseline', interCityPlan: ic });
  if (r.failure) { w.growth.step += 1; return { cityId, target, grown: false, reason: r.failure.reason }; }
  const e = r.event; const cross = e.ramps.filter(x => x.kind === 'crossCity');
  const out = { cityId, target, chunk: e.newChunkId, parentJoins: e.connections.length, crossJoins: (e.crossCityConnections ?? []).length, interfaces: ic.edges.flatMap(x => x.interfaces.map(i => ({ connectionId: i.connectionId, stepM: i.stepM, crossingDeg: i.crossingDeg, accepted: i.accepted, reason: i.reasons[0] ?? null }))), crossRamps: cross.map(({ profile, ...x }) => x) };
  if (schedulerRule && !e.connections.length) { w.growth.history.pop(); w.removeGrowthChunk(e.newChunkId); return { ...out, grown: false, reason: `refused: no parent road joined (${e.ramps.filter(x => x.kind === 'parent').map(x => `${x.status} ${x.deltaM} m`).join(', ')})` }; }
  return { ...out, grown: true, event: e };
}
// Breadth-first search over two cities' road graphs and every valid join, between two given nodes.
function nodePath(w, from, to) {
  const adj = new Map(); const add = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } };
  for (const c of w.chunks.values()) for (const [f, t] of c.outputs.roadGraph) add(`${c.chunkId}:${f}`, `${c.chunkId}:${t}`);
  for (const e of w.growth.history) for (const l of [...e.connections, ...(e.neighbourConnections ?? []), ...(e.crossCityConnections ?? [])]) add(`${l.parent.chunkId}:${l.parent.nodeId}`, `${l.child.chunkId}:${l.child.nodeId}`);
  const seen = new Set([from]); const queue = [from];
  for (let i = 0; i < queue.length; i += 1) { if (queue[i] === to) return { reachable: true, nodes: i }; for (const n of adj.get(queue[i]) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); } }
  return { reachable: false, visited: seen.size };
}

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  // 0. Gate.
  const g2 = JSON.parse(await readFile(path.join(evidence, 'grade-aware-growth.json'), 'utf8')).node;
  const g3 = JSON.parse(await readFile(path.join(evidence, 'emergent-encounter.json'), 'utf8')).node;
  assert(g2.testB.checks.graphOk === g2.testB.checks.checked && g2.stability.saveLoad.rampRecordsReproduced, 'G02c-02 gate');
  assert(g3.gate.g02c02 === 'pass' && g3.stability.saveLoad.continuedEqualsUninterrupted && g3.path.joinsUsed === g3.path.joinsRecorded && g3.runs[6202].counts.adjacent === 1, 'G03c-01 gate');
  result.node.gate = { g02c02: 'pass', g03c01: 'pass', adjacentEncounterOnKnownSeeds: g3.runs[6202].encounters.find(s => s.states.adjacent).encounterId };
  // 1. Test A.
  result.node.testA = {};
  for (const [name, f] of Object.entries(SCENARIOS)) {
    const w = fixtureWorld(name); const m = new MorphologicalGrowth(w); m.entryLimit = RAMP_RULES.maxGroundOffsetM;
    const steps = f.steps.map(([cityId, dx]) => { const s = controlledStep(w, m, cityId, { gx: f.row.gx + dx, gy: f.row.gy }, true); delete s.event; return s; });
    const p = new UrbanEncounter(w, m).path('chicagoGrid', 'fezOrganicCore');
    result.node.testA[name] = { label: 'Controlled Experiment (TEST ONLY, cores placed by hand)', schedulerRule: 'a grown chunk must join a parent road', steps, connected: p.reachable && p.crossings > 0 };
    console.log(`Test A ${name}: ${steps.map(s => `${s.cityId} → ${s.chunk ?? `${s.target.gx},${s.target.gy}`}: ${s.grown ? `grown, ${s.crossJoins} cross join(s)` : s.reason}`).join(' | ')}; connected ${result.node.testA[name].connected}`);
  }
  // Construction check: the compatible scenario with the scheduler rule off.
  {
    const w = fixtureWorld('compatible'); const m = new MorphologicalGrowth(w); m.entryLimit = RAMP_RULES.maxGroundOffsetM;
    const f = SCENARIOS.compatible; const steps = []; let joinEvent = null; let joinLayers = null;
    for (const [cityId, dx] of f.steps) { const target = { gx: f.row.gx + dx, gy: f.row.gy }; const ic = interCityPlan(w, m, cityId, target); const r = m.grow(cityId, { target, vertical: 'baseline', interCityPlan: ic }); steps.push({ cityId, chunk: r.event.newChunkId, parentJoins: r.event.connections.length, crossJoins: (r.event.crossCityConnections ?? []).length }); if (r.event.crossCityConnections?.length) { joinEvent = r.event; joinLayers = r.layers; } }
    assert(joinEvent, 'construction check: no cross-city join built');
    const records = connectionRecords(w, joinEvent, () => null, (a, b) => new UrbanEncounter(w, m).path(a, b));
    const c = joinEvent.crossCityConnections[0]; const rec = records[0];
    assert(rec.validationResults.withinTolerance, 'cross join not continuous');
    const ramp = joinEvent.ramps.find(r => r.connectionId === c.connectionId);
    const pts = joinLayers.city.network.edges.filter(e => e.ramp === ramp.rampId).flatMap(e => e.points);
    const fezCore = w.cities.get('fezOrganicCore').originChunkId; const chiCore = w.cities.get('chicagoGrid').originChunkId;
    const fezCoreNode = `${fezCore}:${w.chunks.get(fezCore).outputs.roadGraph[0][0]}`; const chiCoreNode = `${chiCore}:${w.chunks.get(chiCore).outputs.roadGraph[0][0]}`;
    const viaJoin = nodePath(w, `${c.parent.chunkId}:${c.parent.nodeId}`, fezCoreNode);
    const coreToCore = nodePath(w, chiCoreNode, fezCoreNode);
    assert(viaJoin.reachable && !coreToCore.reachable && rec.connectionStatus !== 'connected', 'construction check: graph outcome unexpected');
    const saved = JSON.parse(json(w.serialise())); const back = WorldContext.restore(saved);
    for (const k of [...back.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) { const { chunk } = back.generateChunk(k.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `restored ${k.chunkId}`); }
    const vc = verifyConnections(back); assert(vc.every(x => x.same), 'restored cross join differs');
    result.node.constructionCheck = {
      label: 'Controlled Experiment, scheduler rule off: shows construction and validation, not a valid world', steps,
      connection: { ...rec, elevationProfile: ramp.profile }, ramp: { status: ramp.status, deltaM: ramp.deltaM, lengthM: ramp.rampLengthM, maxGrade: ramp.maxGrade, allowedGrade: ramp.allowedGrade, xySnapM: ramp.xySnapM ?? 0, cutM: ramp.cutMaxM, fillM: ramp.fillMaxM, geometryPoints: pts.length },
      graph: { joinToFezCore: viaJoin.reachable, chicagoCoreToFezCore: coreToCore.reachable, reason: `Chicago's growth chunk ${steps[0].chunk} joined no parent road (${steps[0].parentJoins}), so the join reaches Fez but not Chicago's core` },
      saveLoad: { chunksReproduced: saved.chunks.length, joinsReproduced: vc.length },
    };
    console.log(`construction check: ${c.connectionId} built (ramp ${ramp.rampLengthM} m, max ${ramp.maxGrade}, xy ${rec.validationResults.xyM} m, dz ${rec.validationResults.dzM} m); join → Fez core ${viaJoin.reachable}; Chicago core → Fez core ${coreToCore.reachable}; status ${rec.connectionStatus}`);
  }
  // 2. Test B.
  result.node.testB = {};
  for (const [seed, steps] of [[6202, 20], [6209, 16], [6215, 18]]) {
    const run = interCity => { const w = newWorld(seed); const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', encounters: true, interCity }); let stalled = null; const t0 = Date.now(); for (let i = 0; i < steps; i += 1) { const r = g.step(); if (r.stalled) { stalled = r.stalled.reason; break; } } return { w, stalled, ms: Date.now() - t0 }; };
    const on = run(true); const off = run(false);
    const seqOn = on.w.growth.history.map(e => e.newChunkId); const seqOff = off.w.growth.history.map(e => e.newChunkId);
    const attempts = on.w.growth.history.filter(e => e.interCity?.edges.length).map(e => ({ step: e.step, cityId: e.cityId, chunk: e.newChunkId, edges: e.interCity.edges.map(x => ({ otherChunkId: x.otherChunkId, otherCityId: x.otherCityId, newcomerStrategy: x.newcomerStrategy, mode: x.mode, interfaces: x.interfaces.map(i => ({ position: i.position, stepM: i.stepM, accepted: i.accepted, reason: i.reasons[0] ?? null })) })), crossRamps: e.ramps.filter(r => r.kind === 'crossCity').map(({ profile, ...r }) => r), crossJoins: (e.crossCityConnections ?? []).length }));
    const connections = on.w.growth.interCityConnections ?? [];
    for (const s of on.w.growth.encounters) assert(!s.states.connected || connections.some(c => c.connectionStatus === 'connected' && c.encounterId === s.encounterId), `${s.encounterId}: connected without a record`);
    const tally = attempts.flatMap(a => a.crossRamps).reduce((o, r) => ({ ...o, [r.status]: (o[r.status] ?? 0) + 1 }), {});
    result.node.testB[seed] = { steps: on.w.growth.history.length, stalled: on.stalled, ms: on.ms, msWithout: off.ms, sameChunkSequence: json(seqOn) === json(seqOff), attempts, crossRampOutcomes: tally, connections, encounters: on.w.growth.encounters.filter(s => s.states.adjacent).map(s => ({ encounterId: s.encounterId, states: s.states, relationshipStatus: s.relationshipStatus, validationStatus: s.validationStatus })) };
    console.log(`Test B ${seed}: ${on.w.growth.history.length} steps; ${attempts.length} newcomer(s) at another city; cross ramps ${json(tally)}; connections ${connections.length}; same sequence as without: ${result.node.testB[seed].sameChunkSequence}`);
  }
  // 3. Determinism and save / load (inter-city on).
  {
    const a = newWorld(6202); const ga = new WorldGrowthController(a, { growthMode: 'road', gradeProfile: 'baseline', encounters: true, interCity: true }); for (let i = 0; i < 16; i += 1) if (ga.step().stalled) break;
    const b = newWorld(6202); const gb = new WorldGrowthController(b, { growthMode: 'road', gradeProfile: 'baseline', encounters: true, interCity: true }); for (let i = 0; i < 16; i += 1) { b.chunks = new Map([...b.chunks].reverse()); if (gb.step().stalled) break; }
    assert(json(strip(a.growth.history)) === json(strip(b.growth.history)) && json(a.growth.encounters) === json(b.growth.encounters), 'inter-city run depends on the registry order');
    const h = newWorld(6202); const gh = new WorldGrowthController(h, { growthMode: 'road', gradeProfile: 'baseline', encounters: true, interCity: true }); for (let i = 0; i < 10; i += 1) gh.step();
    const back = WorldContext.restore(JSON.parse(json(h.serialise())));
    for (const k of [...back.chunks.values()].sort((x, y) => x.growthStep - y.growthStep)) { const { chunk } = back.generateChunk(k.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `restored ${k.chunkId}`); }
    const gr = new WorldGrowthController(back); assert(gr.adapter.interCity, 'load lost inter-city mode');
    for (let i = 0; i < 6; i += 1) if (gr.step().stalled) break;
    assert(json(strip(back.growth.history)) === json(strip(a.growth.history)) && json(back.growth.encounters) === json(a.growth.encounters) && json(back.growth.interCityConnections) === json(a.growth.interCityConnections), 'save / load / continue differs');
    result.node.stability = { registryOrderReversed: 'identical (seed 6202, 16 steps, inter-city on)', saveLoad: { savedAtStep: 10, continuedEqualsUninterrupted: true, interCityModeRestored: true } };
    console.log('determinism and save / load pass (inter-city on)');
  }
  // 4. Regressions touched by this task.
  {
    const base = JSON.parse(await readFile(path.join(evidence, 'world-6202-g02c-step12-state.json'), 'utf8'));
    const replay = base.growth.history.map(e => ({ cityId: e.cityId, gx: e.targetCoordinate.gx, gy: e.targetCoordinate.gy, parentChunkId: e.parentChunkId }));
    const w = newWorld(6202); const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', replay }); for (let i = 0; i < 12; i += 1) g.step();
    const now = w.growth.history.flatMap(e => e.ramps).reduce((o, r) => ({ ...o, [r.status]: (o[r.status] ?? 0) + 1 }), {});
    const was = g2.testB.summary.byStatus;
    const e6202 = newWorld(6202); const ge = new WorldGrowthController(e6202, { growthMode: 'road', gradeProfile: 'baseline', encounters: true }); for (let i = 0; i < 60; i += 1) if (ge.step().stalled) break;
    const encNow = e6202.growth.encounters.map(s => [s.encounterId, s.relationshipStatus, s.states]); const encWas = g3.runs[6202].encounters.map(s => [s.encounterId, s.relationshipStatus, s.states]);
    result.node.regression = { g02c02ReplayStatuses: { was, now, equal: json(Object.entries(was).sort()) === json(Object.entries(now).sort()) }, g03c01Encounters6202: { equal: json(encNow) === json(encWas), now: encNow } };
    console.log(`regression: G02c-02 replay ${result.node.regression.g02c02ReplayStatuses.equal ? 'equal' : `DIFFERS ${json(now)} vs ${json(was)}`}; G03c-01 6202 encounters ${result.node.regression.g03c01Encounters6202.equal ? 'equal' : 'DIFFER'}`);
  }
  result.nodeMs = Date.now() - started;
  await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Part A done (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4221; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
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
    const b = { screenshots: {}, captions: {} };
    const B = result.node.testB[6202]; const att = B.attempts.at(-1);
    await page.goto(`${base}${entry}?start=0&growthMode=road&grade=baseline&emergent=1&intercity=1`, { waitUntil: 'networkidle' }); await waitReady();
    await lab(() => window.__originLab.setAutoFit(false));
    await call(x => window.__originLab.generate(x), 6202);
    await call(n => window.__originLab.growSteps(n), B.steps);
    const pageCross = await lab(() => window.__originLab.history().flatMap(e => (e.ramps ?? []).filter(r => r.kind === 'crossCity').map(r => [r.connectionId, r.status])));
    assert(json(pageCross) === json(B.attempts.flatMap(a => a.crossRamps.map(r => [r.connectionId, r.status]))), 'browser cross-city outcomes differ from Node');
    await lab(() => window.__originLab.setLayers({ rampRejected: true, rampSeam: true, rampLabels: true, encBoundary: true, encLabels: true, chunkBorders: true, ownership: true }));
    const chunks = await lab(() => window.__originLab.chunks()); const n = chunks.find(c => c.chunkId === att.chunk); const o = chunks.find(c => c.chunkId === att.edges[0].otherChunkId);
    await lab(f => window.__originLab.focusPoint(f.x, f.z, 1100), { x: (n.worldOrigin.x + o.worldOrigin.x) / 2, z: (n.worldOrigin.z + o.worldOrigin.z) / 2 });
    b.screenshots.natural = await shot('g03c-02-seed6202-intercity-attempt.png'); b.captions.natural = `seed 6202, step ${att.step}, ${att.cityId} newcomer ${att.chunk} at ${att.edges[0].otherCityId} ${att.edges[0].otherChunkId}; layers: unconnected road ends, seam conflicts, ramp numbers, encounter; status: no connection`;
    // Long section of the controlled cross-city ramp (real profile samples).
    const C = result.node.constructionCheck; const prof = C.connection.elevationProfile;
    const W = 900; const Hh = 320; const s = prof.map(q => q[0]); const ys = prof.flatMap(q => [q[1], q[2]]);
    const x = v => 50 + (v / Math.max(...s)) * (W - 80); const lo = Math.min(...ys) - 0.5; const hi = Math.max(...ys) + 0.5; const y = v => Hh - 40 - ((v - lo) / (hi - lo)) * (Hh - 70);
    const line = k => prof.map((q, i) => `${i ? 'L' : 'M'}${x(q[0]).toFixed(1)},${y(q[k]).toFixed(1)}`).join(' ');
    const sheet = await context.newPage(); await sheet.setViewportSize({ width: 1000, height: 480 });
    await sheet.setContent(`<body style="margin:0;padding:24px;background:#0f1215;color:#e8ecee;font:15px 'Segoe UI',Arial"><h3 style="font-weight:400;margin:0 0 4px">G03c-02 · controlled cross-city ramp ${C.connection.connectionId}</h3><p style="color:#9aa3a8;margin:0 0 10px">TEST ONLY fixture, seed 6201 · ${C.ramp.lengthM} m · max ${(C.ramp.maxGrade * 100).toFixed(1)} % (limit ${(C.ramp.allowedGrade * 100).toFixed(1)} %) · join XY ${C.connection.validationResults.xyM} m, height ${C.connection.validationResults.dzM} m · status: ${C.connection.connectionStatus}</p><svg width="${W}" height="${Hh}" style="background:#151a1e"><path d="${line(2)}" stroke="#8a6d4a" stroke-width="3" fill="none"/><path d="${line(1)}" stroke="#3fe0ff" stroke-width="2.5" fill="none"/><text x="50" y="${Hh - 14}" fill="#9aa3a8" font-size="12">0 m (Chicago road end, shared edge)</text><text x="${W - 90}" y="${Hh - 14}" fill="#9aa3a8" font-size="12">${Math.max(...s)} m</text><text x="6" y="${y(hi - 0.5) + 4}" fill="#9aa3a8" font-size="12">${(hi - 0.5).toFixed(1)}</text><text x="6" y="${y(lo + 0.5) + 4}" fill="#9aa3a8" font-size="12">${(lo + 0.5).toFixed(1)}</text></svg><p style="color:#9aa3a8;margin:8px 0 0">cyan: road of the Fez newcomer from the generated network · brown: world terrain under it</p></body>`);
    b.screenshots.longSection = path.relative(root, path.join(shots, 'g03c-02-controlled-cross-ramp-long-section.png')).replaceAll('\\', '/');
    await sheet.screenshot({ path: path.join(root, b.screenshots.longSection), fullPage: true });
    b.errors = errors; assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G03c-02 verification finished. Record: experiments/city-of-cities/evidence/inter-city-connection.json');
