// A City of Cities — G02c-R1 Network Integrity Gate: Node verification.
// 1. Diagnosis: every road piece the city root cannot reach in the G02c-R runs without the gate (6202 60-step state;
//    6203 regrown to its stall), classified water / slope / orphan with the generator's own land rule.
// 2. Before / after: free growth 6201 / 6202 / 6203 with the gate off and on (budget 30, milestones 12 and 30); grade
//    baseline, ramps through one junction (the G02c-R configuration).
// 3. Determinism (registry order reversed) and save at 15 → load → continue to 30, with the gate on (6202).
// Usage: node --max-old-space-size=12288 scripts/verify-network-integrity.mjs [--budget 30]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const { analyseChunk, cityRoot, networkIntegrityReport, rootedSides } = await mod('experiments/city-of-cities/NetworkIntegrity.js');
const evidence = path.join(root, 'experiments/city-of-cities/evidence');
const budget = Number(process.argv[process.argv.indexOf('--budget') + 1]) || 30;
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = v => JSON.stringify(v);
const tally = l => l.reduce((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});
const strip = h => h.map(({ ms, failedAttempts, ...e }) => ({ ...e, failedAttempts: failedAttempts.map(({ cached, ...f }) => f) }));
const newWorld = seed => { const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise(); assert(!rep.failures.length, `seed ${seed}`); for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id); return w; };
const opts = gate => ({ growthMode: 'road', gradeProfile: 'baseline', junctionRamps: true, ...(gate ? { networkIntegrity: true } : {}) });
const out = { task: 'G02c-R1 network integrity gate', testedAt: new Date().toISOString(), node: process.version, budget };
// --long6202: one gate-on run of seed 6202 with the G02c-R budget (60), for the before / after evidence only.
if (process.argv.includes('--long6202')) {
  const w = newWorld(6202); const g = new WorldGrowthController(w, opts(true)); const t0 = Date.now(); let stalled = null;
  for (let i = 0; i < 60; i += 1) { const r = g.step(); if (r.stalled) { stalled = r.stalled.step; break; } }
  const rep = networkIntegrityReport(w);
  const long = {
    task: 'G02c-R1 long run (evidence)', seed: 6202, budget: 60, steps: w.growth.history.length, stalled, ms: Date.now() - t0, grown: tally(w.growth.history.map(e => e.cityId)),
    report: Object.fromEntries(Object.entries(rep).filter(([, x]) => x.chunks > 1)),
    gateRefusals: w.growth.roadAttempts.filter(a => a.integrity).map(a => ({ step: a.step, candidateId: a.candidateId, reason: a.reason, cached: Boolean(a.cached) })),
    accepted: tally(w.growth.history.map(e => e.networkIntegrity?.result)),
    geographicAccepted: w.growth.history.filter(e => e.networkIntegrity?.result === 'acceptedWithGeographicIsolation').map(e => ({ step: e.step, chunk: e.newChunkId, components: e.networkIntegrity.components.filter(c => !c.rootReachable).map(c => ({ componentId: c.componentId, class: c.class, lengthM: c.lengthM })) })),
  };
  for (const [id, x] of Object.entries(rep)) assert(x.orphanLengthM === 0 && (x.unclassifiedLengthM === 0 || x.chunks === 1), `${id}: orphan or unclassified road committed`);
  await writeFile(path.join(evidence, 'world-6202-g02c-r1-long-state.json'), `${json(w.serialise())}\n`);
  await writeFile(path.join(evidence, 'network-integrity-long.json'), `${JSON.stringify(long, null, 2)}\n`);
  console.log(`long 6202 gate on: ${long.steps} steps${stalled ? ` (stalled ${stalled})` : ''}; ${json(Object.fromEntries(Object.entries(long.report).map(([k, x]) => [k, `${x.rootReachableRatio} (${x.disconnectedComponents})`])))}; refusals ${long.gateRefusals.length}; ${long.ms} ms`);
  process.exit(0);
}

// Every unreachable piece of a world, classified from regenerated layers (generation is deterministic; outputs equal).
function classifyWorld(w, cities) {
  const report = networkIntegrityReport(w); const rows = [];
  for (const cityId of cities) {
    const r = cityRoot(w, cityId);
    const byChunk = new Map(); for (const p of report[cityId].pieces) byChunk.set(p.chunkId, [...(byChunk.get(p.chunkId) ?? []), p]);
    for (const [chunkId] of [...byChunk].sort()) {
      const { chunk, layers } = w.generateChunk(chunkId);
      const ev = w.growth.history.find(e => e.newChunkId === chunkId);
      const fields = layers.worldTerrain.fields; let water = 0; for (const v of fields.waterMask) water += v;
      for (const c of analyseChunk(chunk, layers.city.network, fields, r.reach, rootedSides(w, chunk, r.reach)).filter(x => !x.rootReachable)) rows.push({
        componentId: c.componentId, cityId, chunkId, growthStep: chunk.growthStep, parentEvent: ev?.growthEventId ?? (chunk.role === 'core' ? 'core (G01 origin)' : null), parentChunkId: chunk.parentChunkId,
        nodeCount: c.nodeCount, edgeCount: c.edges, lengthM: c.lengthM, roadClasses: c.roadClasses, sources: c.sources, boundaryPorts: c.boundaryPorts,
        landform: layers.city.network.landform, chunkWaterShare: +(water / fields.waterMask.length).toFixed(3), maxSlopeDeg: layers.city.network.params.maxSlopeDeg,
        reachableFromCore: false, class: c.class, reason: c.reason,
      });
    }
  }
  return { report, rows };
}
const summary = (rep, ids) => Object.fromEntries(ids.map(id => { const { pieces, ...x } = rep[id]; return [id, x]; }));

// 1. Diagnosis of the G02c-R runs (gate off).
{
  const w = WorldContext.restore(JSON.parse(await readFile(path.join(evidence, 'world-6202-g02c-review-state.json'), 'utf8')));
  for (const c of [...w.chunks.values()].sort((a, b) => a.growthStep - b.growthStep)) w.generateChunk(c.chunkId);
  const d6202 = classifyWorld(w, ['manhattanGrid', 'chicagoGrid', 'fezOrganicCore']);
  const w3 = newWorld(6203); const g3 = new WorldGrowthController(w3, opts(false)); for (let i = 0; i < 60; i += 1) if (g3.step().stalled) break;
  const d6203 = classifyWorld(w3, ['manhattanGrid', 'chicagoGrid']);
  out.diagnosis = {
    6202: { steps: w.growth.history.length, cities: summary(d6202.report, ['manhattanGrid', 'chicagoGrid', 'fezOrganicCore']), pieces: d6202.rows, classes: tally(d6202.rows.map(r => r.class)) },
    6203: { steps: w3.growth.history.length, cities: summary(d6203.report, ['manhattanGrid', 'chicagoGrid']), pieces: d6203.rows, classes: tally(d6203.rows.map(r => r.class)) },
  };
  for (const s of [6202, 6203]) console.log(`diagnosis ${s}: ${out.diagnosis[s].pieces.length} unreachable pieces ${json(out.diagnosis[s].classes)}; by chunk ${json(tally(out.diagnosis[s].pieces.map(p => `${p.cityId.slice(0, 4)} ${p.chunkId}`)))}`);
}

// 2. Before / after.
out.runs = {};
for (const seed of [6201, 6202, 6203]) for (const gate of [false, true]) {
  const w = newWorld(seed); const g = new WorldGrowthController(w, opts(gate)); const t0 = Date.now();
  const milestones = {}; const sigs = new Map([...w.chunks.values()].map(c => [c.chunkId, json(c.outputs.signatures)])); let changed = 0; let stalled = null;
  const built = { blocks: 0, parcels: 0, buildings: 0, roadKm: 0 };
  for (let i = 0; i < budget; i += 1) {
    const r = g.step();
    if (r.stalled) { stalled = { step: r.stalled.step, reasons: tally(r.stalled.attempts.map(a => a.reason.replace(/[0-9.]+/g, '#').slice(0, 90))) }; break; }
    for (const [id, s] of sigs) if (json(w.chunks.get(id).outputs.signatures) !== s) changed += 1;
    sigs.set(r.event.newChunkId, json(r.chunk.outputs.signatures));
    assert(r.chunk.cityId === w.chunks.get(r.event.parentChunkId).cityId, 'city identity');
    const k = r.chunk.outputs.counts; built.blocks += k.blocks; built.parcels += k.parcels; built.buildings += k.buildings; built.roadKm += k.roadKm;
    if ([12, 30].includes(w.growth.step)) {
      const rep = networkIntegrityReport(w); const attempts = w.growth.roadAttempts; const fresh = attempts.filter(a => !a.cached);
      const gateRefusals = fresh.filter(a => /^network integrity/.test(a.reason));
      milestones[w.growth.step] = {
        ms: Date.now() - t0, grown: tally(w.growth.history.map(e => e.cityId)), built: { ...built, roadKm: +built.roadKm.toFixed(2) },
        cities: summary(rep, Object.keys(rep).filter(id => rep[id].chunks > 1)),
        generatedAttempts: fresh.length + w.growth.history.length, gateRefusals: gateRefusals.length, cachedRefusals: attempts.length - fresh.length,
        gateRejectionRate: +(gateRefusals.length / Math.max(1, fresh.length + w.growth.history.length)).toFixed(3), validCommitRate: +(w.growth.history.length / Math.max(1, fresh.length + w.growth.history.length)).toFixed(3),
        accepted: tally(w.growth.history.map(e => e.networkIntegrity?.result ?? 'not checked')),
      };
    }
  }
  const occ = [...w.occupancy.values()]; assert(new Set(occ).size === occ.length, 'duplicate occupancy');
  const rep = networkIntegrityReport(w);
  const refusals = w.growth.roadAttempts.filter(a => a.integrity).map(a => ({ step: a.step, cityId: a.cityId, candidateId: a.candidateId, reason: a.reason, components: a.integrity.components.map(c => ({ componentId: c.componentId, class: c.class, lengthM: c.lengthM, reason: c.reason })) }));
  const geographicAccepted = w.growth.history.filter(e => e.networkIntegrity?.result === 'acceptedWithGeographicIsolation').map(e => ({ step: e.step, chunk: e.newChunkId, cityId: e.cityId, components: e.networkIntegrity.components.filter(c => !c.rootReachable).map(c => ({ componentId: c.componentId, class: c.class, lengthM: c.lengthM, reason: c.reason })) }));
  out.runs[`${seed}-${gate ? 'gate' : 'off'}`] = { seed, gate, steps: w.growth.history.length, stalled, ms: Date.now() - t0, milestones, final: summary(rep, Object.keys(rep)), refusals, geographicAccepted, committedChunksChanged: changed };
  if (gate && seed === 6202) await writeFile(path.join(evidence, 'world-6202-g02c-r1-state.json'), `${json(w.serialise())}\n`);
  const m = Object.entries(rep).filter(([, x]) => x.chunks > 1).map(([id, x]) => `${id.slice(0, 4)} ${x.rootReachableRatio} (${x.disconnectedComponents} pieces)`).join(', ');
  console.log(`run ${seed} gate ${gate ? 'on ' : 'off'}: ${w.growth.history.length} steps${stalled ? ` (stalled ${stalled.step})` : ''}; root-reachable ${m}; gate refusals ${refusals.length}; geographic accepted ${geographicAccepted.length}; changed ${changed}; ${Date.now() - t0} ms`);
}
// Hard checks: with the gate on, no committed piece is an orphan, and every new chunk reaches the root.
for (const [k, r] of Object.entries(out.runs).filter(([, r]) => r.gate)) {
  for (const [id, c] of Object.entries(r.final)) assert(c.orphanLengthM === 0 && c.unclassifiedLengthM === 0 || c.chunks === 1, `${k} ${id}: orphan ${c.orphanLengthM} m, unclassified ${c.unclassifiedLengthM} m`);
  assert(r.committedChunksChanged === 0, `${k}: committed chunks changed`);
}

// 3. Determinism and save / load with the gate on.
{
  const a = newWorld(6202); const ga = new WorldGrowthController(a, opts(true)); for (let i = 0; i < 30; i += 1) if (ga.step().stalled) break;
  const b = newWorld(6202); const gb = new WorldGrowthController(b, opts(true)); for (let i = 0; i < 30; i += 1) { b.chunks = new Map([...b.chunks].reverse()); if (gb.step().stalled) break; }
  const h = newWorld(6202); const gh = new WorldGrowthController(h, opts(true)); for (let i = 0; i < 15; i += 1) gh.step();
  const back = WorldContext.restore(JSON.parse(json(h.serialise())));
  let sigOk = true; for (const c of [...back.chunks.values()].sort((x, y) => x.growthStep - y.growthStep)) { const { chunk } = back.generateChunk(c.chunkId); if (json(chunk.outputs.signatures) !== json(chunk.expectedSignatures)) sigOk = false; }
  const reportAt15 = json(networkIntegrityReport(h)) === json(networkIntegrityReport(back));
  const gr = new WorldGrowthController(back); const optionRestored = gr.adapter.networkIntegrity === true;
  for (let i = 0; i < 15; i += 1) if (gr.step().stalled) break;
  out.stability = {
    seed: 6202, steps: a.growth.history.length,
    registryOrderReversedIdentical: json(strip(a.growth.history)) === json(strip(b.growth.history)),
    saveAt15SignaturesReproduced: sigOk, optionRestored, integrityReportReproducedAt15: reportAt15,
    continuedTo30EqualsUninterrupted: json(strip(back.growth.history)) === json(strip(a.growth.history)),
    rejectionHistoryEqual: json(back.growth.roadAttempts.map(({ cached, ...x }) => x)) === json(a.growth.roadAttempts.map(({ cached, ...x }) => x)),
    finalReportEqual: json(networkIntegrityReport(back)) === json(networkIntegrityReport(a)),
  };
  console.log(`stability: ${json(out.stability)}`);
  assert(Object.values(out.stability).every(v => v !== false), 'stability');
}
await writeFile(path.join(evidence, 'network-integrity.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log('G02c-R1 verification finished. Record: experiments/city-of-cities/evidence/network-integrity.json');
