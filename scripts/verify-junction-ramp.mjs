// A City of Cities — G02c-03a Intersection-Aware Road Ramp verifier.
// Part A (Node):
//   1. controlled fixture (TEST ONLY): feasible / seam too high / short branches / 4 %; heights, grades, level zone, paths
//   2. seed 6202 replay of the G02c-01 events with ramps through one junction: statuses against the G02c-02 baseline,
//      every through-junction ramp checked (shared height, grades of main and branches, graph paths), committed chunks
//   3. free growth, seeds 6201 / 6202 / 6203, 30 steps, against the G02c-02 runs without junction ramps
//   4. determinism (registry order reversed), save → load → continue; default path (option off) equals G02c-02
// Part B (browser): the replay timeline of a real through-junction event with the connection overlay, real pointer
//   clicks on a junction and a ramp, the long section, overlay off, building impact with the option off and on.
// Usage: node --max-old-space-size=8192 scripts/verify-junction-ramp.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { cityRoadReach } = await mod('experiments/city-of-cities/RoadGrowthFrontAdapter.js');
const { RAMP_RULES, GRADE_PROFILES, planVertical } = await mod('experiments/city-of-cities/RoadRampPlanner.js');
const { JUNCTION_FIXTURES, flatFields, junctionNetwork } = await mod('experiments/city-of-cities/junctionFixture.js');
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'junction-ramp.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const strip = h => h.map(({ ms, failedAttempts, ...e }) => ({ ...e, failedAttempts: failedAttempts.map(({ cached, ...f }) => f) }));
const tally = l => l.reduce((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});
const result = { task: 'G02c-03a Intersection-Aware Road Ramp', testedAt: new Date().toISOString(), rules: RAMP_RULES, node: {}, browser: null };
if (browserOnly) result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;
const newWorld = seed => { const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise(); assert(!rep.failures.length, `seed ${seed}`); for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id); return w; };

// Every node's height equals the end height of every road that meets there (no step at any junction).
const nodeEdgeGap = net => { let worst = 0; for (const e of net.edges) for (const [k, n] of [[0, e.from], [e.points.length - 1, e.to]]) worst = Math.max(worst, Math.abs(e.points[k].y - net.nodes[n].y)); return worst; };
// Breadth-first search over a network's edges.
const reachable = (net, from, to) => { const adj = new Map(); for (const e of net.edges) { for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); } } const seen = new Set([from]); const q = [from]; for (let i = 0; i < q.length; i += 1) { if (q[i] === to) return true; for (const n of adj.get(q[i]) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); } } return false; };
// Sampled grade of each ramp edge, and the steepest grade inside the level zone of a junction.
function rampGrades(net, rampId, junction) {
  const out = []; let zone = 0;
  for (const e of net.edges.filter(x => x.ramp === rampId)) {
    let g = 0; let L = 0;
    for (let i = 1; i < e.points.length; i += 1) {
      const a = e.points[i - 1]; const b = e.points[i]; const d = Math.hypot(b.x - a.x, b.z - a.z); if (d < 1e-6) continue;
      const grade = Math.abs(b.y - a.y) / d; g = Math.max(g, grade); L += d;
      if (junction) { const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; if (Math.hypot(mid.x - junction.x, mid.z - junction.z) <= RAMP_RULES.junctionLevelM - RAMP_RULES.sampleM / 2) zone = Math.max(zone, grade); }
    }
    out.push({ edgeId: e.id, role: e.rampRole ?? 'main', roadClass: e.roadClass, maxGrade: +g.toFixed(4) });
  }
  return { edges: out, levelZoneMaxGrade: +zone.toFixed(5) };
}
const allowedOf = (profile, cls) => GRADE_PROFILES[profile].grade * (RAMP_RULES.classFactor[cls] ?? 1);
// Checks of one accepted through-junction ramp on the generated (ramped) network of its chunk.
function checkJunctionRamp(net, r, profile) {
  const j = r.junction; const J = net.nodes[j.nodeId];
  const incident = net.edges.filter(e => e.from === j.nodeId || e.to === j.nodeId);
  const heights = incident.map(e => (e.from === j.nodeId ? e.points[0].y : e.points.at(-1).y));
  const spread = Math.max(...heights, J.y) - Math.min(...heights, J.y);
  assert(Math.abs(J.y - j.junctionZ) <= 0.01 && spread <= RAMP_RULES.endpointToleranceM, `${r.rampId}: junction heights differ (${spread})`);
  const g = rampGrades(net, r.rampId, j);
  for (const e of g.edges) assert(e.maxGrade <= allowedOf(profile, e.roadClass) + 1e-6, `${r.rampId}: edge ${e.edgeId} grade ${e.maxGrade}`);
  assert(g.levelZoneMaxGrade <= 0.005, `${r.rampId}: junction zone grade ${g.levelZoneMaxGrade}`);
  // Paths: from the shared-edge node through J to the main road's far node and to the end of every branch.
  const mainEdges = g.edges.filter(e => e.role === 'main').map(e => net.edges[e.edgeId]);
  const ends = new Set(); for (const e of mainEdges) for (const n of [e.from, e.to]) if (n !== r.childNodeId && n !== j.nodeId && mainEdges.filter(x => x.from === n || x.to === n).length === 1) ends.add(n);
  const branchEnds = g.edges.filter(e => e.role === 'branch').map(e => { const x = net.edges[e.edgeId]; return x.from === j.nodeId ? x.to : x.from; });
  const paths = { mainEnd: [...ends].every(n => reachable(net, r.childNodeId, n)), toJunction: reachable(net, r.childNodeId, j.nodeId), branches: branchEnds.map(n => reachable(net, n, r.childNodeId)) };
  assert(paths.mainEnd && paths.toJunction && paths.branches.every(Boolean), `${r.rampId}: path missing ${json(paths)}`);
  return { rampId: r.rampId, junctionNode: j.nodeId, junctionGroundM: j.groundM, junctionZ: j.junctionZ, degree: j.degree, heightSpreadAtJunctionM: +spread.toFixed(4), grades: g, paths, branches: j.branches };
}
function grow(w, g, n, { reverse = false, keep = false } = {}) {
  const sigs = new Map([...w.chunks.values()].map(c => [c.chunkId, json(c.outputs.signatures)])); let changed = 0; let stalled = null; const layers = new Map(); let gap = 0; const t0 = Date.now();
  for (let i = 0; i < n; i += 1) {
    if (reverse) w.chunks = new Map([...w.chunks].reverse());
    const r = g.step(); if (r.stalled) { stalled = r.stalled; break; }
    for (const [id, s] of sigs) if (json(w.chunks.get(id).outputs.signatures) !== s) changed += 1;
    sigs.set(r.event.newChunkId, json(r.chunk.outputs.signatures));
    gap = Math.max(gap, nodeEdgeGap(r.layers.city.network));
    if (keep) layers.set(r.event.newChunkId, r.layers.city.network);
  }
  return { changed, stalled, layers, gap, ms: Date.now() - t0 };
}
const impactOf = w => w.growth.history.map(e => w.chunks.get(e.newChunkId).outputs.ramps?.impact).filter(Boolean).reduce((s, x) => ({ committedBuildingsAffected: s.committedBuildingsAffected + x.committedBuildingsAffected, excluded: s.excluded + x.newBuildingCandidatesExcluded, candidates: s.candidates + x.candidatesBefore, excludedFootprintM2: s.excludedFootprintM2 + x.excludedFootprintM2, corridorAreaM2: s.corridorAreaM2 + x.corridorAreaM2, blockAreaAffectedM2: s.blockAreaAffectedM2 + x.blockAreaAffectedM2, parcelAreaAffectedM2: s.parcelAreaAffectedM2 + x.parcelAreaAffectedM2 }), { committedBuildingsAffected: 0, excluded: 0, candidates: 0, excludedFootprintM2: 0, corridorAreaM2: 0, blockAreaAffectedM2: 0, parcelAreaAffectedM2: 0 });

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  const g2 = JSON.parse(await readFile(path.join(evidence, 'grade-aware-growth.json'), 'utf8')).node;
  // 1. Controlled fixture.
  result.node.fixture = {};
  for (const [name, f] of Object.entries(JUNCTION_FIXTURES)) {
    const run = through => { const net = junctionNetwork(f); const r = planVertical(net, flatFields(), { height: () => 20 }, { profile: f.profile, chunkId: 'fixture', entries: [{ connectionId: 'conn:fixture:maxZ:0', kind: 'parent', parentChunkId: 'fixture', parentNodeId: 0, parentEdgeId: 0, side: 'minZ', position: 0, roadClass: 'primary', elevation: f.sourceElevation }], ...(through ? { throughJunction: true } : {}) }); return { net: r.network, rec: r.records[0] }; };
    const simple = run(false); const through = run(true);
    const out = { label: 'Controlled Fixture (TEST ONLY)', title: f.title, simple: { status: simple.rec.status, reason: simple.rec.reason }, through: { status: through.rec.status, reason: through.rec.reason ?? null } };
    if (through.rec.status === 'accepted') { out.check = checkJunctionRamp(through.net, through.rec, f.profile); out.nodeEdgeGapM = nodeEdgeGap(through.net); out.through.maxGrade = through.rec.maxGrade; out.through.rampLengthM = through.rec.rampLengthM; assert(out.nodeEdgeGapM <= 1e-6, `${name}: node / edge heights differ`); }
    result.node.fixture[name] = out;
    console.log(`fixture ${name}: simple ${simple.rec.status}; through ${through.rec.status}${through.rec.junction?.junctionZ !== undefined ? ` (junction ${through.rec.junction.junctionZ} m, ${through.rec.junction.branches?.length ?? 0} branches)` : ''}${through.rec.reason ? `: ${through.rec.reason.slice(0, 120)}` : ''}`);
  }
  assert(result.node.fixture.feasible.through.status === 'accepted' && result.node.fixture.seamTooHigh.through.status !== 'accepted' && result.node.fixture.shortBranches.through.status === 'junctionConstraint', 'fixture expectations');
  // 2. Replay of seed 6202.
  const base = JSON.parse(await readFile(path.join(evidence, 'world-6202-g02c-step12-state.json'), 'utf8'));
  const replay = base.growth.history.map(e => ({ cityId: e.cityId, gx: e.targetCoordinate.gx, gy: e.targetCoordinate.gy, parentChunkId: e.parentChunkId }));
  {
    const w = newWorld(6202); const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', replay, junctionRamps: true });
    const r = grow(w, g, 12, { keep: true });
    const ramps = w.growth.history.flatMap(e => e.ramps);
    const through = ramps.filter(x => x.through === 'junction');
    const checks = through.map(x => checkJunctionRamp(r.layers.get(x.targetChunkId), x, 'baseline'));
    assert(r.changed === 0 && r.gap <= RAMP_RULES.endpointToleranceM, 'replay: committed chunk changed or node heights differ');
    result.node.replay6202 = {
      before: { source: 'G02c-02 replay (no junction ramps)', statuses: g2.testB.summary.byStatus, joins: g2.testB.summary.joins, unconnectedChunks: g2.testB.summary.unconnectedChildChunks, reach: g2.testB.summary.reach },
      after: { statuses: tally(ramps.map(x => x.status)), throughJunction: through.length, joins: { parent: w.growth.history.reduce((s, e) => s + e.connections.length, 0), neighbour: w.growth.history.reduce((s, e) => s + e.neighbourConnections.length, 0) }, unconnectedChunks: w.growth.history.filter(e => !e.connections.length).map(e => e.newChunkId), reach: Object.fromEntries(['chicagoGrid', 'manhattanGrid', 'fezOrganicCore'].map(id => { const q = cityRoadReach(w, id); return [id, `${q.reachableChunks}/${q.chunks}`]; })), committedChunksChanged: r.changed, maxNodeEdgeGapM: +r.gap.toFixed(4), impact: impactOf(w) },
      junctionRejections: ramps.filter(x => x.status === 'junctionConstraint').map(x => ({ rampId: x.rampId, reason: x.reason, simpleRampReason: x.simpleRampReason })),
      checks, comparability: 'same 12 target cells and parents (replay); the candidate set per chunk is the same road ends, so statuses compare by connection id',
    };
    console.log(`replay 6202: ${json(result.node.replay6202.after.statuses)} (before ${json(g2.testB.summary.byStatus)}); ${through.length} through a junction, all checks pass; unconnected chunks ${result.node.replay6202.after.unconnectedChunks.length} (before ${g2.testB.summary.unconnectedChildChunks.length})`);
  }
  // 3. Free growth.
  result.node.free = {};
  for (const seed of [6201, 6202, 6203]) {
    const w = newWorld(seed); const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true });
    const r = grow(w, g, 30, { keep: true });
    const ramps = w.growth.history.flatMap(e => e.ramps); const through = ramps.filter(x => x.through === 'junction');
    const checks = through.map(x => checkJunctionRamp(r.layers.get(x.targetChunkId), x, 'baseline'));
    assert(r.changed === 0 && r.gap <= RAMP_RULES.endpointToleranceM, `free ${seed}: committed chunk changed or node heights differ`);
    const firstThrough = w.growth.history.find(e => e.ramps.some(x => x.through === 'junction'));
    result.node.free[seed] = {
      before: { source: 'G02c-02 free run, 12 steps, no junction ramps', steps: g2.testC.free[seed].baseline.events, stalled: g2.testC.free[seed].baseline.stalled },
      after: { steps: w.growth.history.length, stalled: r.stalled?.reason ?? null, stalledAtStep: r.stalled?.step ?? null, grown: Object.fromEntries([...w.cities.keys()].sort().map(id => [id, w.growth.history.filter(e => e.cityId === id).length])), statuses: tally(ramps.map(x => x.status)), throughJunction: through.length, committedChunksChanged: r.changed, maxNodeEdgeGapM: +r.gap.toFixed(4), impact: impactOf(w), ms: r.ms, failedAttempts: w.growth.roadAttempts.length, cacheHits: w.growth.roadAttempts.filter(a => a.cached).length },
      firstThroughJunctionStep: firstThrough ? { step: firstThrough.step, chunk: firstThrough.newChunkId, cityId: firstThrough.cityId, parent: firstThrough.parentChunkId } : null, checks: checks.length,
    };
    console.log(`free ${seed}: ${w.growth.history.length} steps${r.stalled ? ` (stalled at ${r.stalled.step})` : ''} (before ${g2.testC.free[seed].baseline.events}); ${through.length} through a junction; committed changed ${r.changed}`);
  }
  // 4. Determinism, save / load, default path.
  {
    const a = newWorld(6202); const ga = new WorldGrowthController(a, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true }); grow(a, ga, 12);
    const b = newWorld(6202); const gb = new WorldGrowthController(b, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true }); grow(b, gb, 12, { reverse: true });
    assert(json(strip(a.growth.history)) === json(strip(b.growth.history)), 'depends on the registry order');
    const h = newWorld(6202); const gh = new WorldGrowthController(h, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true }); grow(h, gh, 6);
    const saved = JSON.parse(json(h.serialise())); assert(saved.growth.junctionRamps, 'option not saved');
    const back = WorldContext.restore(saved);
    for (const c of [...back.chunks.values()].sort((x, y) => x.growthStep - y.growthStep)) { const { chunk } = back.generateChunk(c.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `restored ${c.chunkId}`); }
    for (const e of back.growth.history) assert(json(back.chunks.get(e.newChunkId).outputs.ramps.records) === json(e.ramps), `restored ramps of ${e.newChunkId}`);
    const gr = new WorldGrowthController(back); assert(gr.adapter.throughJunction, 'load lost the option'); grow(back, gr, 6);
    assert(json(strip(back.growth.history)) === json(strip(a.growth.history)), 'save / load / continue differs');
    const d = newWorld(6202); const gd = new WorldGrowthController(d, { growthMode: 'road', gradeProfile: 'baseline', replay }); grow(d, gd, 12);
    const dflt = tally(d.growth.history.flatMap(e => e.ramps).map(x => x.status));
    assert(json(Object.entries(dflt).sort()) === json(Object.entries(g2.testB.summary.byStatus).sort()), `default path changed ${json(dflt)}`);
    result.node.stability = { registryOrderReversed: 'identical (seed 6202, 12 steps, junction ramps on)', saveLoad: { savedAtStep: 6, rampRecordsReproduced: true, optionRestored: true, continuedEqualsUninterrupted: true }, defaultPathEqualsG02c02: dflt };
    console.log('determinism, save / load and default path pass');
  }
  result.nodeMs = Date.now() - started;
  await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4224; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
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
    const b = { screenshots: {}, captions: {}, checks: [] };
    const check = (name, pass, detail = '') => { b.checks.push({ name, pass: Boolean(pass), detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ·  ${detail}` : ''}`); assert(pass, name); };
    const F = result.node.free[6202].firstThroughJunctionStep; assert(F, 'no through-junction event on seed 6202 to show');
    const viewShot = async name => { await page.waitForTimeout(800); const c = await page.locator('#worldCanvas').boundingBox(); const extra = await page.locator('.replay-panel, #rampPick').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return r.bottom + scrollY; })); const bottom = Math.max(c.y + c.height, ...extra); const f = path.join(shots, name); await page.screenshot({ path: f, fullPage: true, clip: { x: c.x, y: c.y, width: c.width, height: bottom - c.y } }); return path.relative(root, f).replaceAll('\\', '/'); };
    await page.goto(`${base}${entry}?worldSeed=6202&growthMode=road&grade=baseline&junctions=1&replay=${F.step}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window.__originLab?.ready === true && window.__originLab.replayState?.()) || window.__originLab?.error?.(), null, { timeout: 900000 });
    { const err = await lab(() => window.__originLab.error()); assert(!err, `page error ${err}`); }
    const ev = await lab(() => { const e = window.__originLab.replayEvent(); return { chunk: e.newChunkId, through: e.ramps.filter(r => r.through === 'junction').map(r => r.rampId) }; });
    check('page event is the Node event with a ramp through a junction', ev.chunk === F.chunk && ev.through.length > 0, `${F.parent} → ${ev.chunk}, ${ev.through.length} ramp(s) through a junction`);
    const builds0 = await lab(id => window.__originLab.builds()[id], F.chunk);
    await lab(() => window.__originLab.setLayers({ rampOverlay: true }));
    await lab(() => window.__originLab.replaySeek(8)); await page.waitForTimeout(600);
    b.screenshots.top = await viewShot('g02c-03a-overlay-top.png'); b.captions.top = `seed 6202, step ${F.step}, ${F.cityId} ${F.parent} → ${F.chunk}; connection overlay on; replay stage 8 (commit); camera fitted to both chunks`;
    // Real pointer clicks on overlay items.
    const items = await lab(() => window.__originLab.overlayItems());
    const junction = items.find(i => i.kind === 'junction' && i.chunkId === F.chunk && ev.through.includes(i.rampId)); const ramp = items.find(i => i.kind === 'ramp' && i.chunkId === F.chunk && i.role === 'main' && ev.through.includes(i.rampId));
    const click = async p => { const s = await lab(q => window.__originLab.projectToCanvas(q), p); const c = await page.locator('#worldCanvas').boundingBox(); await page.mouse.click(c.x + s.x, c.y + s.y); await page.waitForTimeout(300); return lab(() => window.__originLab.picked()); };
    const pj = await click(junction.point);
    check('real click on the junction marker opens the junction', pj?.kind === 'junction' && pj.rampId === junction.rampId && pj.profile, pj?.text?.split('\n')[0]);
    b.screenshots.pickJunction = await viewShot('g02c-03a-junction-pick-profile.png'); b.captions.pickJunction = `same camera; real click on junction of ${junction.rampId}; long section from the ramp record`;
    const pr = await click(ramp.point);
    check('real click on the ramp road opens the ramp', pr?.kind === 'ramp' && pr.rampId === ramp.rampId, pr?.text?.split('\n')[0]);
    // 3D view of the junction.
    const jRec = await lab(id => window.__originLab.replayEvent().ramps.find(r => r.rampId === id).junction, junction.rampId);
    await lab(j => window.__originLab.focusPoint(j.x, j.z, 420), jRec);
    b.screenshots.three = await viewShot('g02c-03a-junction-3d.png'); b.captions.three = `seed 6202, step ${F.step}, junction node ${jRec.nodeId} of ${F.chunk} (shared height ${jRec.junctionZ} m, ground ${jRec.groundM} m); camera focusPoint 420 m; overlay on`;
    // Overlay off: same click finds nothing; the timeline still runs; nothing regenerated.
    await lab(() => window.__originLab.setLayers({ rampOverlay: false })); await lab(() => { document.querySelector('#rampPick')?.remove(); });
    await lab(() => window.__originLab.replaySeek(3.5)); await page.waitForTimeout(300); const st = await lab(() => window.__originLab.replayState());
    const builds1 = await lab(id => window.__originLab.builds()[id], F.chunk);
    check('overlay off, timeline seek, nothing regenerated', st.stage === 'roads' && builds0 === 1 && builds1 === 1, `stage ${st.stage}, built ${builds1} time(s)`);
    b.screenshots.plain = await viewShot('g02c-03a-overlay-off-roads-stage.png'); b.captions.plain = `same event, overlay off, replay stage 4 (roads); real road widths`;
    // Building impact: the same target cells with the option off and on (same replay of targets, same camera).
    const hist = await lab(() => window.__originLab.history().map(e => ({ cityId: e.cityId, gx: e.targetCoordinate.gx, gy: e.targetCoordinate.gy, parentChunkId: e.parentChunkId })));
    const impact = {};
    for (const [label, junctions] of [['off', 0], ['on', 1]]) {
      await page.goto(`${base}${entry}?start=0&growthMode=road&grade=baseline${junctions ? '&junctions=1' : ''}`, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__originLab?.ready === true);
      await lab(() => window.__originLab.setAutoFit(false));
      await lab(x => window.__originLab.generate(x), 6202); await page.waitForFunction(() => window.__originLab.ready === true, null, { timeout: 900000 });
      await lab(r => window.__originLab.roadReplay(r), hist);
      await lab(n => window.__originLab.growSteps(n), F.step); await page.waitForFunction(() => window.__originLab.ready === true, null, { timeout: 900000 });
      const cc = await lab(id => { const c = window.__originLab.chunks().find(x => x.chunkId === id); return { buildings: c.outputs.counts.buildings, impact: c.outputs.ramps?.impact ?? null, origin: c.worldOrigin }; }, F.chunk);
      impact[label] = { buildings: cc.buildings, impact: cc.impact };
      await lab(o => window.__originLab.focusPoint(o.x, o.z, 900), jRec);
      b.screenshots[`impact_${label}`] = await viewShot(`g02c-03a-building-impact-${label}.png`); b.captions[`impact_${label}`] = `seed 6202, step ${F.step}, same targets replayed; junction ramps ${label}; ${cc.buildings} buildings in ${F.chunk}; camera focusPoint 900 m on junction ${jRec.nodeId}`;
    }
    b.impact = impact;
    check('building impact recorded with the option off and on', impact.off.impact && impact.on.impact && impact.on.impact.committedBuildingsAffected === 0, `${impact.off.buildings} → ${impact.on.buildings} buildings in the new chunk`);
    b.errors = errors; check('no browser errors', !errors.length, errors.slice(0, 3).join(' | '));
    result.browser = b;
  } finally { await browser?.close(); server.kill(); }
}
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G02c-03a verification finished. Record: experiments/city-of-cities/evidence/junction-ramp.json');
