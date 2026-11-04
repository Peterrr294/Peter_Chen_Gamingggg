// A City of Cities — G02c-R Road Growth Milestone Review: measurements (Node). No generator is changed.
// 1. historic comparison on seed 6202: the G02c-01 run (no ramps) and the same 12 events with ramps through a junction,
//    by one definition of "aligned but not joined" (same-city shared edge, road ends ≤ 0.5 m apart, no recorded join)
// 2. autonomous growth on 6201 / 6202 / 6203 with ramps through one junction, budget 60 steps (milestones 12 / 30 / 60):
//    per city road graph (nodes, edges, components, chunks reachable from the core by Dijkstra), shared-edge joins,
//    unjoined aligned ends, candidate and corridor pass rates, cache, identity, occupancy, fabric checks
// 3. determinism (registry order reversed) and save / load / continue at 15 → 30 on seed 6202
// Usage: node --max-old-space-size=8192 scripts/review-road-growth.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { cityRoadReach } = await mod('experiments/city-of-cities/RoadGrowthFrontAdapter.js');
const { DIRECTIONS } = await mod('experiments/city-of-cities/growthDNA.js');
const evidence = path.join(root, 'experiments/city-of-cities/evidence');
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const strip = h => h.map(({ ms, failedAttempts, ...e }) => ({ ...e, failedAttempts: failedAttempts.map(({ cached, ...f }) => f) }));
const tally = l => l.reduce((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});
const newWorld = seed => { const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise(); assert(!rep.failures.length, `seed ${seed}`); for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id); return w; };
const out = { task: 'G02c-R road growth milestone review: measurements', testedAt: new Date().toISOString(), node: process.version };

// Same-city shared edges: road ends facing each other, joined or not (one definition for every run).
function sharedEdges(w) {
  const joins = new Set(w.growth.history.flatMap(e => [...(e.connections ?? []), ...(e.neighbourConnections ?? [])]).map(c => [`${c.parent.chunkId}:${c.parent.nodeId}`, `${c.child.chunkId}:${c.child.nodeId}`].sort().join('~')));
  const res = { edges: 0, aligned: 0, joined: 0, unjoinedAligned: 0, unmatchedEnds: 0, byCity: {} };
  for (const a of w.chunks.values()) for (const [, [dx, dy, sideA, sideB]] of Object.entries(DIRECTIONS)) {
    const b = w.chunkAt(a.worldCoordinate.gx + dx, a.worldCoordinate.gy + dy);
    if (!b || b.cityId !== a.cityId || a.chunkId > b.chunkId || !a.outputs || !b.outputs) continue;
    res.edges += 1; const c = res.byCity[a.cityId] ??= { edges: 0, aligned: 0, joined: 0, unjoinedAligned: 0 }; c.edges += 1;
    const pa = a.outputs.ports[sideA].filter(p => p.type === 'road'); const pb = b.outputs.ports[sideB].filter(p => p.type === 'road');
    const used = new Set();
    for (const p of pa) {
      const q = pb.map((x, i) => ({ x, i, d: Math.abs(x.position - p.position) })).filter(m => !used.has(m.i) && m.d <= 0.5).sort((m, n) => m.d - n.d)[0];
      if (!q) { res.unmatchedEnds += 1; continue; }
      used.add(q.i); res.aligned += 1; c.aligned += 1;
      const k = [`${a.chunkId}:${p.nodeId}`, `${b.chunkId}:${q.x.nodeId}`].sort().join('~');
      if (joins.has(k)) { res.joined += 1; c.joined += 1; } else { res.unjoinedAligned += 1; c.unjoinedAligned += 1; }
    }
    res.unmatchedEnds += pb.length - used.size;
  }
  return res;
}
// Road graph of one city: nodes, edges, components (chunk graphs + recorded joins).
function cityGraph(w, cityId) {
  const chunks = [...w.chunks.values()].filter(c => c.cityId === cityId && c.outputs);
  const adj = new Map(); let edges = 0; const add = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } };
  for (const c of chunks) for (const [f, t] of c.outputs.roadGraph) { add(`${c.chunkId}:${f}`, `${c.chunkId}:${t}`); edges += 1; }
  let joins = 0; for (const e of w.growth.history.filter(x => x.cityId === cityId)) for (const l of [...(e.connections ?? []), ...(e.neighbourConnections ?? [])]) { add(`${l.parent.chunkId}:${l.parent.nodeId}`, `${l.child.chunkId}:${l.child.nodeId}`); joins += 1; }
  const seen = new Set(); let comps = 0; for (const n of adj.keys()) { if (seen.has(n)) continue; comps += 1; const q = [n]; seen.add(n); while (q.length) { const x = q.pop(); for (const y of adj.get(x)) if (!seen.has(y)) { seen.add(y); q.push(y); } } }
  const reach = cityRoadReach(w, cityId);
  return { chunks: chunks.length, nodes: adj.size, edges, joins, components: comps, reachableChunks: reach.reachableChunks, coreRoadGraphEdges: w.chunks.get(w.cities.get(cityId).originChunkId).outputs.roadGraph.length };
}
// Fabric of a generated chunk: abnormal parcels, buildings without frontage, coverage with and without the corridor.
function fabric(chunk, layers) {
  const parcels = layers.city.parcels.parcels ?? []; const byId = new Map(parcels.map(p => [p.id, p]));
  const abnormal = parcels.filter(p => p.area < 30 || !(p.frontages ?? []).length).length;
  const noFrontage = (layers.city.buildings.buildings ?? []).filter(b => !(byId.get(b.parcelId)?.frontages ?? []).length).length;
  const imp = chunk.outputs.ramps?.impact ?? null; const built = chunk.outputs.areas.builtFootprintM2; const parcelM2 = chunk.outputs.areas.parcelM2;
  return { parcels: parcels.length, abnormalParcels: abnormal, buildingsWithoutFrontage: noFrontage, coverageAfter: parcelM2 ? +(built / parcelM2).toFixed(4) : null, coverageBefore: parcelM2 ? +((built + (imp?.excludedFootprintM2 ?? 0)) / parcelM2).toFixed(4) : null, impact: imp };
}

// 1. Historic comparison on 6202.
{
  const old = WorldContext.restore(JSON.parse(await readFile(path.join(evidence, 'world-6202-g02c-step12-state.json'), 'utf8')));
  for (const c of [...old.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) old.generateChunk(c.chunkId);
  const replay = old.growth.history.map(e => ({ cityId: e.cityId, gx: e.targetCoordinate.gx, gy: e.targetCoordinate.gy, parentChunkId: e.parentChunkId }));
  const w = newWorld(6202); const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', replay, junctionRamps: true }); for (let i = 0; i < 12; i += 1) g.step();
  const g2 = newWorld(6202); const gg = new WorldGrowthController(g2, { growthMode: 'road', gradeProfile: 'baseline', replay }); for (let i = 0; i < 12; i += 1) gg.step();
  out.historic6202 = {
    definition: 'same-city shared edge; road ends of both sides within 0.5 m; joined = a recorded join between exactly those two nodes',
    g02c01: { config: 'G02c-01 road mode, joins allowed with steps up to 3 m', ...sharedEdges(old) },
    g02c02Replay: { config: 'same 12 events, 6 % ramp plan', ...sharedEdges(g2) },
    g02c03aReplay: { config: 'same 12 events, 6 % ramp plan, ramps through one junction', ...sharedEdges(w) },
    note: 'the 12 target cells and parents are identical in all three; the networks of the grown chunks are identical (same anchors), so the road ends compare one to one',
  };
  console.log(`historic 6202: aligned / joined / unjoined: G02c-01 ${out.historic6202.g02c01.aligned}/${out.historic6202.g02c01.joined}/${out.historic6202.g02c01.unjoinedAligned}; G02c-02 ${out.historic6202.g02c02Replay.aligned}/${out.historic6202.g02c02Replay.joined}/${out.historic6202.g02c02Replay.unjoinedAligned}; G02c-03a ${out.historic6202.g02c03aReplay.aligned}/${out.historic6202.g02c03aReplay.joined}/${out.historic6202.g02c03aReplay.unjoinedAligned}`);
}
// 2. Autonomous growth.
out.runs = {};
for (const seed of [6201, 6202, 6203]) {
  const w = newWorld(seed); const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true });
  const sigs = new Map([...w.chunks.values()].map(c => [c.chunkId, json(c.outputs.signatures)]));
  const milestones = {}; let changed = 0; let stalled = null; const fab = []; const t0 = Date.now(); let candidates = 0; let eligible = 0;
  for (let i = 0; i < 60; i += 1) {
    const r = g.step();
    const fr = Object.values(g.lastFrontier ?? {}).flat(); candidates += fr.length; eligible += fr.filter(c => c.status !== 'rejected').length;
    if (r.stalled) { stalled = { step: r.stalled.step, reason: r.stalled.reason, cities: Object.fromEntries(Object.entries(r.stalled.cities).map(([k, v]) => [k, v.rejectionReasons])) }; break; }
    for (const [id, s] of sigs) if (json(w.chunks.get(id).outputs.signatures) !== s) changed += 1;
    sigs.set(r.event.newChunkId, json(r.chunk.outputs.signatures));
    assert(r.chunk.cityId === w.chunks.get(r.event.parentChunkId).cityId, 'city identity');
    fab.push({ chunk: r.event.newChunkId, cityId: r.event.cityId, ...fabric(r.chunk, r.layers) });
    if ([12, 30, 60].includes(w.growth.step)) milestones[w.growth.step] = { chunks: w.chunks.size, ms: Date.now() - t0, grown: tally(w.growth.history.map(e => e.cityId)) };
  }
  const occ = [...w.occupancy.values()]; assert(new Set(occ).size === occ.length, 'duplicate occupancy');
  const ramps = w.growth.history.flatMap(e => e.ramps);
  const cities = Object.fromEntries([...w.cities.keys()].sort().map(id => [id, { grown: w.growth.history.filter(e => e.cityId === id).length, ...cityGraph(w, id) }]));
  const next = g.evaluate(w.growth.step + 1);
  const stops = Object.fromEntries(Object.entries(next).map(([id, list]) => [id, tally(list.filter(c => c.status === 'rejected').map(c => (c.rejectionReason ?? '').replace(/-?[0-9.]+/g, '#').slice(0, 70)))]));
  const sum = k => fab.reduce((s, x) => s + (x.impact?.[k] ?? 0), 0);
  out.runs[seed] = {
    budget: 60, steps: w.growth.history.length, stalled, ms: Date.now() - t0, milestones, cities, nextStepRefusals: stops,
    sharedEdges: sharedEdges(w), parentJoinSuccess: `${w.growth.history.filter(e => e.connections.length).length} of ${w.growth.history.length} events`,
    rampStatuses: tally(ramps.map(r => r.status)), throughJunction: ramps.filter(r => r.through === 'junction').length, junctionUnresolved: ramps.filter(r => r.status === 'junctionConstraint').length,
    candidatePassRate: candidates ? +(eligible / candidates).toFixed(3) : null, rampAcceptRate: ramps.length ? +(ramps.filter(r => r.status === 'accepted' || r.status === 'flush').length / ramps.length).toFixed(3) : null,
    failedAttempts: tally(w.growth.roadAttempts.map(a => a.failureClass)), cacheHits: w.growth.roadAttempts.filter(a => a.cached).length,
    committedChunksChanged: changed, duplicateOccupancy: 0,
    fabric: { chunks: fab.length, abnormalParcels: fab.reduce((s, x) => s + x.abnormalParcels, 0), parcels: fab.reduce((s, x) => s + x.parcels, 0), buildingsWithoutFrontage: fab.reduce((s, x) => s + x.buildingsWithoutFrontage, 0), committedBuildingsAffected: sum('committedBuildingsAffected'), excluded: sum('newBuildingCandidatesExcluded'), candidates: sum('candidatesBefore'), excludedFootprintM2: sum('excludedFootprintM2'), corridorAreaM2: sum('corridorAreaM2'), blockAreaAffectedM2: sum('blockAreaAffectedM2'), parcelAreaAffectedM2: sum('parcelAreaAffectedM2'), coverageBeforeMean: +(fab.reduce((s, x) => s + (x.coverageBefore ?? 0), 0) / Math.max(1, fab.length)).toFixed(4), coverageAfterMean: +(fab.reduce((s, x) => s + (x.coverageAfter ?? 0), 0) / Math.max(1, fab.length)).toFixed(4), worstChunk: [...fab].sort((a, b) => (b.impact?.newBuildingCandidatesExcluded ?? 0) - (a.impact?.newBuildingCandidatesExcluded ?? 0))[0] ?? null },
  };
  if (seed === 6202) await writeFile(path.join(evidence, `world-6202-g02c-review-state.json`), `${json(w.serialise())}\n`);
  console.log(`run ${seed}: ${w.growth.history.length} steps${stalled ? ` (stalled at ${stalled.step})` : ''}; grown ${json(Object.fromEntries(Object.entries(cities).map(([k, v]) => [k, v.grown])))}; shared edges aligned / joined / unjoined ${out.runs[seed].sharedEdges.aligned}/${out.runs[seed].sharedEdges.joined}/${out.runs[seed].sharedEdges.unjoinedAligned}; components ${json(Object.fromEntries(Object.entries(cities).map(([k, v]) => [k, `${v.components} comp, ${v.reachableChunks}/${v.chunks}`])))}; ${out.runs[seed].ms} ms`);
}
// 3. Determinism and save / load at 15 → 30.
{
  const a = newWorld(6202); const ga = new WorldGrowthController(a, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true }); for (let i = 0; i < 30; i += 1) if (ga.step().stalled) break;
  const b = newWorld(6202); const gb = new WorldGrowthController(b, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true }); for (let i = 0; i < 30; i += 1) { b.chunks = new Map([...b.chunks].reverse()); if (gb.step().stalled) break; }
  const sameOrder = json(strip(a.growth.history)) === json(strip(b.growth.history));
  const h = newWorld(6202); const gh = new WorldGrowthController(h, { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true }); for (let i = 0; i < 15; i += 1) gh.step();
  const back = WorldContext.restore(JSON.parse(json(h.serialise())));
  let sigOk = true; for (const c of [...back.chunks.values()].sort((x, y) => x.growthStep - y.growthStep)) { const { chunk } = back.generateChunk(c.chunkId); if (json(chunk.outputs.signatures) !== json(chunk.expectedSignatures)) sigOk = false; }
  const gr = new WorldGrowthController(back); for (let i = 0; i < 15; i += 1) if (gr.step().stalled) break;
  const sameLoad = json(strip(back.growth.history)) === json(strip(a.growth.history));
  out.stability = { seed: 6202, steps: 30, registryOrderReversedIdentical: sameOrder, saveAt15SignaturesReproduced: sigOk, continuedTo30EqualsUninterrupted: sameLoad };
  console.log(`stability: ${json(out.stability)}`);
}
await writeFile(path.join(evidence, 'road-growth-review.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log('measurements written: experiments/city-of-cities/evidence/road-growth-review.json');
