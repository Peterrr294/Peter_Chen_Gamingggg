// A City of Cities — G02b Morphological Continuity & Urban Growth (pure data, runs in Node).
//
// Growth as the extension of urban structure: a city grows from the real edges of its generated fabric, not by
// generating an unrelated city next door. One growth step (road-first):
//   1. growth fronts of every city chunk side that faces a free cell, from generated data only:
//        road front      — the chunk's road ports on that side (node / edge ids, class, elevation)
//        block front     — generated blocks that touch that side
//        waterfront      — wet samples on that side + canal ports (recorded; not used for growth in G02b)
//        terrain front   — the target cell's real terrain (G02 evaluation) + an entry check per road port: the
//                          parent port elevation must be within MAX_ENTRY_STEP of the target terrain at that point
//   2. choose the front with the most usable primary entries (then all usable entries, terrain score, seeded tie)
//   3. GrowthBoundaryContext → the target chunk: parent grid anchor (grid DNAs continue the same lines), entry
//      ports with stable connection ids, the city height centre (density gradient from the core)
//   4. the unchanged chain generates the chunk with those optional inputs
//   5. connections: each entry port is joined to the child port at the same boundary point (≤ 0.5 m, same type)
//      by identity (parent chunk / node / edge ↔ child chunk / node / edge); unmatched ports are reported with
//      the reason; nothing is joined because it merely looks aligned
//   6. a spatial growth event (sources, generated roads / blocks / parcels, inherited rules, adaptations,
//      rejected fronts) in world.growth.history
// No front with a usable road entry → the step fails with the measured reasons (no other growth mode in G02b).
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { DNA_STRATEGY } from '../seed-terrain/networkStrategies.js';
import { terrainOf, networkOf } from '../growing-world/WorldGrowthController.js';
import { unit } from '../growing-world/growthConfig.js';
import { generateUrbanLayer } from '../world-grid/WorldGrid.js';
import { CHUNK_SIZE } from './originConfig.js';
import { DIRECTIONS } from './growthDNA.js';
import { evaluateCandidate } from './GrowthEvaluation.js';
import { RAMP_RULES, RAMP_STATUS } from './RoadRampPlanner.js';

export const MORPH_RULES = Object.freeze({
  maxEntryStep: 3, // m: a road may enter the new chunk only where its parent port elevation is within this of the target terrain (A)
  portTolerance: 0.5, // m: an entry port and a child port join when they are this close on the shared edge, same type
  strategiesWithGridInheritance: ['grid'],
});
const H = CHUNK_SIZE / 2;
const r2 = v => +Number(v).toFixed(2);
const OPPOSITE = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' };

// World point of a port on a chunk side (position runs along z for X sides, along x for Z sides).
export function portPoint(chunk, side, position) {
  const { x, z } = chunk.worldOrigin;
  return side === 'maxX' ? { x: x + H, z: position } : side === 'minX' ? { x: x - H, z: position } : side === 'maxZ' ? { x: position, z: z + H } : { x: position, z: z - H };
}

export class MorphologicalGrowth {
  constructor(world) { this.world = world; this.terrainCache = new Map(); this.entryCache = new Map(); this.entryLimit = MORPH_RULES.maxEntryStep; } // G02c-02 raises entryLimit: the ramp plan then decides each join

  targetTerrain(gx, gy) {
    const k = `${gx},${gy}`;
    if (!this.terrainCache.has(k)) { const cell = this.world.cell(gx, gy); const terrain = terrainOf(cell); this.terrainCache.set(k, { cell, terrain, height: createSampler(terrain.fields).height }); }
    return this.terrainCache.get(k);
  }

  // Growth fronts of one city (sides of its chunks that face a free cell).
  fronts(cityId, step = this.world.growth.step + 1) {
    const w = this.world; const out = [];
    for (const chunk of [...w.chunks.values()].filter(c => c.cityId === cityId).sort((a, b) => a.chunkId.localeCompare(b.chunkId))) {
      for (const [dir, [dx, dy, side]] of Object.entries(DIRECTIONS)) {
        const gx = chunk.worldCoordinate.gx + dx; const gy = chunk.worldCoordinate.gy + dy;
        if (w.chunkAt(gx, gy)) continue;
        const ports = chunk.outputs.ports[side];
        const wet = [...chunk.outputs.profiles[side].w].filter(x => x === '1').length;
        const cand = { candidateId: `morph:${cityId}:${gx}:${gy}`, cityId, gx, gy, parents: [{ chunk, sideParent: side, sideCell: OPPOSITE[side] }], sameCityNeighbours: 1 };
        const evaluation = evaluateCandidate(w, cand, step);
        const front = {
          growthFrontId: `front:${chunk.chunkId}:${side}`, sourceChunkId: chunk.chunkId, side, direction: dir, target: { gx, gy },
          road: { ports: ports.length, primary: ports.filter(p => p.roadClass === 'primary').length, secondary: ports.filter(p => p.roadClass === 'secondary').length, canal: ports.filter(p => p.type === 'canal').length },
          block: chunk.outputs.boundaryBlocks?.[side] ?? null,
          water: { wetSamples: wet, sideSamples: chunk.outputs.profiles[side].w.length, canalPorts: ports.filter(p => p.type === 'canal').length },
          terrain: { landform: evaluation.terms.landform, terrainGroup: evaluation.groups.terrain, score: evaluation.score, rejectionReason: evaluation.rejectionReason },
          entries: [], status: 'eligible', reason: null,
        };
        if (evaluation.rejectionReason) { front.status = 'rejected'; front.reason = `terrain: ${evaluation.rejectionReason}`; out.push(front); continue; }
        if (!ports.filter(p => p.type === 'road').length) { front.status = 'rejected'; front.reason = 'no road port on this side (no road growth front)'; out.push(front); continue; }
        // Entry checks read immutable ports and terrain, so they are kept per front (G02c: terrain fields need not stay in memory).
        if (!this.entryCache.has(front.growthFrontId)) this.entryCache.set(front.growthFrontId, ports.filter(q => q.type === 'road').map(p => {
          const t = this.targetTerrain(gx, gy);
          const pt = portPoint(chunk, side, p.position);
          const ground = t.height(pt.x, pt.z);
          const step = ground - p.elevation;
          return { connectionId: `conn:${chunk.chunkId}:${side}:${p.position}`, parentChunkId: chunk.chunkId, parentNodeId: p.nodeId, parentEdgeId: p.edgeId, roadClass: p.roadClass, type: p.type, position: p.position, point: { x: r2(pt.x), z: r2(pt.z) }, parentElevation: p.elevation, targetGround: r2(ground), stepM: r2(step), usable: Math.abs(step) <= this.entryLimit };
        }));
        front.entries = this.entryCache.get(front.growthFrontId);
        const usable = front.entries.filter(e => e.usable);
        front.usable = { all: usable.length, primary: usable.filter(e => e.roadClass === 'primary').length };
        if (!usable.length) { front.status = 'rejected'; front.reason = `no road entry within ${this.entryLimit} m of the target terrain (steps ${front.entries.map(e => e.stepM).join(', ')} m)`; }
        out.push(front);
      }
    }
    return out;
  }

  // G03b: target (optional) restricts the choice to the fronts that face one cell (encounter fixture / negotiation).
  choose(cityId, step, target = null) {
    const fronts = this.fronts(cityId, step);
    const ok = fronts.filter(f => f.status === 'eligible' && (!target || (f.target.gx === target.gx && f.target.gy === target.gy)));
    ok.sort((a, b) => b.usable.primary - a.usable.primary || b.usable.all - a.usable.all || b.terrain.score - a.terrain.score || unit('g02b-front', this.world.worldSeed, a.growthFrontId, step) - unit('g02b-front', this.world.worldSeed, b.growthFrontId, step));
    return { chosen: ok[0] ?? null, fronts };
  }

  // One road-first growth step of one city. Returns { event } or { failure }.
  // G03b options (all optional; without them the G02b step is unchanged):
  //   target            { gx, gy } — grow only into this cell
  //   crossCityEntries  accepted interfaces of a neighbouring city (each with its own child side); organic children
  //                     use them as entry gates, and they are joined by identity after generation like parent entries
  //   encounterId       the encounter decision that produced crossCityEntries (traceability)
  grow(cityId, opts = {}) {
    const w = this.world;
    const step = w.growth.step + 1;
    const { chosen, fronts } = this.choose(cityId, step, opts.target ?? null);
    if (!chosen) {
      const failure = { step, cityId, kind: 'g02b-road-first', reason: opts.target ? `no growth front toward ${opts.target.gx},${opts.target.gy} with a usable road entry` : 'no growth front with a usable road entry', fronts: fronts.filter(f => !opts.target || (f.target.gx === opts.target.gx && f.target.gy === opts.target.gy)).map(f => ({ growthFrontId: f.growthFrontId, reason: f.reason ?? 'eligible' })) };
      w.growth.morphFailures = [...(w.growth.morphFailures ?? []), failure];
      return { failure };
    }
    const built = this.buildFront(chosen, fronts, step, opts);
    const { event } = built;
    w.growth.history.push(event); w.growth.step = step; w.growth.generation = Math.max(w.growth.generation, built.chunk.generation);
    return { ...built, fronts };
  }

  // Registers and generates the child of one front, and joins its roads. Nothing enters the history here: the caller commits.
  buildFront(chosen, fronts, step, opts = {}) {
    const w = this.world;
    const parent = w.chunks.get(chosen.sourceChunkId);
    const { cityId } = parent;
    const core = w.chunks.get(w.cities.get(cityId).originChunkId);
    const strategy = DNA_STRATEGY[cityId];
    const entries = chosen.entries.filter(e => e.usable);
    const ic = opts.interCityPlan ?? null; // G03c-02: computed by the adapter before generation
    const crossEntries = opts.crossCityEntries?.length ? opts.crossCityEntries : ic?.gates ?? [];
    const growthContext = {
      mode: 'road-first', growthEventId: `growth:${cityId}:${step}`, parentChunkId: parent.chunkId, sourceGrowthFrontId: chosen.growthFrontId, side: OPPOSITE[chosen.side],
      sourceRoadIds: [...new Set(entries.map(e => `${e.parentChunkId}:e${e.parentEdgeId}`))],
      entryPorts: entries.map(e => ({ connectionId: e.connectionId, point: e.point, roadClass: e.roadClass, type: e.type, elevation: e.parentElevation, parentNodeId: e.parentNodeId, parentEdgeId: e.parentEdgeId })),
      grid: MORPH_RULES.strategiesWithGridInheritance.includes(strategy) && parent.outputs.grid ? { ...parent.outputs.grid, fromChunkId: parent.chunkId } : null,
      centre: core.outputs.buildingCentre ? { x: r2(core.outputs.buildingCentre.x), z: r2(core.outputs.buildingCentre.z), fromChunkId: core.chunkId } : null,
      generationIndex: w.chunks.size,
      ...(opts.vertical ? { vertical: { profile: opts.vertical, ...(opts.throughJunction ? { throughJunction: true } : {}), entries: [...this.verticalEntries(parent, chosen, OPPOSITE[chosen.side]), ...(ic?.vertical ?? [])] } } : {}),
      ...(crossEntries.length ? { crossCityEntries: crossEntries, encounterId: opts.encounterId ?? null } : {}),
    };
    const chunk = w.addGrowthChunk({ cityId, gx: chosen.target.gx, gy: chosen.target.gy, parentChunkId: parent.chunkId, step, reason: { text: `road-first growth ${chosen.direction} from ${parent.chunkId} (${chosen.usable.primary} primary / ${chosen.usable.all} usable road entries)`, front: chosen.growthFrontId }, growthContext });
    const { chunk: generated, layers } = w.generateChunk(chunk.chunkId);
    const link = this.connect(parent, generated, chosen.side, joinableEntries(generated, growthContext));
    const cross = crossConnect(w, this, generated, joinableCross(generated, growthContext.crossCityEntries ?? []));
    const generatedRoadIds = [...new Set(link.connections.map(c => c.child.edgeId))];
    const blocks = layers.city.blocks.blocks ?? []; const parcels = layers.city.parcels.parcels ?? [];
    const event = {
      step, cityId, parentChunkId: parent.chunkId, newChunkId: chunk.chunkId, targetCoordinate: chosen.target, generation: chunk.generation, mode: 'g02b-road-first',
      growthEventId: growthContext.growthEventId, sourceCityId: cityId, sourceChunkId: parent.chunkId, sourceGrowthFrontId: chosen.growthFrontId, sourceRoadIds: growthContext.sourceRoadIds,
      targetChunkId: chunk.chunkId, generationStep: step,
      generatedRoadIds: generatedRoadIds.map(id => `${chunk.chunkId}:e${id}`),
      generatedBlockIds: blocks.map(b => `${chunk.chunkId}:${b.id}`),
      generatedParcelIds: parcels.filter(p => generatedRoadIds.includes(p.frontageRoadId)).map(p => `${chunk.chunkId}:${p.id}`),
      parcelsTotal: parcels.length,
      inheritedRules: { grid: growthContext.grid ? { axisDeg: r2(growthContext.grid.axisDeg), primarySpacing: growthContext.grid.primarySpacing, secondarySpacing: growthContext.grid.secondarySpacing, fromChunkId: parent.chunkId } : 'not inherited (organic / canal strategy: entry ports only)', heightCentre: growthContext.centre, cityDNA: cityId, parcelAndBuildingRules: `${cityId} DNA tables (unchanged)` },
      localAdaptations: { gridCounts: generated.outputs.grid ? layers.city.network.gridCounts ?? null : null, unmatchedEntries: link.unmatchedEntries, newPortsOnSharedEdge: link.unmatchedChild, maxEntryStepM: Math.max(0, ...entries.map(e => Math.abs(e.stepM))) },
      rejectedConstraints: fronts.filter(f => f.status === 'rejected').map(f => ({ growthFrontId: f.growthFrontId, reason: f.reason })),
      connections: link.connections,
      ...(generated.outputs.ramps ? { ramps: generated.outputs.ramps.records, vacatedBuildings: generated.outputs.ramps.vacatedBuildings, gradeProfile: generated.outputs.ramps.profile } : {}),
      ...(growthContext.crossCityEntries ? { encounterId: growthContext.encounterId, crossCityConnections: cross.connections, crossCityUnmatched: cross.unmatchedEntries } : {}),
      ...(ic ? { interCity: { edges: ic.edges } } : {}),
      selectionScore: chosen.terrain.score, growthReason: { text: `road-first ${chosen.direction} from ${parent.chunkId}`, front: chosen.growthFrontId, usable: chosen.usable },
      outputs: { resolvedDNA: generated.outputs.resolvedDNA, counts: generated.outputs.counts }, conflicts: [],
    };
    return { event, chunk: generated, layers };
  }

  // G02c-02: every road end that faces the new chunk from its city: all parent ports (usable or not) and older neighbours.
  verticalEntries(parent, chosen, childSide) {
    const w = this.world; const out = [];
    const add = (chunk, side, cSide, kind) => { for (const p of chunk.outputs.ports[side].filter(q => q.type === 'road')) out.push({ connectionId: `conn:${chunk.chunkId}:${side}:${p.position}`, kind, parentChunkId: chunk.chunkId, parentNodeId: p.nodeId, parentEdgeId: p.edgeId, side: cSide, position: p.position, roadClass: p.roadClass, elevation: p.elevation }); };
    add(parent, chosen.side, childSide, 'parent');
    for (const [, [dx, dy, cSide, otherSide]] of Object.entries(DIRECTIONS)) {
      const other = w.chunkAt(chosen.target.gx + dx, chosen.target.gy + dy);
      if (other && other.cityId === parent.cityId && other.chunkId !== parent.chunkId && other.outputs) add(other, otherSide, cSide, 'neighbour');
    }
    return out;
  }

  // G02c: a new chunk can also touch other chunks of its city. Their road ends join by identity under the parent rules
  // (same point, same type, step within the entry limit); anything else stays unjoined and is reported.
  connectNeighbours(child, parentChunkId) {
    const w = this.world; const connections = []; const unjoined = [];
    const limit = child.outputs.ramps ? RAMP_RULES.endpointToleranceM + 0.01 : MORPH_RULES.maxEntryStep; // with a ramp plan, the same node means the same height
    for (const [, [dx, dy, , otherSide]] of Object.entries(DIRECTIONS)) {
      const other = w.chunkAt(child.worldCoordinate.gx + dx, child.worldCoordinate.gy + dy);
      if (!other || other.cityId !== child.cityId || other.chunkId === parentChunkId || !other.outputs) continue;
      const entries = other.outputs.ports[otherSide].filter(p => p.type === 'road').map(p => ({ connectionId: `conn:${other.chunkId}:${otherSide}:${p.position}`, point: portPoint(other, otherSide, p.position), roadClass: p.roadClass, type: p.type, elevation: p.elevation, parentNodeId: p.nodeId, parentEdgeId: p.edgeId }));
      const r = this.connect(other, child, otherSide, entries);
      for (const c of r.connections) { if (Math.abs(c.elevationStepM) <= limit) connections.push(c); else unjoined.push({ connectionId: c.connectionId, reason: `height step ${c.elevationStepM} m > ${limit} m` }); }
      for (const u of r.unmatchedEntries) unjoined.push({ connectionId: u.connectionId, reason: 'no child road at this boundary point' });
    }
    return { connections, unjoined };
  }

  // Join entry ports to the child's ports on the shared side by position and type; identities, not appearance.
  connect(parent, child, parentSide, entryPorts) {
    const childSide = OPPOSITE[parentSide];
    const childPorts = child.outputs.ports[childSide];
    const used = new Set(); const connections = []; const unmatchedEntries = [];
    for (const e of entryPorts) {
      const pos = parentSide.endsWith('X') ? e.point.z : e.point.x;
      const match = childPorts.map((p, i) => ({ p, i, d: Math.abs(p.position - pos) })).filter(m => !used.has(m.i) && m.p.type === e.type && m.d <= MORPH_RULES.portTolerance).sort((a, b) => a.d - b.d)[0];
      if (!match) { unmatchedEntries.push({ connectionId: e.connectionId, roadClass: e.roadClass, reason: 'no child road reaches this boundary point (child line truncated or dropped by terrain inside the new chunk)' }); continue; }
      used.add(match.i);
      connections.push({ connectionId: e.connectionId, roadClass: e.roadClass, parent: { chunkId: parent.chunkId, nodeId: e.parentNodeId, edgeId: e.parentEdgeId }, child: { chunkId: child.chunkId, nodeId: match.p.nodeId, edgeId: match.p.edgeId, roadClass: match.p.roadClass }, positionErrorM: r2(match.d), elevationStepM: r2(match.p.elevation - e.elevation) });
    }
    const unmatchedChild = childPorts.map((p, i) => ({ p, i })).filter(({ p, i }) => !used.has(i) && p.type === 'road').map(({ p }) => ({ position: p.position, roadClass: p.roadClass }));
    return { connections, unmatchedEntries, unmatchedChild };
  }

  // The same neighbour joins as they stood when the child was committed (only chunks older than its step).
  connectNeighboursAt(child, parentChunkId, step) {
    const w = this.world; const later = [...w.chunks.values()].filter(c => c.growthStep >= step && c.chunkId !== child.chunkId);
    const hidden = later.map(c => { const k = `${c.worldCoordinate.gx},${c.worldCoordinate.gy}`; const v = w.occupancy.get(k); w.occupancy.delete(k); return [k, v]; });
    const r = this.connectNeighbours(child, parentChunkId);
    for (const [k, v] of hidden) w.occupancy.set(k, v);
    return r;
  }

  // City-level road graph: union of the chunk road graphs + recorded connections. Reachability from the core.
  connectivity(cityId) {
    const w = this.world;
    const chunks = [...w.chunks.values()].filter(c => c.cityId === cityId);
    const adj = new Map(); const add = (a, b) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); };
    const lengthOf = new Map();
    for (const c of chunks) for (const [from, to, len] of c.outputs.roadGraph) { add(`${c.chunkId}:${from}`, `${c.chunkId}:${to}`); lengthOf.set(`${c.chunkId}:${from}-${to}`, len); }
    const links = w.growth.history.filter(e => e.cityId === cityId && e.mode === 'g02b-road-first').flatMap(e => [...e.connections, ...(e.neighbourConnections ?? [])]);
    for (const l of links) add(`${l.parent.chunkId}:${l.parent.nodeId}`, `${l.child.chunkId}:${l.child.nodeId}`);
    // Component of the core's longest road component: BFS from every core node, keep the largest reached set.
    const core = w.cities.get(cityId).originChunkId;
    const seen = new Map(); let comp = 0;
    for (const n of adj.keys()) { if (seen.has(n)) continue; comp += 1; const stack = [n]; seen.set(n, comp); while (stack.length) { const x = stack.pop(); for (const y of adj.get(x)) if (!seen.has(y)) { seen.set(y, comp); stack.push(y); } } }
    const lenByComp = new Map();
    for (const c of chunks) for (const [from, , len] of c.outputs.roadGraph) { const k = seen.get(`${c.chunkId}:${from}`); lenByComp.set(k, (lenByComp.get(k) ?? 0) + len); }
    const coreComps = new Set([...seen].filter(([n]) => n.startsWith(`${core}:`)).map(([, k]) => k));
    const main = [...coreComps].sort((a, b) => (lenByComp.get(b) ?? 0) - (lenByComp.get(a) ?? 0))[0];
    const total = [...lenByComp.values()].reduce((a, b) => a + b, 0);
    const perChunk = Object.fromEntries(chunks.map(c => {
      const nodes = [...seen].filter(([n]) => n.startsWith(`${c.chunkId}:`));
      const len = c.outputs.roadGraph.reduce((s, [from, , l]) => s + (seen.get(`${c.chunkId}:${from}`) === main ? l : 0), 0);
      const all = c.outputs.roadGraph.reduce((s, [, , l]) => s + l, 0);
      return [c.chunkId, { reachableFromCoreShare: all ? r2(len / all) : 0, nodes: nodes.length }];
    }));
    return { components: comp, roadLengthM: total, mainComponentShare: total ? r2((lenByComp.get(main) ?? 0) / total) : 0, connections: links.length, perChunk };
  }

  // Baseline for comparison: the same target cell generated WITHOUT growth context (independent G01 / G02 path).
  independentBaseline(cityId, gx, gy, parentChunkId, parentSide) {
    const w = this.world; const cell = w.cell(gx, gy);
    const terrain = terrainOf(cell); const net = networkOf(cell, cityId, terrain);
    const city = generateUrbanLayer(terrain, net, net.network, null, { worldSeed: 1 });
    const parent = w.chunks.get(parentChunkId);
    const childSide = OPPOSITE[parentSide];
    const childPorts = net.network.edgePorts.filter(p => p.side === childSide && p.type === 'road');
    const parentPorts = parent.outputs.ports[parentSide].filter(p => p.type === 'road');
    const aligned = parentPorts.filter(p => childPorts.some(q => Math.abs(q.position - p.position) <= MORPH_RULES.portTolerance)).length;
    return { orientation: net.network.orientation?.axisDeg ?? null, grid: net.network.grid ?? null, parentPorts: parentPorts.length, childPortsOnSide: childPorts.length, alignedWithin05m: aligned, heightCentre: city.buildings.source.centre };
  }
}

// After a restore + regeneration: recompute every recorded connection from the regenerated outputs.
export function verifyConnections(world) {
  const g = new MorphologicalGrowth(world); const out = [];
  for (const e of world.growth.history.filter(x => x.mode === 'g02b-road-first')) {
    const parent = world.chunks.get(e.parentChunkId); const child = world.chunks.get(e.newChunkId);
    const side = Object.entries(OPPOSITE).find(([, b]) => b === child.generationParameters.growthContext.side)[0];
    const now = g.connect(parent, child, side, joinableEntries(child, child.generationParameters.growthContext));
    const cross = crossConnect(world, g, child, joinableCross(child, child.generationParameters.growthContext.crossCityEntries ?? []));
    const sameNeighbours = !e.neighbourConnections || JSON.stringify(g.connectNeighboursAt(child, e.parentChunkId, e.step).connections) === JSON.stringify(e.neighbourConnections);
    out.push({ step: e.step, same: JSON.stringify(now.connections) === JSON.stringify(e.connections) && JSON.stringify(cross.connections) === JSON.stringify(e.crossCityConnections ?? []) && sameNeighbours });
  }
  return out;
}

// G02c-02: with a ramp plan only roads that meet in height join; the others stay road ends with their stated reason.
function joinableEntries(child, ctx) {
  if (!child.outputs.ramps) return ctx.entryPorts;
  const ok = new Set(child.outputs.ramps.records.filter(r => r.status === RAMP_STATUS.accepted || r.status === RAMP_STATUS.flush).map(r => r.connectionId));
  return ctx.entryPorts.filter(e => ok.has(e.connectionId));
}

// G03c-02: the same rule for the other city's road ends: only ends the ramp plan connects in height may join.
function joinableCross(child, entries) {
  if (!child.outputs.ramps) return entries;
  const ok = new Set(child.outputs.ramps.records.filter(r => r.status === RAMP_STATUS.accepted || r.status === RAMP_STATUS.flush).map(r => r.connectionId));
  return entries.filter(e => ok.has(e.connectionId));
}

// G03b: join accepted cross-city entries to the child's ports, grouped by the other city's chunk and side.
function crossConnect(world, g, child, entries) {
  const out = { connections: [], unmatchedEntries: [] };
  const groups = new Map();
  for (const e of entries) { const k = `${e.otherChunkId}|${e.side}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  for (const list of groups.values()) {
    const other = world.chunks.get(list[0].otherChunkId);
    const r = g.connect(other, child, OPPOSITE[list[0].side], list);
    out.connections.push(...r.connections.map(c => ({ ...c, crossCity: { cityA: other.cityId, cityB: child.cityId } })));
    out.unmatchedEntries.push(...r.unmatchedEntries);
  }
  return out;
}
