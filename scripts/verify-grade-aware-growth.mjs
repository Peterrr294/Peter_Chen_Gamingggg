// A City of Cities — G02c-02 Grade-Aware Road Growth & Ramp Connection verifier.
// Part A (Node):
//   1. diagnosis of seed 6202: every road end the G02c-01 run left facing a grown chunk, by stable connection id, with the
//      terrain on both sides, the old reason and the new outcome
//   2. Test A: Chicago c_1_2 → c_1_3 with ramps; each accepted ramp checked for XY, elevation and graph continuity, sampled
//      grade, ground contact; plan geometry (network, blocks, parcels) equal to the run without ramps
//   3. Test B: the 12 events of the G02c-01 run replayed with ramps; before / after by connection id
//   4. Test C: 4 / 6 / 8 % on the replay, and the free scheduler on seeds 6201 / 6202 / 6203
//   5. determinism (registry order reversed), candidate cache on / off, save → load → continue, failure injection
//   6. long run: 20 free steps
// Part B (browser): fixed-camera before / after, ramp debug, long sections, seed 6202 before / after, save → load.
// Usage: node --max-old-space-size=8192 scripts/verify-grade-aware-growth.mjs [--node-only | --browser-only]
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { verifyConnections, portPoint } = await mod('experiments/city-of-cities/MorphologicalGrowth.js');
const { FAILURE, cityRoadReach } = await mod('experiments/city-of-cities/RoadGrowthFrontAdapter.js');
const { GRADE_PROFILES, RAMP_RULES, RAMP_STATUS: S, diagnosisOf } = await mod('experiments/city-of-cities/RoadRampPlanner.js');
const { createSampler } = await mod('experiments/seed-terrain/NetworkGenerator.js');
const { terrainOf } = await mod('experiments/growing-world/WorldGrowthController.js');
const { CITY_IDS } = await mod('experiments/city-of-cities/originConfig.js');
const nodeOnly = process.argv.includes('--node-only'); const browserOnly = process.argv.includes('--browser-only');
const evidence = path.join(root, 'experiments/city-of-cities/evidence'); const recordFile = path.join(evidence, 'grade-aware-growth.json');
const shots = path.join(root, 'docs/assets/screenshots/procedural-mini-world');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const strip = h => h.map(({ ms, failedAttempts, ...e }) => ({ ...e, failedAttempts: failedAttempts.map(({ cached, ...f }) => f) }));
const OPP = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' };
const TOL = RAMP_RULES.endpointToleranceM;
const result = { task: 'G02c-02 Grade-Aware Road Growth & Ramp Connection', testedAt: new Date().toISOString(), rules: RAMP_RULES, profiles: GRADE_PROFILES, node: {}, browser: null };
if (browserOnly) result.node = JSON.parse(await readFile(recordFile, 'utf8')).node;
const baselineState = JSON.parse(await readFile(path.join(evidence, 'world-6202-g02c-step12-state.json'), 'utf8'));
const REPLAY = baselineState.growth.history.map(e => ({ cityId: e.cityId, gx: e.targetCoordinate.gx, gy: e.targetCoordinate.gy, parentChunkId: e.parentChunkId }));

function newWorld(seed) {
  const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise();
  assert(!rep.failures.length, `seed ${seed}: placement failed`);
  for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
  return w;
}
// Runs n steps; keeps the generated layers of the new chunks for geometry checks when asked.
function run(w, g, n, { keep = false, reverse = false } = {}) {
  const layers = new Map(); const t0 = Date.now(); let stalled = null;
  for (let i = 0; i < n; i += 1) {
    if (reverse) w.chunks = new Map([...w.chunks].reverse());
    const r = g.step();
    if (r.stalled) { stalled = r.stalled; break; }
    if (keep) layers.set(r.event.newChunkId, r.layers);
  }
  return { layers, ms: Date.now() - t0, stalled };
}
// XY + elevation + graph continuity of every connected ramp or flush join, and the sampled profile of every ramp.
function checkRamps(w, layers) {
  const out = { checked: 0, maxResidualM: 0, maxXYM: 0, maxGrade: 0, maxGradeByClass: {}, maxGradeChange: 0, maxGroundGapM: 0, graphOk: 0 };
  for (const e of w.growth.history.filter(x => x.ramps)) {
    const child = w.chunks.get(e.newChunkId); const L = layers.get(e.newChunkId);
    const shown = L ? createSampler(L.terrain.fields).height : null;
    const links = [...e.connections, ...e.neighbourConnections];
    for (const r of e.ramps.filter(x => x.status === S.accepted || x.status === S.flush)) {
      const src = w.chunks.get(r.parentChunkId);
      const srcSide = r.connectionId.split(':')[2];
      const a = src.outputs.ports[srcSide].find(p => p.position === r.position);
      const b = child.outputs.ports[r.side].find(p => p.nodeId === r.childNodeId);
      assert(a && b, `${r.rampId}: ports missing`);
      const pa = portPoint(src, srcSide, a.position); const pb = portPoint(child, r.side, b.position);
      const xy = Math.hypot(pa.x - pb.x, pa.z - pb.z); const dz = Math.abs(a.elevation - b.elevation);
      assert(xy <= TOL && dz <= TOL, `${r.rampId}: endpoints differ (${xy} m, ${dz} m)`);
      const link = links.find(l => l.connectionId === r.connectionId);
      assert(link && link.parent.nodeId === a.nodeId && link.child.nodeId === b.nodeId, `${r.rampId}: no graph join`);
      out.graphOk += 1; out.checked += 1; out.maxResidualM = Math.max(out.maxResidualM, dz); out.maxXYM = Math.max(out.maxXYM, xy);
      if (r.status !== S.accepted || !L) continue;
      // Sampled grade from the generated geometry itself (not from the plan record).
      const pts = L.city.network.edges.filter(x => x.ramp === r.rampId).flatMap(x => x.points);
      const allowed = r.allowedGrade; const byS = [];
      const start = pts.reduce((best, p) => (Math.hypot(p.x - pb.x, p.z - pb.z) < Math.hypot(best.x - pb.x, best.z - pb.z) ? p : best), pts[0]);
      // Walk the generated points from the shared edge (nearest unvisited point each time) and measure along the road.
      const left = [...new Map(pts.map(p => [`${p.x.toFixed(3)},${p.z.toFixed(3)}`, p])).values()]; const ordered = [];
      for (let cur = start; cur;) { ordered.push(cur); left.splice(left.indexOf(cur), 1); cur = left.length ? left.reduce((best, p) => (Math.hypot(p.x - cur.x, p.z - cur.z) < Math.hypot(best.x - cur.x, best.z - cur.z) ? p : best)) : null; }
      let run = 0; const along = ordered.map((p, i) => (run += i ? Math.hypot(p.x - ordered[i - 1].x, p.z - ordered[i - 1].z) : 0));
      for (let i = 1; i < ordered.length && along[i - 1] < r.rampLengthM + RAMP_RULES.sampleM - 1e-6; i += 1) { const d = Math.hypot(ordered[i].x - ordered[i - 1].x, ordered[i].z - ordered[i - 1].z); if (d > 1e-6) byS.push((ordered[i].y - ordered[i - 1].y) / d); }
      const maxG = Math.max(...byS.map(Math.abs)); let maxC = 0; for (let i = 1; i < byS.length; i += 1) maxC = Math.max(maxC, Math.abs(byS[i] - byS[i - 1]));
      const ramped = ordered.filter((p, i) => along[i] <= r.rampLengthM + 1e-6);
      const gap = Math.max(...ramped.map(p => Math.abs(p.y - shown(p.x, p.z))));
      assert(maxG <= allowed + 1e-6, `${r.rampId}: sampled grade ${maxG} > ${allowed}`);
      assert(maxC <= RAMP_RULES.maxGradeChangePerSample + 1e-6, `${r.rampId}: grade change ${maxC}`);
      assert(gap <= 0.15, `${r.rampId}: road ${gap} m off the shown ground`);
      assert(Math.abs(ordered[0].y - a.elevation) <= TOL, `${r.rampId}: ramp does not start at the source elevation`);
      out.maxGrade = Math.max(out.maxGrade, maxG); out.maxGradeChange = Math.max(out.maxGradeChange, maxC); out.maxGroundGapM = Math.max(out.maxGroundGapM, gap);
      out.maxGradeByClass[r.roadClass] = Math.max(out.maxGradeByClass[r.roadClass] ?? 0, +maxG.toFixed(4));
    }
  }
  for (const k of ['maxResidualM', 'maxXYM', 'maxGrade', 'maxGradeChange', 'maxGroundGapM']) out[k] = +out[k].toFixed(4);
  return out;
}
const tally = (records, key = r => r.status) => records.reduce((o, r) => { const k = key(r); o[k] = (o[k] ?? 0) + 1; return o; }, {});
function summary(w) {
  const ramps = w.growth.history.flatMap(e => e.ramps ?? []);
  const acc = ramps.filter(r => r.status === S.accepted);
  const len = acc.map(r => r.rampLengthM).sort((a, b) => a - b);
  const vacated = w.growth.history.reduce((s, e) => s + (e.vacatedBuildings?.length ?? 0), 0);
  const built = w.growth.history.reduce((s, e) => s + e.outputs.counts.buildings, 0);
  return {
    chunks: w.chunks.size, events: w.growth.history.length, byStatus: tally(ramps), byKindStatus: tally(ramps, r => `${r.kind}:${r.status}`),
    joins: { parent: w.growth.history.reduce((s, e) => s + e.connections.length, 0), neighbour: w.growth.history.reduce((s, e) => s + e.neighbourConnections.length, 0) },
    unconnectedChildChunks: w.growth.history.filter(e => !e.connections.length).map(e => e.newChunkId),
    rampLengthM: acc.length ? { min: len[0], median: len[len.length >> 1], max: len.at(-1) } : null,
    meanGrade: acc.length ? +(acc.reduce((s, r) => s + r.meanGrade, 0) / acc.length).toFixed(4) : null, maxGrade: acc.length ? Math.max(...acc.map(r => r.maxGrade)) : null,
    terrainConflicts: ramps.filter(r => r.status === S.terrain).length, fillMaxM: acc.length ? Math.max(...acc.map(r => r.fillMaxM)) : null, cutMaxM: acc.length ? Math.max(...acc.map(r => r.cutMaxM)) : null,
    corridorAreaM2: acc.reduce((s, r) => s + r.corridorAreaM2, 0), vacatedBuildings: vacated, vacatedShare: +(vacated / (built + vacated)).toFixed(4),
    grown: Object.fromEntries(CITY_IDS.map(id => [id, w.growth.history.filter(e => e.cityId === id).length])),
    reach: Object.fromEntries(CITY_IDS.map(id => { const r = cityRoadReach(w, id); return [id, `${r.reachableChunks}/${r.chunks}`]; })),
  };
}

// ---------- Part A ----------
if (!browserOnly) {
  const started = Date.now();
  // 1 + 3. Diagnosis and Test B: the G02c-01 run replayed with ramps (baseline 6 %).
  const old = WorldContext.restore(JSON.parse(json(baselineState)));
  const oldLayers = new Map();
  for (const c of [...old.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) oldLayers.set(c.chunkId, old.generateChunk(c.chunkId).layers);
  const w = newWorld(6202); const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', replay: REPLAY });
  const rb = run(w, g, 12, { keep: true });
  assert(!rb.stalled && w.growth.history.length === 12, 'replay did not complete');
  assert(json(w.growth.history.map(e => e.newChunkId)) === json(baselineState.growth.history.map(e => e.newChunkId)), 'replay differs from the G02c-01 run');
  const rows = [];
  for (const e of baselineState.growth.history) {
    const now = w.growth.history.find(x => x.newChunkId === e.newChunkId);
    const child = old.chunks.get(e.newChunkId); const terrainB = createSampler(oldLayers.get(e.newChunkId).terrain.fields).height;
    for (const r of now.ramps) {
      const src = old.chunks.get(r.parentChunkId); const srcSide = r.connectionId.split(':')[2];
      const a = src.outputs.ports[srcSide].find(p => p.position === r.position);
      const b = child.outputs.ports[r.side].filter(p => p.type === 'road').map(p => ({ p, d: Math.abs(p.position - r.position) })).sort((x, y) => x.d - y.d)[0]?.p ?? null;
      const terrainA = createSampler((oldLayers.get(src.chunkId) ?? { terrain: terrainOf(old.cell(src.worldCoordinate.gx, src.worldCoordinate.gy)) }).terrain.fields).height;
      const pa = portPoint(src, srcSide, a.position); const pb = b ? portPoint(child, r.side, b.position) : null;
      const joinedBefore = r.kind === 'parent' ? e.connections.some(c => c.connectionId === r.connectionId) : e.neighbourConnections.some(c => c.connectionId === r.connectionId);
      const unjoinedBefore = r.kind === 'neighbour' ? e.neighbourUnjoined.find(c => c.connectionId === r.connectionId) : null;
      const step = b ? +(b.elevation - a.elevation).toFixed(2) : null;
      rows.push({
        connectionId: r.connectionId, kind: r.kind, cityId: e.cityId, chunkA: src.chunkId, chunkB: e.newChunkId, roadA: `${src.chunkId}:e${a.edgeId}`, roadB: b ? `${e.newChunkId}:e${b.edgeId}` : null,
        endpointA: { x: pa.x, y: a.elevation, z: pa.z }, endpointB: pb ? { x: pb.x, y: b.elevation, z: pb.z } : null, horizontalDistance: pb ? +Math.hypot(pa.x - pb.x, pa.z - pb.z).toFixed(3) : null, elevationDifference: step,
        sourceTerrainElevationA: +terrainA(pa.x, pa.z).toFixed(2), sourceTerrainElevationB: pb ? +terrainB(pb.x, pb.z).toFixed(2) : null, roadElevationA: a.elevation, roadElevationB: b?.elevation ?? null,
        roadClass: a.roadClass, localRoadDirection: { a: a.directionDeg, b: b?.directionDeg ?? null }, availableTransitionLength: r.availableM ?? null,
        existingGraphConnectivity: joinedBefore ? 'joined in G02c-01' : 'not joined', previousRejectionReason: joinedBefore ? null : unjoinedBefore?.reason ?? (step === null ? 'no child road' : `entry step ${step} m > 3 m (G02c-01 rule)`),
        seamIsTheStep: pb ? Math.abs(a.elevation - terrainA(pa.x, pa.z)) < 0.01 && Math.abs(b.elevation - terrainB(pb.x, pb.z)) < 0.01 : null,
        now: { status: r.status, reason: r.reason ?? null, category: diagnosisOf(r), rampLengthM: r.rampLengthM ?? null, maxGrade: r.maxGrade ?? null },
      });
    }
  }
  const was41 = rows.filter(r => r.kind === 'parent' && r.existingGraphConnectivity === 'not joined');
  const was32 = rows.filter(r => r.kind === 'parent' && r.existingGraphConnectivity !== 'not joined');
  assert(was41.length === 41 && was32.length === 32, `historic counts ${was41.length} / ${was32.length}`);
  const seamShare = rows.filter(r => r.seamIsTheStep).length;
  const tb = { summary: summary(w), checks: checkRamps(w, rb.layers) };
  // Plan geometry is unchanged by the ramps: the replayed chunks carry the G02c-01 network, block and parcel signatures.
  for (const e of w.growth.history) { const a = w.chunks.get(e.newChunkId).outputs.signatures; const b = old.chunks.get(e.newChunkId).outputs.signatures; assert(a.network === b.network && a.blocks === b.blocks && a.parcels === b.parcels, `${e.newChunkId}: plan geometry changed`); }
  const maxResidualOld = Math.max(...baselineState.growth.history.flatMap(e => e.connections.map(c => Math.abs(c.elevationStepM))));
  result.node.diagnosis = {
    seed: 6202, rows, roadEndsFacingGrownChunks: rows.length, seamIsTheStep: `${seamShare} of ${rows.filter(r => r.seamIsTheStep !== null).length}`,
    historic41: { byNewStatus: tally(was41, r => r.now.status), byCategory: tally(was41, r => r.now.category), horizontalDistanceMax: Math.max(...was41.map(r => r.horizontalDistance)), stepAbsRange: [Math.min(...was41.map(r => Math.abs(r.elevationDifference))), Math.max(...was41.map(r => Math.abs(r.elevationDifference)))] },
    historic32: { byNewStatus: tally(was32, r => r.now.status), maxResidualBeforeM: maxResidualOld },
    neighbours: { byBefore: tally(rows.filter(r => r.kind === 'neighbour'), r => r.existingGraphConnectivity), byNewStatus: tally(rows.filter(r => r.kind === 'neighbour'), r => r.now.status) },
  };
  result.node.testB = tb;
  console.log(`diagnosis: ${rows.length} road ends; the step equals the terrain seam for ${seamShare}; historic 41 → ${json(result.node.diagnosis.historic41.byNewStatus)}; historic 32 → ${json(result.node.diagnosis.historic32.byNewStatus)}`);
  console.log(`Test B (replay, 6 %): ${json(tb.summary.byStatus)}; joins ${json(tb.summary.joins)}; checks ${json(tb.checks)}`);
  // 2. Test A: the first event (Chicago).
  const first = w.growth.history[0];
  result.node.testA = { seed: 6202, profile: 'baseline', parent: first.parentChunkId, child: first.newChunkId, ramps: first.ramps.map(({ profile, ...r }) => r), profiles: first.ramps.filter(r => r.status === S.accepted).map(r => ({ rampId: r.rampId, roadClass: r.roadClass, allowedGrade: r.allowedGrade, profile: r.profile })), vacatedBuildings: first.vacatedBuildings.length, buildingsKept: first.outputs.counts.buildings, beforeJoins: baselineState.growth.history[0].connections.length, afterJoins: first.connections.length, reach: cityRoadReach(w, 'chicagoGrid').perChunk };
  console.log(`Test A: ${first.parentChunkId} → ${first.newChunkId}: joins ${result.node.testA.beforeJoins} (with height steps) → ${first.connections.length} (continuous); vacated ${first.vacatedBuildings.length}`);
  // 4. Test C.
  result.node.testC = { replay: { baseline: tb.summary } };
  for (const profile of ['conservative', 'permissive']) {
    const wp = newWorld(6202); const gp = new WorldGrowthController(wp, { growthMode: 'road', gradeProfile: profile, replay: REPLAY }); const rp = run(wp, gp, 12, { keep: true });
    assert(!rp.stalled, `${profile} replay stalled`);
    result.node.testC.replay[profile] = { ...summary(wp), checks: checkRamps(wp, rp.layers) };
    console.log(`Test C replay ${profile}: ${json(result.node.testC.replay[profile].byStatus)}`);
  }
  const baseline01 = JSON.parse(await readFile(path.join(evidence, 'road-driven-growth.json'), 'utf8')).node.testB;
  result.node.testC.free = {};
  for (const seed of [6201, 6202, 6203]) {
    result.node.testC.free[seed] = { g02c01Grown: baseline01[seed].cityStates ? Object.fromEntries(Object.entries(baseline01[seed].cityStates).map(([k, v]) => [k, v.grown])) : null };
    for (const profile of ['conservative', 'baseline', 'permissive']) {
      const wf = newWorld(seed); const gf = new WorldGrowthController(wf, { growthMode: 'road', gradeProfile: profile }); const rf = run(wf, gf, 12, { keep: true });
      const s = { ...summary(wf), stalled: rf.stalled ? rf.stalled.reason : null, failedAttempts: tally(wf.growth.roadAttempts, a => a.failureClass), cacheHits: wf.growth.roadAttempts.filter(a => a.cached).length, ms: rf.ms, checks: checkRamps(wf, rf.layers) };
      const front = gf.evaluate(wf.growth.step + 1).lisbonHillCore;
      s.lisbonNext = front.map(c => ({ candidateId: c.candidateId, status: c.status, reason: c.rejectionReason ?? null }));
      result.node.testC.free[seed][profile] = s;
      console.log(`free ${seed} ${profile}: grown ${json(s.grown)}; ramps ${json(s.byStatus)}; failed ${json(s.failedAttempts)}; ${rf.ms} ms`);
    }
  }
  // 5. Determinism, cache, save / load, failure.
  {
    const ref = newWorld(6202); const gr = new WorldGrowthController(ref, { growthMode: 'road', gradeProfile: 'baseline' }); run(ref, gr, 12);
    const tw = newWorld(6202); const gt = new WorldGrowthController(tw, { growthMode: 'road', gradeProfile: 'baseline' }); run(tw, gt, 12, { reverse: true });
    assert(json(strip(tw.growth.history)) === json(strip(ref.growth.history)), 'history depends on the registry order');
    const nc = newWorld(6203); const gn = new WorldGrowthController(nc, { growthMode: 'road', gradeProfile: 'baseline', candidateCache: false }); run(nc, gn, 12);
    const wc = newWorld(6203); const gc = new WorldGrowthController(wc, { growthMode: 'road', gradeProfile: 'baseline' }); run(wc, gc, 12);
    assert(json(wc.growth.history.map(e => [e.newChunkId, e.outputs.signatures])) === json(nc.growth.history.map(e => [e.newChunkId, e.outputs.signatures])), 'the cache changed the result');
    const half = newWorld(6202); const gh = new WorldGrowthController(half, { growthMode: 'road', gradeProfile: 'baseline' }); run(half, gh, 6);
    const saved = JSON.parse(json(half.serialise()));
    assert(saved.growth.gradeProfile === 'baseline', 'grade profile not saved');
    const back = WorldContext.restore(saved);
    for (const c of [...back.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) { const { chunk } = back.generateChunk(c.chunkId); assert(json(chunk.outputs.signatures) === json(chunk.expectedSignatures), `restored ${c.chunkId} differs`); }
    for (const e of back.growth.history) assert(json(back.chunks.get(e.newChunkId).outputs.ramps.records) === json(e.ramps), `restored ramps of ${e.newChunkId} differ`);
    const vc = verifyConnections(back); assert(vc.length === 6 && vc.every(x => x.same), `restored joins differ ${json(vc)}`);
    const gb = new WorldGrowthController(back); assert(gb.adapter.gradeProfile === 'baseline', 'load lost the grade profile');
    run(back, gb, 6);
    assert(json(strip(back.growth.history)) === json(strip(ref.growth.history)), 'save / load / continue differs');
    const inj = newWorld(6202); const gi = new WorldGrowthController(inj, { growthMode: 'road', gradeProfile: 'baseline' });
    const original = inj.generateChunk.bind(inj); let thrown = 0;
    inj.generateChunk = id => { if (inj.chunks.get(id).role === 'growth' && !thrown) { thrown += 1; throw new Error('injected'); } return original(id); };
    const size = inj.chunks.size; const ri = gi.step(); inj.generateChunk = original;
    assert(ri.event.failedAttempts[0].failureClass === FAILURE.generation && inj.chunks.size === size + 1 && inj.growth.history.length === 1, 'failure left state behind');
    result.node.stability = {
      registryOrderReversed: 'identical (seed 6202, 12 steps)', cacheOnOff: { seed: 6203, identicalChunksAndSignatures: true, cacheHits: wc.growth.roadAttempts.filter(a => a.cached).length, attemptsWithCache: wc.growth.roadAttempts.length, attemptsWithout: nc.growth.roadAttempts.length, cacheEntries: Object.keys(wc.growth.candidateCache).length },
      saveLoad: { savedAtStep: 6, chunks: saved.chunks.length, rampRecordsReproduced: true, joinEventsReproduced: vc.length, continuedEqualsUninterrupted: true, cacheEntriesSaved: Object.keys(saved.growth.candidateCache).length },
      failureInjection: { failureClass: ri.event.failedAttempts[0].failureClass, grewInstead: ri.event.newChunkId, leftNoChunk: true },
    };
    console.log(`stability: ${json(result.node.stability)}`);
  }
  // 6. Long run.
  {
    const lw = newWorld(6202); const lg = new WorldGrowthController(lw, { growthMode: 'road', gradeProfile: 'baseline' }); const lr = run(lw, lg, 20, { keep: true });
    const occ = new Set(lw.occupancy.values());
    assert(occ.size === lw.chunks.size, 'long run: duplicate occupation');
    result.node.longRun = { seed: 6202, requestedSteps: 20, steps: lw.growth.history.length, stalled: lr.stalled?.reason ?? null, ms: lr.ms, ...summary(lw), checks: checkRamps(lw, lr.layers) };
    console.log(`long run: ${lw.growth.history.length} steps in ${lr.ms} ms; ${json(result.node.longRun.byStatus)}`);
  }
  result.nodeMs = Date.now() - started;
  await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Part A passed (${result.nodeMs} ms)`);
}

// ---------- Part B ----------
if (!nodeOnly) {
  const { chromium } = await import('playwright-core');
  const host = '127.0.0.1'; const port = 4219; const base = `http://${host}:${port}`; const entry = '/experiments/city-of-cities/';
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
    const off = { morphFronts: false, inheritedRoads: false, connectivity: false, growthFrontier: false, history: false, chunkBorders: true, ownership: true, rampAccepted: false, rampRejected: false, rampSeam: false, rampLabels: false };
    const A = result.node.testA; const b = { screenshots: {} };
    // Fixed camera on the largest accepted seam of Test A.
    const pick = A.ramps.filter(r => r.status === S.accepted).sort((x, y) => Math.abs(y.deltaM) - Math.abs(x.deltaM))[0];
    const open = async (grade, steps) => {
      await page.goto(`${base}${entry}?start=0&growthMode=road${grade ? `&grade=${grade}` : ''}`, { waitUntil: 'networkidle' }); await waitReady();
      await lab(() => window.__originLab.setAutoFit(false));
      await call(x => window.__originLab.generate(x), 6202);
      await lab(r => window.__originLab.roadReplay(r), REPLAY);
      await call(n => window.__originLab.growSteps(n), steps);
    };
    const camera = async () => { const c = (await lab(() => window.__originLab.chunks())).find(x => x.chunkId === A.child); const p = c.worldOrigin; const h = 512; const pt = pick.side === 'minZ' ? { x: pick.position, z: p.z - h } : pick.side === 'maxZ' ? { x: pick.position, z: p.z + h } : pick.side === 'minX' ? { x: p.x - h, z: pick.position } : { x: p.x + h, z: pick.position }; await lab(f => window.__originLab.focusPoint(f.x, f.z, 330), pt); };
    await open(null, 1);
    await lab(l => window.__originLab.setLayers(l), { ...off, connectivity: true }); await camera();
    b.screenshots.before = await shot('g02c-02-chicago-ramp-before.png');
    await open('baseline', 1);
    await lab(l => window.__originLab.setLayers(l), { ...off, connectivity: true }); await camera();
    b.screenshots.after = await shot('g02c-02-chicago-ramp-after.png');
    await lab(l => window.__originLab.setLayers(l), { ...off, rampAccepted: true, rampRejected: true, rampSeam: true, rampLabels: true }); await camera();
    b.screenshots.debug = await shot('g02c-02-chicago-ramp-debug.png');
    await lab(l => window.__originLab.setLayers(l), { ...off, chunkBorders: false, ownership: false }); await camera();
    b.screenshots.noBorders = await shot('g02c-02-chicago-ramp-no-borders-after.png');
    const pageA = await lab(() => window.__originLab.rampEvents()[0].ramps.map(r => [r.rampId, r.status, r.maxGrade ?? null]));
    assert(json(pageA) === json(A.ramps.map(r => [r.rampId, r.status, r.maxGrade ?? null])), 'browser Test A ramps differ from Node');
    // Seed 6202 before / after over the whole replay.
    const region = async () => lab(() => window.__originLab.overview('top'));
    await open(null, 12);
    await lab(l => window.__originLab.setLayers(l), { ...off, connectivity: true }); await region();
    b.screenshots.worldBefore = await shot('g02c-02-seed6202-before.png');
    await open('baseline', 12);
    await lab(l => window.__originLab.setLayers(l), { ...off, connectivity: true, rampAccepted: true, rampRejected: true, rampSeam: true }); await region();
    b.screenshots.worldAfter = await shot('g02c-02-seed6202-after.png');
    const pageB = await lab(() => window.__originLab.rampEvents().flatMap(e => e.ramps.map(r => r.status)));
    const nodeB = Object.entries(result.node.testB.summary.byStatus).sort(); const tallyB = Object.entries(pageB.reduce((o, s) => ({ ...o, [s]: (o[s] ?? 0) + 1 }), {})).sort();
    assert(json(tallyB) === json(nodeB), `browser replay differs ${json(tallyB)}`);
    // Save → reload → load: ramps and joins reproduced.
    await lab(() => window.__originLab.saveLocal());
    await page.goto(`${base}${entry}?start=0`, { waitUntil: 'networkidle' }); await waitReady();
    await lab(() => window.__originLab.setAutoFit(false));
    await call(() => window.__originLab.loadLocal());
    assert(/reproduced/.test(await lab(() => window.__originLab.morphRestore())) && !(await lab(() => window.__originLab.mismatches())).length, 'browser: load did not reproduce the ramps');
    // Long sections of Test A (real profile samples).
    const W = 520; const Hh = 190;
    const charts = A.profiles.map(p => {
      const s = p.profile.map(q => q[0]); const ys = p.profile.flatMap(q => [q[1], q[2]]);
      const x = v => 40 + (v / Math.max(...s)) * (W - 60); const lo = Math.min(...ys) - 0.5; const hi = Math.max(...ys) + 0.5; const y = v => Hh - 30 - ((v - lo) / (hi - lo)) * (Hh - 50);
      const line = k => p.profile.map((q, i) => `${i ? 'L' : 'M'}${x(q[0]).toFixed(1)},${y(q[k]).toFixed(1)}`).join(' ');
      const r = A.ramps.find(q => q.rampId === p.rampId);
      return `<figure style="margin:0"><svg width="${W}" height="${Hh}" style="background:#151a1e"><path d="${line(2)}" stroke="#8a6d4a" stroke-width="3" fill="none"/><path d="${line(1)}" stroke="#3fe0ff" stroke-width="2.5" fill="none"/><text x="40" y="18" fill="#e8ecee" font-size="13">${p.roadClass} · ${r.rampLengthM} m · ${r.startElevation} → ${r.endElevation} m · max ${(r.maxGrade * 100).toFixed(1)} % (limit ${(p.allowedGrade * 100).toFixed(1)} %)</text><text x="40" y="${Hh - 10}" fill="#9aa3a8" font-size="11">0 m (shared edge)</text><text x="${W - 70}" y="${Hh - 10}" fill="#9aa3a8" font-size="11">${Math.max(...s)} m</text><text x="4" y="${y(hi - 0.5) + 4}" fill="#9aa3a8" font-size="11">${(hi - 0.5).toFixed(1)}</text><text x="4" y="${y(lo + 0.5) + 4}" fill="#9aa3a8" font-size="11">${(lo + 0.5).toFixed(1)}</text></svg></figure>`;
    });
    const sheet = await context.newPage(); await sheet.setViewportSize({ width: 1640, height: 900 });
    await sheet.setContent(`<body style="margin:0;padding:24px;background:#0f1215;color:#e8ecee;font:16px 'Segoe UI',Arial"><h2 style="font-weight:400;margin:0 0 4px">G02c-02 · long sections of the accepted ramps, ${A.parent} → ${A.child} (seed 6202, baseline 6 %)</h2><p style="color:#9aa3a8;margin:0 0 14px">cyan: road elevation from the generated network · brown: world terrain of the new chunk under the road · samples every ${RAMP_RULES.sampleM} m · elevation in m</p><div style="display:grid;grid-template-columns:repeat(3,${W}px);gap:14px">${charts.join('')}</div></body>`);
    b.screenshots.longSections = path.relative(root, path.join(shots, 'g02c-02-long-sections.png')).replaceAll('\\', '/');
    await sheet.screenshot({ path: path.join(root, b.screenshots.longSections), fullPage: true });
    b.pageEqualsNode = true; b.saveReloadLoad = true; b.errors = errors;
    assert(!errors.length, `browser errors ${errors.join('; ')}`);
    result.browser = b;
    console.log(`Part B passed: ${json(b.screenshots)}`);
  } finally { await browser?.close(); server.kill(); }
}
await writeFile(recordFile, `${JSON.stringify(result, null, 2)}\n`);
console.log('G02c-02 verification passed. Record: experiments/city-of-cities/evidence/grade-aware-growth.json');
