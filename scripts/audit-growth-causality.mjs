// A City of Cities — P00a Generative Causality Audit (read-only diagnostics; no generator or random call is changed).
// 1. One real growth event, traced stage by stage from the records the code keeps (seed 6202, step 2, the G02c-03a /
//    VIS-01a configuration: road mode, grade baseline, ramps through one junction; gate off).
// 2. Three seeds (6201 / 6202 / 6203), 12 steps each, same configuration: where decisions are made
//    (before generation vs after a whole chunk was generated and discarded), what the fronts and refusals are, and
//    which inputs of a step come from earlier steps (feedback).
// Usage: node --max-old-space-size=8192 scripts/audit-growth-causality.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { DNA_STRATEGY, strategyParams } = await mod('experiments/seed-terrain/networkStrategies.js');
const tally = l => l.reduce((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});
const norm = s => String(s ?? '').replace(/c_-?\d+_-?\d+/g, 'c_#').replace(/-?\d+(\.\d+)?/g, '#').slice(0, 90);
const opts = { growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true };
const newWorld = seed => { const w = new WorldContext({ worldSeed: seed }); w.initialise(); for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id); return w; };
const out = { task: 'P00a generative causality audit', testedAt: new Date().toISOString(), node: process.version, configuration: { ...opts, networkIntegrity: false } };

// Wraps the adapter so every generated attempt is counted (read-only: the call and its result are passed through).
function instrument(g) {
  const log = []; const a = g.adapter; const attempt = a.attempt.bind(a);
  a.attempt = (cand, step) => { const t = Date.now(); const r = attempt(cand, step); log.push({ step, cityId: cand.cityId, candidateId: cand.candidateId, generated: true, ok: !r.failure, failureClass: r.failure?.failureClass ?? null, reason: r.failure?.reason ?? null, ms: Date.now() - t }); return r; };
  return log;
}

// 1. One event, traced.
{
  const w = newWorld(6202); const g = new WorldGrowthController(w, opts); const attempts = instrument(g);
  const s1 = g.step(); const before = { roadEdges: [...w.chunks.values()].reduce((s, c) => s + c.outputs.roadGraph.length, 0), chunks: w.chunks.size };
  const s2 = g.step(); const e = s2.event; const f = g.lastFrontier;
  const man = f.manhattanGrid; const chosen = man.find(c => c.status === 'selected');
  const parent = w.chunks.get(e.parentChunkId); const child = s2.chunk; const net = s2.layers.city.network;
  const ctx = child.generationParameters.growthContext;
  out.event = {
    id: e.growthEventId, seed: 6202, step: 2, cityId: e.cityId, parent: e.parentChunkId, child: e.newChunkId, previousEvent: s1.event.growthEventId,
    environment: { cell: w.cell(e.targetCoordinate.gx, e.targetCoordinate.gy), probe: (({ edges, fit, ...p }) => p)(w.probe(e.targetCoordinate.gx, e.targetCoordinate.gy)) },
    origin: w.cities.get('manhattanGrid').placementReason,
    dna: { strategy: DNA_STRATEGY.manhattanGrid, networkParams: (({ widths, loops, ...p }) => p)(strategyParams('manhattanGrid')), growthDNA: g.dna.manhattanGrid },
    scheduler: { bids: e.growthReason.bids, cityOrder: e.growthReason.bids.filter(b => b.bid !== null).sort((a, b) => b.bid - a.bid).map(b => b.cityId) },
    frontier: { manhattan: { candidates: man.length, eligible: man.filter(c => c.status !== 'rejected').length, rejected: tally(man.filter(c => c.status === 'rejected').map(c => norm(c.rejectionReason))) }, allCities: Object.fromEntries(Object.entries(f).map(([k, l]) => [k, tally(l.map(c => c.status))])) },
    chosen: { candidateId: chosen.candidateId, score: chosen.score, groups: chosen.groups, terms: chosen.terms, roadFronts: chosen.roadFronts.length, usableRoadFronts: chosen.roadFronts.filter(r => r.usable).length, refusedFronts: chosen.refusedFronts.length, sourceRoadId: chosen.sourceRoadId },
    attemptsThisStep: attempts.filter(a => a.step === 2),
    generationInput: { side: ctx.side, entryPorts: ctx.entryPorts.length, grid: ctx.grid ? { axisDeg: ctx.grid.axisDeg, primarySpacing: ctx.grid.primarySpacing, secondarySpacing: ctx.grid.secondarySpacing, fromChunkId: ctx.grid.fromChunkId } : null, centre: ctx.centre, verticalEntries: ctx.vertical?.entries.length ?? 0, terrainSeed: child.terrainSeed, urbanSeed: child.generationParameters.urbanSeed },
    generated: { edges: net.edges.length, sources: tally(net.edges.map(x => x.source)), gridCounts: net.gridCounts, removed: net.removed, counts: child.outputs.counts },
    joins: { parent: e.connections.length, unmatchedEntries: e.localAdaptations.unmatchedEntries.length, newPortsOnSharedEdge: e.localAdaptations.newPortsOnSharedEdge.length, neighbour: e.neighbourConnections.length },
    ramps: tally(e.ramps.map(r => r.status)), vacatedBuildings: e.vacatedBuildings.length, impact: child.outputs.ramps.impact,
    feedback: { roadEdgesBefore: before.roadEdges, roadEdgesAfter: [...w.chunks.values()].reduce((s, c) => s + c.outputs.roadGraph.length, 0), newFronts: Object.values(child.outputs.ports).flat().filter(p => p.type === 'road').length, manhattanGrownCount: g.grownCount('manhattanGrid'), nextBid: g.evaluate(3) && null },
  };
  console.log(`event ${out.event.id}: ${out.event.parent} → ${out.event.child}; ${out.event.attemptsThisStep.length} generated attempt(s) this step; ${out.event.generated.edges} edges, sources ${JSON.stringify(out.event.generated.sources)}; joins ${out.event.joins.parent}`);
}

// 2. Three seeds.
out.seeds = {};
for (const seed of [6201, 6202, 6203]) {
  const w = newWorld(seed); const g = new WorldGrowthController(w, opts); const attempts = instrument(g);
  const pre = []; let stalled = null; const t0 = Date.now();
  for (let i = 0; i < 12; i += 1) {
    const r = g.step(); const f = g.lastFrontier;
    for (const [cityId, list] of Object.entries(f)) for (const c of list) if (c.status === 'rejected' && !/^not the planned/.test(c.rejectionReason ?? '')) pre.push({ step: i + 1, cityId, reason: norm(c.rejectionReason), failureClass: c.failureClass ?? null });
    if (r.stalled) { stalled = { step: r.stalled.step, reason: r.stalled.reason }; break; }
  }
  const post = attempts.filter(a => !a.ok);
  out.seeds[seed] = {
    steps: w.growth.history.length, stalled, ms: Date.now() - t0, grown: tally(w.growth.history.map(e => e.cityId)),
    frontSources: tally(w.growth.history.map(e => `${DNA_STRATEGY[e.cityId]} road ports (${e.sourceRoadIds.length} source road(s) per event, mean)`)),
    preGeneration: { refusals: pre.length, byReason: tally(pre.map(p => p.reason)), byClass: tally(pre.map(p => p.failureClass ?? 'none')) },
    postGeneration: { generatedChunks: attempts.length, discarded: post.length, committed: attempts.filter(a => a.ok).length, byReason: tally(post.map(a => norm(a.reason))), msDiscarded: post.reduce((s, a) => s + a.ms, 0), msCommitted: attempts.filter(a => a.ok).reduce((s, a) => s + a.ms, 0) },
    cachedRefusals: w.growth.roadAttempts.filter(a => a.cached).length,
    connection: { parentJoins: w.growth.history.reduce((s, e) => s + e.connections.length, 0), neighbourJoins: w.growth.history.reduce((s, e) => s + (e.neighbourConnections?.length ?? 0), 0), unmatchedEntries: w.growth.history.reduce((s, e) => s + e.localAdaptations.unmatchedEntries.length, 0), rampStatuses: tally(w.growth.history.flatMap(e => e.ramps.map(r => r.status))), vacatedBuildings: w.growth.history.reduce((s, e) => s + e.vacatedBuildings.length, 0) },
    generatedSources: tally(w.growth.history.flatMap(e => Object.keys(e.inheritedRules?.grid === undefined ? {} : { [typeof e.inheritedRules.grid === 'string' ? 'entry ports only (organic)' : 'grid anchor inherited']: 1 }))),
  };
  const s = out.seeds[seed];
  console.log(`seed ${seed}: ${s.steps} steps${stalled ? ` (stalled ${stalled.step})` : ''}; refusals before generation ${s.preGeneration.refusals}; generated chunks ${s.postGeneration.generatedChunks} (${s.postGeneration.discarded} discarded after generation, ${s.postGeneration.msDiscarded} ms); cached ${s.cachedRefusals}`);
}
await writeFile(path.join(root, 'experiments/city-of-cities/evidence/growth-causality-audit.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log('P00a record: experiments/city-of-cities/evidence/growth-causality-audit.json');
