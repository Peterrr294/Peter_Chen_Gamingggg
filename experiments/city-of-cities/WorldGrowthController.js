// A City of Cities — G02 WorldGrowthController (pure data, runs in Node).
//
// Schedules one growth step at a time on a WorldContext; it never replaces the chunk generator. A step:
//   1. read the World State                     2. build each city's Growth Frontier (N / S / E / W of its chunks)
//   3. merge candidates per city and cell        4. evaluate suitability (GrowthEvaluation, real terrain probes)
//   5. scheduler: each city bids rate × best score / (1 + chunks grown) × seeded ±10 %; highest bid grows
//   6. weighted reproducible choice among the winner's eligible candidates (key −ln u / score^k)
//   7. occupancy re-checked by WorldContext.addGrowthChunk   8. the unchanged chain generates the chunk
//   9. territory / frontier follow from the registries      10. one history event with reason, scores, conflicts
// At most one chunk per step. When no city has an eligible candidate the world is 'stalled' (no retry).
// Every random value is a keyed hash (worldSeed, purpose, stable candidate id / city id, step).
import { unit } from '../growing-world/growthConfig.js';
import { CITY_IDS } from './originConfig.js';
import { DIRECTIONS, GROWTH_DNA, GROWTH_RULES } from './growthDNA.js';
import { evaluateCandidate } from './GrowthEvaluation.js';

const now = () => (globalThis.performance ?? Date).now();

export class WorldGrowthController {
  constructor(world, { dna = GROWTH_DNA } = {}) {
    this.world = world;
    this.dna = dna; // per-city Growth DNA (Experiment C can pass a uniform table)
    this.lastFrontier = null; // evaluated candidates of the last step (debug, not saved)
  }

  // Growth Frontier of one city: merged candidates (one per free cell), parents sorted by the parent rule.
  // Occupied neighbour cells are returned as rejected candidates ('occupied by …') for debugging.
  frontier(cityId) {
    const w = this.world;
    const cells = new Map();
    for (const chunk of w.chunks.values()) {
      if (chunk.cityId !== cityId) continue;
      for (const [dir, [dx, dy, sideParent, sideCell]] of Object.entries(DIRECTIONS)) {
        const gx = chunk.worldCoordinate.gx + dx; const gy = chunk.worldCoordinate.gy + dy;
        const key = `${gx},${gy}`;
        if (!cells.has(key)) cells.set(key, { candidateId: `cand:${cityId}:${gx}:${gy}`, cityId, gx, gy, targetCoordinate: { gx, gy }, parents: [] });
        cells.get(key).parents.push({ chunk, direction: dir, sideParent, sideCell });
      }
    }
    const out = [];
    for (const cand of cells.values()) {
      const occupant = w.chunkAt(cand.gx, cand.gy);
      if (occupant) { if (occupant.cityId !== cityId) out.push({ ...cand, parents: undefined, parentChunkId: null, status: 'rejected', rejectionReason: `occupied by ${occupant.chunkId} (${occupant.cityId})` }); continue; }
      // Parent rule: most ports toward the cell, then lowest generation, then chunkId.
      cand.parents.sort((a, b) => (b.chunk.outputs?.ports?.[b.sideParent]?.length ?? 0) - (a.chunk.outputs?.ports?.[a.sideParent]?.length ?? 0) || a.chunk.generation - b.chunk.generation || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
      cand.parentChunkId = cand.parents[0].chunk.chunkId;
      cand.sameCityNeighbours = cand.parents.length;
      out.push(cand);
    }
    return out.sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  }

  // Evaluated frontier of every city for one step.
  evaluate(step) {
    const result = {};
    for (const cityId of CITY_IDS) {
      const list = this.frontier(cityId).map(cand => {
        if (cand.status === 'rejected') return cand;
        const e = evaluateCandidate(this.world, cand, step, this.dna[cityId]);
        const { parents, ...rest } = cand;
        return { ...rest, parentDirections: parents.map(p => `${p.chunk.chunkId}:${p.direction}`), ...e, status: e.rejectionReason ? 'rejected' : 'eligible' };
      });
      const eligible = list.filter(c => c.status === 'eligible');
      const k = GROWTH_RULES.selectionSharpness;
      const sum = eligible.reduce((s, c) => s + Math.max(c.score, 1e-6) ** k, 0);
      for (const c of eligible) c.selectionWeight = +((Math.max(c.score, 1e-6) ** k) / sum).toFixed(4);
      result[cityId] = list;
    }
    return result;
  }

  grownCount(cityId) { return this.world.growth.history.filter(e => e.cityId === cityId).length; }

  // Per-city statistics derived from the history and the current frontier (nothing is stored twice).
  cityStats(frontier = this.lastFrontier) {
    const h = this.world.growth.history;
    return Object.fromEntries(CITY_IDS.map(cityId => {
      const mine = h.filter(e => e.cityId === cityId);
      const last = mine.length ? mine.at(-1).step : 0;
      const list = frontier?.[cityId] ?? [];
      const reasons = {};
      for (const c of list.filter(x => x.status === 'rejected')) { const k = c.rejectionReason.startsWith('occupied by') ? `occupied by ${c.rejectionReason.split('(')[1]?.replace(')', '') ?? 'another city'}` : c.rejectionReason.replace('02.6 ', '').replace(/-?\d+(\.\d+)?/g, '#'); reasons[k] = (reasons[k] ?? 0) + 1; }
      return [cityId, { chunks: [...this.world.chunks.values()].filter(c => c.cityId === cityId).length, grown: mine.length, eligible: list.filter(x => x.status === 'eligible').length, rejected: list.filter(x => x.status === 'rejected').length, rejectionReasons: reasons, stepsSinceLastGrowth: this.world.growth.step - last, best: list.filter(x => x.status === 'eligible').reduce((b, c) => Math.max(b, c.score), 0) }];
    }));
  }

  // One growth step. Returns { event } or { stalled }.
  step() {
    const w = this.world;
    if (w.cities.size !== 6) throw new Error('Six city origins are required before growth');
    for (const c of w.chunks.values()) if (!c.outputs) throw new Error(`Chunk ${c.chunkId} is not generated (generate or restore it first)`);
    const step = w.growth.step + 1;
    const t0 = now();
    const frontier = this.evaluate(step);
    this.lastFrontier = frontier;
    const bids = CITY_IDS.map(cityId => {
      const eligible = frontier[cityId].filter(c => c.status === 'eligible');
      if (!eligible.length) return { cityId, bid: null, eligible: 0 };
      const best = Math.max(...eligible.map(c => c.score));
      const rate = this.dna[cityId].rate;
      const bid = rate * best / (1 + this.grownCount(cityId)) * (1 + GROWTH_RULES.cityJitter * (2 * unit('g02-city-bid', w.worldSeed, cityId, step) - 1));
      return { cityId, bid: +bid.toFixed(5), best, eligible: eligible.length, rate };
    });
    const bidding = bids.filter(b => b.bid !== null).sort((a, b) => b.bid - a.bid || unit('g02-bid-tie', w.worldSeed, a.cityId, step) - unit('g02-bid-tie', w.worldSeed, b.cityId, step));
    if (!bidding.length) {
      w.growth.stalled = { step, reason: 'no city has an eligible frontier candidate', cities: this.cityStats(frontier) };
      return { stalled: w.growth.stalled };
    }
    const winner = bidding[0].cityId;
    const eligible = frontier[winner].filter(c => c.status === 'eligible');
    const keyed = eligible.map(c => ({ c, key: -Math.log(Math.max(unit('g02-pick', w.worldSeed, c.candidateId, step), 1e-12)) / Math.max(c.score, 1e-6) ** GROWTH_RULES.selectionSharpness }))
      .sort((a, b) => a.key - b.key || a.c.candidateId.localeCompare(b.c.candidateId));
    const chosen = keyed[0].c;
    chosen.status = 'selected';
    // Deterministic occupation ruling: other cities' eligible candidates on the same cell lose this step.
    const contested = [];
    for (const cityId of CITY_IDS) if (cityId !== winner) for (const c of frontier[cityId]) if (c.gx === chosen.gx && c.gy === chosen.gy && c.status === 'eligible') { c.status = 'contested'; c.rejectionReason = `cell taken by ${winner} at step ${step}`; contested.push({ cityId, score: c.score }); }
    const rank = keyed.findIndex(x => x.c === chosen) + 1;
    const t = Object.entries(chosen.groups).map(([k, v]) => `${k} ${v}`).join(', ');
    const growthReason = {
      text: `${winner} grows ${chosen.parentDirections.find(d => d.startsWith(chosen.parentChunkId)).split(':')[1]} from ${chosen.parentChunkId} into (${chosen.gx}, ${chosen.gy}) ${chosen.terms.landform}: score ${chosen.score} (${t}; jitter ${chosen.jitter >= 0 ? '+' : ''}${chosen.jitter}); weighted pick ${rank} of ${eligible.length}, weight ${chosen.selectionWeight}; city bid ${bidding[0].bid} over ${bidding.slice(1, 3).map(b => `${b.cityId} ${b.bid}`).join(', ')}`,
      groups: chosen.groups, weights: chosen.weights, terms: chosen.terms, unavailable: chosen.unavailable, bids, contested,
    };
    const chunk = w.addGrowthChunk({ cityId: winner, gx: chosen.gx, gy: chosen.gy, parentChunkId: chosen.parentChunkId, step, reason: growthReason });
    const t1 = now();
    const { chunk: generated, layers } = w.generateChunk(chunk.chunkId);
    const conflicts = this.conflictsOf(generated);
    const event = {
      step, cityId: winner, parentChunkId: chosen.parentChunkId, newChunkId: chunk.chunkId, targetCoordinate: chosen.targetCoordinate, generation: chunk.generation,
      selectionScore: chosen.score, selectionWeight: chosen.selectionWeight, growthReason, worldSeed: w.worldSeed, generationParameters: chunk.generationParameters,
      outputs: { resolvedDNA: generated.outputs.resolvedDNA, counts: generated.outputs.counts },
      conflicts, ms: { evaluate: Math.round(t1 - t0), generate: Math.round(now() - t1) },
    };
    w.growth.history.push(event);
    w.growth.step = step;
    w.growth.generation = Math.max(w.growth.generation, chunk.generation);
    w.growth.stalled = null;
    return { event, chunk: generated, layers, frontier };
  }

  // Shared edges of a new chunk with existing 4-neighbours (any city): recorded, never repaired in G02.
  conflictsOf(b) {
    const out = [];
    for (const [, [dx, dy, sideB, sideA]] of Object.entries(DIRECTIONS)) {
      const a = this.world.chunkAt(b.worldCoordinate.gx + dx, b.worldCoordinate.gy + dy);
      if (!a || !a.outputs) continue;
      const pa = a.outputs.profiles[sideA]; const pb = b.outputs.profiles[sideB];
      let max = 0; let wet = 0;
      for (let i = 0; i < pa.h.length; i += 1) { max = Math.max(max, Math.abs(pa.h[i] - pb.h[i])); if (pa.w[i] !== pb.w[i]) wet += 1; }
      const qa = a.outputs.ports[sideA]; const qb = b.outputs.ports[sideB];
      const paired = qa.filter(p => qb.some(q => Math.abs(q.position - p.position) <= GROWTH_RULES.portTolerance && q.type === p.type)).length;
      out.push({
        with: a.chunkId, withCity: a.cityId, sameCity: a.cityId === b.cityId,
        geometry: max <= GROWTH_RULES.seamContinuous ? 'continuous' : max <= GROWTH_RULES.seamStep ? 'step' : 'cliff', maxDh: +max.toFixed(2),
        hydrology: wet ? 'discontinuous' : 'continuous', wetMismatch: wet,
        roads: { here: qb.length, there: qa.length, paired, unpaired: qa.length + qb.length - 2 * paired },
      });
    }
    return out;
  }

  grow(n) {
    const out = [];
    for (let i = 0; i < Math.min(n, GROWTH_RULES.maxStepsPerRun); i += 1) { const r = this.step(); out.push(r); if (r.stalled) break; }
    return out;
  }

  // Reset to the six origins (growth chunks and history removed; cores and their outputs kept, not regenerated).
  resetToOrigins() {
    const w = this.world;
    for (const c of [...w.chunks.values()]) if (c.role === 'growth') { w.chunks.delete(c.chunkId); w.occupancy.delete(`${c.worldCoordinate.gx},${c.worldCoordinate.gy}`); }
    w.growth = { generation: 0, step: 0, history: [], stalled: null };
    this.lastFrontier = null;
  }
}
