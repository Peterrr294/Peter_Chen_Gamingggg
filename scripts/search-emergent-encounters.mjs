// A City of Cities — G03c-01 seed search for natural encounters (no hand placement).
// Every seed runs the real chain: placement v2 → six cores → road-driven scheduler with the G02c-02 ramp plan → encounter
// detection after each commit. A seed ends when the world stalls or reaches the step budget. Nothing is moved or inserted.
// Records every seed (also failures) and saves the state of the first seed whose encounter became ADJACENT by growth.
// Usage: node --max-old-space-size=8192 scripts/search-emergent-encounters.mjs <firstSeed> <count> [steps=30] [grade=baseline]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = f => import(pathToFileURL(path.join(root, f)));
const { WorldContext } = await mod('experiments/city-of-cities/WorldContext.js');
const { WorldGrowthController } = await mod('experiments/city-of-cities/WorldGrowthController.js');
const [first, count, steps = 30, grade = 'baseline'] = process.argv.slice(2);
const evidence = path.join(root, 'experiments/city-of-cities/evidence');
const out = { task: 'G03c-01 seed search', startedAt: new Date().toISOString(), settings: { firstSeed: Number(first), seeds: Number(count), stepBudget: Number(steps), gradeProfile: grade, scheduler: 'road-driven + ramp plan', stopCondition: 'world stalled or step budget reached' }, seeds: [] };
let saved = null;
for (let seed = Number(first); seed < Number(first) + Number(count); seed += 1) {
  const t0 = Date.now(); const rec = { seed };
  try {
    const w = new WorldContext({ worldSeed: seed }); const rep = w.initialise();
    if (rep.failures.length) { rec.placement = `failed: ${rep.failures.map(f => f.cityId).join(', ')}`; out.seeds.push({ ...rec, ms: Date.now() - t0 }); console.log(seed, rec.placement); continue; }
    for (const id of [...w.chunks.keys()].sort()) w.generateChunk(id);
    const g = new WorldGrowthController(w, { growthMode: 'road', gradeProfile: grade, encounters: true });
    let stalled = null;
    for (let i = 0; i < Number(steps); i += 1) { const r = g.step(); if (r.stalled) { stalled = r.stalled.reason; break; } }
    const segs = w.growth.encounters;
    const adjacentByGrowth = segs.filter(s => s.timeline.some(t => t.step > 0 && t.states.includes('adjacent')));
    Object.assign(rec, {
      placement: 'ok', steps: w.growth.history.length, stalled, grown: Object.fromEntries([...w.cities.keys()].sort().map(id => [id, w.growth.history.filter(e => e.cityId === id).length])),
      segments: segs.map(s => ({ encounterId: s.encounterId, origin: s.origin, firstStep: s.firstStep, minDistanceCells: s.minDistanceCells, states: s.states, relationshipStatus: s.relationshipStatus, proposalCounts: s.proposalCounts })),
      emergedApproaching: segs.filter(s => s.origin === 'growth').length, adjacentByGrowth: adjacentByGrowth.map(s => ({ encounterId: s.encounterId, step: s.timeline.find(t => t.states.includes('adjacent')).step })),
    });
    if (adjacentByGrowth.length && !saved) { saved = `world-${seed}-g03c-encounter-state.json`; await writeFile(path.join(evidence, saved), `${JSON.stringify(w.serialise())}\n`); rec.savedState = saved; }
  } catch (error) { rec.error = error.message.slice(0, 300); }
  rec.ms = Date.now() - t0; out.seeds.push(rec);
  console.log(seed, rec.placement ?? '', rec.steps ?? '', rec.stalled ? 'stalled' : '', 'emerged', rec.emergedApproaching ?? '-', 'adjacent', JSON.stringify(rec.adjacentByGrowth ?? rec.error ?? ''), rec.ms, 'ms');
  await writeFile(path.join(evidence, 'emergent-encounter-search.json'), `${JSON.stringify({ ...out, finishedAt: null }, null, 1)}\n`);
}
const ok = out.seeds.filter(s => s.placement === 'ok');
out.summary = { seeds: out.seeds.length, placementFailed: out.seeds.filter(s => s.placement?.startsWith('failed')).length, errors: out.seeds.filter(s => s.error).length, stalledBeforeBudget: ok.filter(s => s.stalled).length, withEmergedApproach: ok.filter(s => s.emergedApproaching).length, withAdjacencyByGrowth: ok.filter(s => s.adjacentByGrowth.length).length, firstSavedState: saved, totalMs: out.seeds.reduce((a, s) => a + s.ms, 0) };
out.finishedAt = new Date().toISOString();
await writeFile(path.join(evidence, 'emergent-encounter-search.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify(out.summary));
