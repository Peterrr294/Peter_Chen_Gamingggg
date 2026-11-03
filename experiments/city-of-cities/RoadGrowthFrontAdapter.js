// A City of Cities — G02c-01 Road-Driven Growth: adapter between G02b road fronts and the G02 scheduler (pure data).
//
// The adapter owns no schedule. It turns MorphologicalGrowth.fronts() into the candidates WorldGrowthController bids on,
// and runs one chosen candidate through Plan → Generate → Validate; the controller commits it.
//   Road Growth Front  one real road port of a generated chunk that faces another cell (stable id from chunk, side, position)
//   Candidate          one free target cell of one city, with the best front toward it; all usable ports of that front enter
// Failure classes (never mixed): candidateRejected, terrainConflict, networkConflict, generationFailure per candidate;
// growthStalled per city and per world. A natural barrier is a terrainConflict, not a program error.
import { DNA_STRATEGY } from '../seed-terrain/networkStrategies.js';
import { DIRECTIONS } from './growthDNA.js';
import { evaluateCandidate } from './GrowthEvaluation.js';
import { MORPH_RULES, MorphologicalGrowth } from './MorphologicalGrowth.js';
import { RAMP_RULES } from './RoadRampPlanner.js';
import { interCityPlan } from './InterCityConnectionPlanner.js';

export const FAILURE = Object.freeze({ candidate: 'candidateRejected', terrain: 'terrainConflict', network: 'networkConflict', generation: 'generationFailure', stalled: 'growthStalled' });
// Strategies whose generator takes parent road entries. canalStreet ignores them while a canal region exists, so a
// road join there would be coincidence; Venice and Amsterdam need a waterfront growth mode of their own (not in G02c-01).
export const ROAD_DRIVEN_STRATEGIES = Object.freeze(['grid', 'organic']);
const CLASS_RANK = { primary: 0, secondary: 1 };
const OPPOSITE = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' };
const failureClassOf = reason => {
  if (/^terrain: (score|02\.6 DNA conflict|water required)/.test(reason)) return FAILURE.candidate;
  if (/^(terrain|no road entry)/.test(reason)) return FAILURE.terrain;
  return FAILURE.candidate;
};

// Crossings of road segments that share no node, inside one generated network. Bridges and tunnels are excluded: they
// are allowed to pass over or under. Returns the number of crossing edge pairs.
export function roadCrossings(network) {
  const roads = network.edges.filter(e => e.kind !== 'canal' && e.kind !== 'tunnel' && e.kind !== 'bridge').map(e => {
    const xs = e.points.map(p => p.x); const zs = e.points.map(p => p.z);
    return { e, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  });
  const orient = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const cross = (a, b, c, d) => orient(a, b, c) * orient(a, b, d) < -1e-6 && orient(c, d, a) * orient(c, d, b) < -1e-6;
  const pairs = [];
  for (let i = 0; i < roads.length; i += 1) for (let j = i + 1; j < roads.length; j += 1) {
    const A = roads[i]; const B = roads[j];
    if (A.minX > B.maxX || B.minX > A.maxX || A.minZ > B.maxZ || B.minZ > A.maxZ) continue;
    if ([A.e.from, A.e.to].some(n => n === B.e.from || n === B.e.to)) continue;
    let hit = false;
    for (let s = 0; s + 1 < A.e.points.length && !hit; s += 1) for (let t = 0; t + 1 < B.e.points.length && !hit; t += 1) hit = cross(A.e.points[s], A.e.points[s + 1], B.e.points[t], B.e.points[t + 1]);
    if (hit) pairs.push([A.e.id, B.e.id]);
  }
  return pairs.length;
}

// City road graph as a weighted graph over chunk road graphs and recorded joins: which chunks the core can reach, and how far.
export function cityRoadReach(world, cityId) {
  const chunks = [...world.chunks.values()].filter(c => c.cityId === cityId);
  const adj = new Map(); const add = (a, b, len) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push([b, len]); adj.get(b).push([a, len]); };
  for (const c of chunks) for (const [from, to, len] of c.outputs.roadGraph) add(`${c.chunkId}:${from}`, `${c.chunkId}:${to}`, len);
  for (const e of world.growth.history.filter(x => x.cityId === cityId && x.connections)) for (const l of [...e.connections, ...(e.neighbourConnections ?? [])]) add(`${l.parent.chunkId}:${l.parent.nodeId}`, `${l.child.chunkId}:${l.child.nodeId}`, 0);
  const core = world.cities.get(cityId).originChunkId;
  // Dijkstra from every node of the core's largest road component (a core can hold small separate fragments).
  const seen = new Map(); const best = new Map();
  for (const start of [...adj.keys()].filter(n => n.startsWith(`${core}:`)).sort()) {
    if (seen.has(start)) continue;
    const dist = new Map([[start, 0]]); const open = [[0, start]]; const reach = new Map();
    while (open.length) {
      open.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
      const [d, n] = open.shift();
      if (d > (dist.get(n) ?? Infinity) || reach.has(n)) continue;
      reach.set(n, d);
      for (const [m, len] of adj.get(n)) if (d + len < (dist.get(m) ?? Infinity)) { dist.set(m, d + len); open.push([d + len, m]); }
    }
    for (const n of reach.keys()) seen.set(n, start);
    const size = reach.size;
    if (!best.has('size') || size > best.get('size')) { best.set('size', size); best.set('reach', reach); }
  }
  const reach = best.get('reach') ?? new Map();
  const perChunk = Object.fromEntries(chunks.map(c => {
    const all = c.outputs.roadGraph.reduce((s, [, , l]) => s + l, 0);
    const on = c.outputs.roadGraph.reduce((s, [from, , l]) => s + (reach.has(`${c.chunkId}:${from}`) ? l : 0), 0);
    const far = [...reach].filter(([n]) => n.startsWith(`${c.chunkId}:`)).map(([, d]) => d);
    return [c.chunkId, { reachable: far.length > 0, roadLengthShareOnCoreNetwork: all ? +(on / all).toFixed(3) : 0, nearestNodeFromCoreM: far.length ? Math.round(Math.min(...far)) : null, farthestNodeFromCoreM: far.length ? Math.round(Math.max(...far)) : null }];
  }));
  return { cityId, coreChunkId: core, nodesOnCoreNetwork: reach.size, chunks: chunks.length, reachableChunks: Object.values(perChunk).filter(x => x.reachable).length, perChunk };
}

export class RoadGrowthFrontAdapter {
  constructor(world, morph = new MorphologicalGrowth(world), gradeProfile = null) {
    this.world = world; this.morph = morph; this.gradeProfile = gradeProfile;
    this.forcedParents = new Map(); // replay test: 'gx,gy' → parent chunk id
    this.interCity = false; // G03c-02: newcomers read other cities' road ends on edges they will share
    this.replayKeepsUnconnected = false; // replay test only: keep a planned chunk with no join, so a whole old run can be compared
    if (gradeProfile) morph.entryLimit = RAMP_RULES.maxGroundOffsetM; // a road end beyond this cannot get a ramp; the plan decides the rest
  }

  // Every road port of this front as a traceable record. Terrain fields are null when the front was refused before the entry check.
  roadFronts(chunk, front) {
    const byPosition = new Map(front.entries.map(e => [e.position, e]));
    return chunk.outputs.ports[front.side].filter(p => p.type === 'road').map(p => {
      const entry = byPosition.get(p.position);
      return {
        growthFrontId: `rgf:${chunk.chunkId}:${front.side}:${p.position}`, cityId: chunk.cityId, sourceChunkId: chunk.chunkId, sourceRoadId: `${chunk.chunkId}:e${p.edgeId}`, sourceNodeId: p.nodeId,
        targetChunkCoordinate: front.target, roadClass: p.roadClass, roadDirection: p.directionDeg, roadElevation: p.elevation,
        terrainConstraints: entry ? { targetGround: entry.targetGround, stepM: entry.stepM, maxEntryStepM: this.morph.entryLimit } : null,
        usable: entry?.usable ?? false,
        rejectionReason: entry ? (entry.usable ? null : `entry step ${entry.stepM} m > ${this.morph.entryLimit} m`) : front.reason,
      };
    });
  }

  // What the child takes from its parent, read from generated data (values, not new rules).
  inheritedMorphology(parent, cityId) {
    const m = parent.outputs.morph; const g = parent.outputs.grid;
    return {
      fromChunkId: parent.chunkId, strategy: DNA_STRATEGY[cityId],
      dominantOrientationDeg: m.dominantOrientationDeg, roadDensityKmPerKm2: m.roadDensityKmPerKm2, primaryKm: m.primaryKm,
      streetSpacing: g ? { primary: g.primarySpacing, secondary: g.secondarySpacing, inherited: 'grid anchor' } : 'unavailable (no fixed grid: organic network)',
      blockAreaMedianM2: m.blockAreaMedianM2, parcelFrontageMedianM: m.parcelFrontageMedianM, buildingCoverage: m.buildingCoverage,
      heightMeanM: m.heightMeanM, heightP90M: m.heightP90M,
    };
  }

  // Scheduling candidates of one city: one per target cell, with every refused cell and its reason.
  candidates(cityId, step, dna) {
    const w = this.world;
    const strategy = DNA_STRATEGY[cityId];
    const chunks = [...w.chunks.values()].filter(c => c.cityId === cityId).sort((a, b) => a.chunkId.localeCompare(b.chunkId));
    const base = (gx, gy) => ({ candidateId: `road:${cityId}:${gx}:${gy}`, cityId, gx, gy, targetCoordinate: { gx, gy }, targetChunkCoordinate: { gx, gy } });
    const out = [];
    const occupied = new Map();
    for (const chunk of chunks) for (const [, [dx, dy]] of Object.entries(DIRECTIONS)) {
      const gx = chunk.worldCoordinate.gx + dx; const gy = chunk.worldCoordinate.gy + dy;
      const occupant = w.chunkAt(gx, gy);
      if (occupant && occupant.cityId !== cityId) occupied.set(`${gx},${gy}`, { gx, gy, occupant });
    }
    for (const { gx, gy, occupant } of occupied.values()) out.push({ ...base(gx, gy), parentChunkId: null, status: 'rejected', failureClass: FAILURE.candidate, rejectionReason: `occupied by ${occupant.chunkId} (${occupant.cityId})` });
    const fronts = this.morph.fronts(cityId, step);
    if (!ROAD_DRIVEN_STRATEGIES.includes(strategy)) {
      const cells = new Map(fronts.map(f => [`${f.target.gx},${f.target.gy}`, f]));
      for (const f of cells.values()) out.push({ ...base(f.target.gx, f.target.gy), parentChunkId: f.sourceChunkId, status: 'rejected', failureClass: FAILURE.candidate, rejectionReason: `${strategy} city: waterfront growth mode not implemented (G02c-01 grows road-led cities only)` });
      return out.sort((a, b) => a.gy - b.gy || a.gx - b.gx);
    }
    const byCell = new Map();
    for (const f of fronts) { const k = `${f.target.gx},${f.target.gy}`; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(f); }
    for (const list of byCell.values()) {
      const { gx, gy } = list[0].target;
      const ok = list.filter(f => f.status === 'eligible');
      const records = list.flatMap(f => this.roadFronts(w.chunks.get(f.sourceChunkId), f));
      if (!ok.length) {
        const f = list[0];
        out.push({ ...base(gx, gy), parentChunkId: f.sourceChunkId, status: 'rejected', failureClass: failureClassOf(f.reason), rejectionReason: f.reason, roadFronts: records, refusedFronts: list.map(x => ({ growthFrontId: x.growthFrontId, reason: x.reason })) });
        continue;
      }
      // Parent rule of G02 on usable ports: most primary entries, then most entries, then lowest generation, then chunk id.
      ok.sort((a, b) => b.usable.primary - a.usable.primary || b.usable.all - a.usable.all || w.chunks.get(a.sourceChunkId).generation - w.chunks.get(b.sourceChunkId).generation || a.sourceChunkId.localeCompare(b.sourceChunkId));
      const forced = this.forcedParents.get(`${gx},${gy}`);
      const front = ok.find(f => f.sourceChunkId === forced) ?? ok[0];
      const parent = w.chunks.get(front.sourceChunkId);
      const lead = records.filter(r => r.sourceChunkId === parent.chunkId && r.usable).sort((a, b) => (CLASS_RANK[a.roadClass] ?? 2) - (CLASS_RANK[b.roadClass] ?? 2) || Math.abs(a.terrainConstraints.stepM) - Math.abs(b.terrainConstraints.stepM) || a.growthFrontId.localeCompare(b.growthFrontId))[0];
      const parents = list.map(f => ({ chunk: w.chunks.get(f.sourceChunkId), direction: f.direction, sideParent: f.side, sideCell: OPPOSITE[f.side], ports: f.entries.filter(e => e.usable) }));
      const cand = { ...base(gx, gy), parents, sameCityNeighbours: list.length };
      const e = evaluateCandidate(w, cand, step, dna);
      const record = {
        ...base(gx, gy), parentChunkId: parent.chunkId, sourceChunkId: parent.chunkId, sourceRoadId: lead.sourceRoadId, growthFrontId: lead.growthFrontId, sourceGrowthFrontId: front.growthFrontId,
        roadClass: lead.roadClass, roadDirection: lead.roadDirection, roadElevation: lead.roadElevation, terrainConstraints: { ...lead.terrainConstraints, landform: e.terms.landform, meanLandSlope: e.terms.meanLandSlope, usableEntries: front.usable.all, usablePrimary: front.usable.primary, refusedEntries: front.entries.length - front.usable.all },
        inheritedMorphology: this.inheritedMorphology(parent, cityId), candidateScore: e.score, parentDirections: parents.map(p => `${p.chunk.chunkId}:${p.direction}`), sameCityNeighbours: list.length,
        roadFronts: records, refusedFronts: list.filter(f => f.status !== 'eligible').map(x => ({ growthFrontId: x.growthFrontId, reason: x.reason })),
        ...e, status: e.rejectionReason ? 'rejected' : 'eligible', failureClass: e.rejectionReason ? failureClassOf(`terrain: ${e.rejectionReason}`) : null,
      };
      // Working references for the attempt; not part of any saved or copied record.
      Object.defineProperties(record, { front: { value: front }, allFronts: { value: fronts } });
      out.push(record);
    }
    return out.sort((a, b) => a.gy - b.gy || a.gx - b.gx);
  }

  // Generate → Validate. Returns { built } or { failure }, and leaves no chunk behind on failure.
  attempt(candidate, step) {
    const w = this.world;
    const chunkId = `c_${candidate.gx}_${candidate.gy}`;
    let built;
    try { built = this.morph.buildFront(candidate.front, candidate.allFronts, step, { vertical: this.gradeProfile, ...(this.interCity ? { interCityPlan: interCityPlan(w, this.morph, candidate.cityId, candidate.targetCoordinate) } : {}) }); } catch (error) {
      if (w.chunks.get(chunkId)?.growthStep === step) w.removeGrowthChunk(chunkId);
      return { failure: { failureClass: FAILURE.generation, reason: `generator error: ${error.message}` } };
    }
    const problem = this.validate(built);
    if (problem) { w.removeGrowthChunk(built.chunk.chunkId); return { failure: problem }; }
    return { built };
  }

  // Everything the outcome of a generated candidate depends on. Same text, same result: the attempt need not run again.
  candidateSignature(candidate) {
    const w = this.world; const { gx, gy } = candidate;
    const neighbours = Object.values(DIRECTIONS).map(([dx, dy, , otherSide]) => { const c = w.chunkAt(gx + dx, gy + dy); return c ? `${c.chunkId}:${c.cityId}:${c.cityId === candidate.cityId ? c.outputs.signatures.network : ''}:${otherSide}` : '-'; });
    return JSON.stringify({ front: candidate.sourceGrowthFrontId, parent: w.chunks.get(candidate.sourceChunkId).outputs.signatures.network, terrain: w.cell(gx, gy).terrainSeed, neighbours, profile: this.gradeProfile, rules: RAMP_RULES });
  }

  validate({ event, chunk, layers }) {
    const counts = chunk.outputs.counts;
    if (!event.connections.length && !this.replayKeepsUnconnected) return { failureClass: FAILURE.network, reason: `no parent road joined a child road (${event.localAdaptations.unmatchedEntries.length} usable entries unmatched)` };
    const empty = ['networkEdges', 'blocks', 'parcels', 'buildings'].filter(k => !counts[k]);
    if (empty.length) return { failureClass: FAILURE.generation, reason: `incomplete chunk: no ${empty.join(', ')}` };
    const crossings = roadCrossings(layers.city.network);
    if (crossings) return { failureClass: FAILURE.network, reason: `${crossings} road crossing(s) without a shared node` };
    if (this.gradeProfile) {
      const off = [...event.connections, ...(event.crossCityConnections ?? [])].filter(c => Math.abs(c.elevationStepM) > RAMP_RULES.endpointToleranceM + 0.01);
      if (off.length) return { failureClass: FAILURE.network, reason: `${off.length} joined road(s) still differ in height` };
    }
    return null;
  }
}
