// A City of Cities — G03c-01 Emergent Urban Encounter (pure data, runs in Node).
//
// Encounters are read from the real growth, never arranged. After each committed growth event the scheduler calls
// afterCommit(): only the new chunk and the other cities' chunks near it are examined (no world scan), and one or more
// encounter segments are created or updated. Nothing is generated or changed: proposals are records.
//   Commit → territory (registries) → nearby chunks of other cities → segment → states → road / ramp evaluation → decision
// Segment identity: `enc:<cityA>|<cityB>:<chunk of A>:<chunk of B>`, the closest pair when the segment was first seen.
// A later contact joins the segment it lies near (within approachCells of a chunk already in it), so one boundary is
// one record however long the cities grow along it; a contact elsewhere starts a new segment.
// States co-exist: approaching, adjacent, constrained, connectionCandidate, connected. Adjacent ≠ connected.
// Per road end facing the other city across a shared edge (G02c-02 ramp evaluation of the newer chunk):
//   connectionProposed       same point, same height
//   rampConnectionProposed   same point; a ramp in the newer chunk would pass every sampled check
//   adaptationProposed       roads near but not at one point: a connector would be needed (no generator hook yet)
//   separationAccepted       terrain seam above the earthwork limit, or water: needs a structure
//   unresolved               the ramp does not fit before the first junction, or the grade fails
import { DNA_STRATEGY } from '../seed-terrain/networkStrategies.js';
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { CITY_IDS } from './originConfig.js';
import { DIRECTIONS } from './growthDNA.js';
import { constraintOf } from './TerritoryModel.js';
import { ENCOUNTER_RULES, UrbanEncounter, boundaryContext } from './UrbanEncounter.js';
import { RAMP_RULES, RAMP_STATUS, planVertical } from './RoadRampPlanner.js';
import { MORPH_RULES } from './MorphologicalGrowth.js';

export const EMERGENT_RULES = Object.freeze({
  approachCells: ENCOUNTER_RULES.approachCells, // same hypothesis as G03b
  adaptationOffsetM: 48, // roads within this distance along a shared edge could be met by a short connector (G02 port tolerance)
});
export const PROPOSAL = Object.freeze({ connection: 'connectionProposed', ramp: 'rampConnectionProposed', adaptation: 'adaptationProposed', separation: 'separationAccepted', unresolved: 'unresolved' });
const r2 = v => +Number(v).toFixed(2);
const dist = (a, b) => Math.abs(a.worldCoordinate.gx - b.worldCoordinate.gx) + Math.abs(a.worldCoordinate.gy - b.worldCoordinate.gy);
const median = list => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const SIDE = { '1,0': ['maxX', 'minX'], '-1,0': ['minX', 'maxX'], '0,1': ['maxZ', 'minZ'], '0,-1': ['minZ', 'maxZ'] };

export class EmergentEncounterTracker {
  constructor(world, controller) {
    this.world = world; this.controller = controller;
    this.legacy = new UrbanEncounter(world, controller.adapter.morph);
    world.growth.encounters ??= [];
  }

  get segments() { return this.world.growth.encounters; }
  chunksOf(cityId) { return [...this.world.chunks.values()].filter(c => c.cityId === cityId && c.outputs); }

  // Step 0: pairs of cores already within approachCells (a result of placement, marked as such).
  initial() {
    const cores = [...this.world.cities.values()].map(o => this.world.chunks.get(o.originChunkId)).sort((a, b) => a.cityId.localeCompare(b.cityId));
    const out = [];
    for (let i = 0; i < cores.length; i += 1) for (let j = i + 1; j < cores.length; j += 1) if (dist(cores[i], cores[j]) <= EMERGENT_RULES.approachCells) out.push(this.touch(cores[i], cores[j], { step: 0, eventId: null, origin: 'placement' }));
    return out;
  }

  // After a committed event: other cities' chunks near the new chunk. Returns the ids of the segments it updated.
  afterCommit(event, layers) {
    const t0 = (globalThis.performance ?? Date).now();
    const w = this.world; const n = w.chunks.get(event.newChunkId);
    const near = [...w.chunks.values()].filter(c => c.cityId !== n.cityId && c.outputs && dist(c, n) <= EMERGENT_RULES.approachCells).sort((a, b) => dist(a, n) - dist(b, n) || a.chunkId.localeCompare(b.chunkId));
    const ids = new Set();
    const joined = new Set((event.crossCityConnections ?? []).map(c => c.connectionId)); // G03c-02
    for (const other of near) ids.add(this.touch(n, other, { step: event.step, eventId: event.growthEventId, origin: 'growth', layers, joined }));
    return { updated: [...ids].sort(), ms: Math.round((globalThis.performance ?? Date).now() - t0) };
  }

  // Create or update the segment of one near pair, then re-derive its states and decision.
  touch(x, y, { step, eventId, origin, layers = null, joined = new Set() }) {
    const [a, b] = x.cityId < y.cityId ? [x, y] : [y, x];
    const pairOf = s => s.cityA === a.cityId && s.cityB === b.cityId;
    let seg = this.segments.filter(pairOf).sort((p, q) => p.encounterId.localeCompare(q.encounterId)).find(s => s.involvedChunkIds.some(id => { const c = this.world.chunks.get(id); return c.chunkId === y.chunkId || c.chunkId === x.chunkId || (c.cityId === x.cityId ? dist(c, x) : dist(c, y)) <= EMERGENT_RULES.approachCells; }));
    if (!seg) {
      seg = { encounterId: `enc:${a.cityId}|${b.cityId}:${a.chunkId}:${b.chunkId}`, worldSeed: this.world.worldSeed, cityA: a.cityId, cityB: b.cityId, origin, firstStep: step, growthStep: step, involvedChunkIds: [], relatedGrowthEventIds: [], sharedEdges: [], edgeEvaluations: [], timeline: [] };
      this.segments.push(seg);
    }
    for (const id of [a.chunkId, b.chunkId]) if (!seg.involvedChunkIds.includes(id)) seg.involvedChunkIds.push(id);
    seg.involvedChunkIds.sort();
    if (eventId && !seg.relatedGrowthEventIds.includes(eventId)) seg.relatedGrowthEventIds.push(eventId);
    seg.growthStep = step;
    // A shared edge that appears now is evaluated with the layers of the chunk just generated (the newer side).
    if (dist(a, b) === 1) {
      const key = `${a.chunkId}|${b.chunkId}`;
      if (!seg.sharedEdges.some(e => e.key === key)) {
        const newer = layers && (x.chunkId === a.chunkId || x.chunkId === b.chunkId) ? x : null;
        const older = newer === a ? b : a;
        const [sideNewer, sideOlder] = SIDE[`${older.worldCoordinate.gx - (newer ?? a).worldCoordinate.gx},${older.worldCoordinate.gy - (newer ?? a).worldCoordinate.gy}`];
        seg.sharedEdges.push({ key, chunkA: a.chunkId, chunkB: b.chunkId, newerChunkId: newer?.chunkId ?? null, step });
        seg.edgeEvaluations.push(newer ? this.evaluateEdge(newer, sideNewer, older, sideOlder, layers, step, joined) : { key, step, evaluated: false, reason: 'shared at placement: no generation layers for a newer side' });
      }
    }
    this.derive(seg);
    seg.timeline.push({ step, states: Object.entries(seg.states).filter(([, v]) => v).map(([k]) => k), relationshipStatus: seg.relationshipStatus });
    return seg.encounterId;
  }

  // Road ends of the older chunk facing the newer one, evaluated as if the newer chunk could still take a ramp.
  evaluateEdge(newer, sideNewer, older, sideOlder, layers, step, joined = new Set()) {
    const w = this.world; const profile = this.controller.adapter.gradeProfile ?? 'baseline';
    const fields = layers.worldTerrain.fields;
    const entries = older.outputs.ports[sideOlder].filter(p => p.type === 'road').map(p => ({ connectionId: `xconn:${older.chunkId}:${sideOlder}:${p.position}`, kind: 'crossCity', parentChunkId: older.chunkId, parentNodeId: p.nodeId, parentEdgeId: p.edgeId, side: sideNewer, position: p.position, roadClass: p.roadClass, elevation: p.elevation }));
    const plan = planVertical(layers.city.network, fields, createSampler(fields), { profile, chunkId: newer.chunkId, entries });
    const newerPorts = newer.outputs.ports[sideNewer].filter(p => p.type === 'road');
    const pa = older.outputs.profiles[sideOlder]; const pb = newer.outputs.profiles[sideNewer];
    const seam = pa.h.map((h, k) => Math.abs(h - pb.h[k])); const wet = [...pa.w].filter((c, k) => c === '1' || pb.w[k] === '1').length / pa.w.length;
    const ports = plan.records.map(r => {
      const nearest = newerPorts.map(p => ({ p, d: Math.abs(p.position - r.position) })).sort((u, v) => u.d - v.d)[0] ?? null;
      let proposal; let reason = r.reason ?? null;
      if (r.status === RAMP_STATUS.flush) proposal = PROPOSAL.connection;
      else if (r.status === RAMP_STATUS.accepted) proposal = PROPOSAL.ramp;
      else if (r.status === RAMP_STATUS.terrain || r.status === RAMP_STATUS.infrastructure) proposal = PROPOSAL.separation;
      else if (r.status === RAMP_STATUS.network && nearest && nearest.d <= EMERGENT_RULES.adaptationOffsetM) { proposal = PROPOSAL.adaptation; reason = `nearest ${newer.cityId} road ${r2(nearest.d)} m along the edge: a connector would be needed (no generator hook)`; }
      else if (r.status === RAMP_STATUS.network) { proposal = PROPOSAL.separation; reason = nearest ? `nearest ${newer.cityId} road ${r2(nearest.d)} m away along the edge` : `no ${newer.cityId} road on this edge`; }
      else proposal = PROPOSAL.unresolved;
      return { connectionId: r.connectionId, cityId: older.cityId, chunkId: older.chunkId, side: sideOlder, position: r.position, roadClass: r.roadClass, elevation: r.elevationSource, otherCityId: newer.cityId, otherChunkId: newer.chunkId, nearestOffsetM: nearest ? r2(nearest.d) : null, elevationDifferenceM: r.deltaM ?? null, rampStatus: r.status, joined: joined.has(r.connectionId), ramp: r.status === RAMP_STATUS.accepted ? { lengthM: r.rampLengthM, maxGrade: r.maxGrade, allowedGrade: r.allowedGrade, cutM: r.cutMaxM, fillM: r.fillMaxM } : null, proposal, reason };
    });
    return {
      key: `${[older.chunkId, newer.chunkId].sort().join('|')}`, step, evaluated: true, gradeProfile: profile, newerChunkId: newer.chunkId, sideNewer, olderChunkId: older.chunkId, sideOlder,
      terrain: { medianSeamM: r2(median(seam)), maxSeamM: r2(Math.max(...seam)), waterShare: r2(wet), barrier: wet >= ENCOUNTER_RULES.barrierWaterShare || median(seam) > RAMP_RULES.maxGroundOffsetM },
      boundaryContext: { older: boundaryContext(w, older, sideOlder), newer: boundaryContext(w, newer, sideNewer) },
      morphology: { strategies: [DNA_STRATEGY[older.cityId], DNA_STRATEGY[newer.cityId]], orientationDeg: [older.outputs.morph.dominantOrientationDeg, newer.outputs.morph.dominantOrientationDeg], blockMedianM2: [older.outputs.morph.blockAreaMedianM2, newer.outputs.morph.blockAreaMedianM2], heightMeanM: [older.outputs.morph.heightMeanM, newer.outputs.morph.heightMeanM] },
      ports, roadEndsOfNewer: newerPorts.length,
    };
  }

  // States, decision and validation of one segment, from the registries and its stored edge evaluations.
  derive(seg) {
    const w = this.world;
    if (seg.involvedChunkIds.some(id => !w.chunks.get(id)?.outputs)) throw new Error(`${seg.encounterId}: a chunk of the encounter is not generated`);
    const A = seg.involvedChunkIds.map(id => w.chunks.get(id)).filter(c => c.cityId === seg.cityA);
    const B = seg.involvedChunkIds.map(id => w.chunks.get(id)).filter(c => c.cityId === seg.cityB);
    // Closest pair over every chunk of the two cities near the segment (territory read from the registry).
    const allA = this.chunksOf(seg.cityA).filter(c => B.some(b => dist(c, b) <= EMERGENT_RULES.approachCells));
    const allB = this.chunksOf(seg.cityB).filter(c => A.some(a => dist(c, a) <= EMERGENT_RULES.approachCells));
    let best = null;
    for (const a of allA) for (const b of allB) { const d = dist(a, b); if (!best || d < best.d || (d === best.d && `${a.chunkId}|${b.chunkId}` < `${best.a.chunkId}|${best.b.chunkId}`)) best = { a, b, d }; }
    const shared = []; for (const a of allA) for (const b of allB) if (dist(a, b) === 1) shared.push(`${a.chunkId}|${b.chunkId}`);
    const states = { approaching: Boolean(best && best.d <= EMERGENT_RULES.approachCells), adjacent: shared.length > 0, constrained: false, connectionCandidate: false, connected: false };
    const terrainConditions = []; let gap = [];
    if (!states.adjacent && best) {
      gap = gapCells(best.a, best.b);
      for (const c of gap) { const p = w.probe(c.gx, c.gy); const hits = constraintOf(p); terrainConditions.push({ cell: `${c.gx},${c.gy}`, landform: p.landform, meanLandSlopeDeg: p.meanLandSlope, waterFraction: p.waterFraction, buildableFraction: p.buildableFraction, occupiedBy: w.chunkAt(c.gx, c.gy)?.cityId ?? null, ecologicalConstraint: hits ?? [] }); if (hits) states.constrained = true; }
    }
    const ports = seg.edgeEvaluations.filter(e => e.evaluated).flatMap(e => e.ports);
    for (const e of seg.edgeEvaluations.filter(x => x.evaluated)) { terrainConditions.push({ edge: e.key, ...e.terrain }); if (e.terrain.barrier) states.constrained = true; }
    const count = Object.fromEntries(Object.values(PROPOSAL).map(p => [p, ports.filter(x => x.proposal === p).length]));
    if (count.connectionProposed || count.rampConnectionProposed) states.connectionCandidate = true;
    // One free cell between them: both cities' real road fronts into it are read (scheduler candidates, evaluation only).
    const relatedRoadFronts = gap.length === 1 ? this.frontsToward({ cityA: seg.cityA, cityB: seg.cityB, territoryBoundary: { gapCells: gap.map(c => `${c.gx},${c.gy}`) } }) : [];
    if (relatedRoadFronts.filter(x => x.status === 'eligible').map(x => x.cityId).filter((v, i, l) => l.indexOf(v) === i).length === 2) states.connectionCandidate = true;
    // Connected only through verified joins in the road graph (none are built between cities in G03c-01).
    const crossJoins = w.growth.history.some(e => (e.crossCityConnections ?? []).some(c => [c.crossCity.cityA, c.crossCity.cityB].sort().join('|') === `${seg.cityA}|${seg.cityB}`));
    const path = crossJoins ? this.legacy.path(seg.cityA, seg.cityB) : { reachable: false, crossings: 0 };
    states.connected = Boolean(path.reachable && path.crossings > 0);
    const decision = states.connected ? 'connected'
      : count.connectionProposed ? PROPOSAL.connection : count.rampConnectionProposed ? PROPOSAL.ramp : count.adaptationProposed ? PROPOSAL.adaptation
        : states.adjacent && ports.length && ports.every(p => p.proposal === PROPOSAL.separation) ? PROPOSAL.separation
          : states.adjacent && states.constrained && !ports.length ? PROPOSAL.separation : PROPOSAL.unresolved;
    Object.assign(seg, {
      states, minDistanceCells: best?.d ?? null, territoryBoundary: { sharedEdges: shared.sort(), gapCells: gap.map(c => `${c.gx},${c.gy}`), closestPair: best ? [best.a.chunkId, best.b.chunkId] : null },
      relatedRoadFronts, relatedRoadPorts: ports.map(p => p.connectionId), terrainConditions,
      elevationDifference: ports.filter(p => p.elevationDifferenceM !== null).map(p => ({ connectionId: p.connectionId, m: p.elevationDifferenceM })),
      roadGradeConditions: ports.filter(p => p.ramp).map(p => ({ connectionId: p.connectionId, ...p.ramp })),
      connectionCandidates: ports.filter(p => p.proposal === PROPOSAL.connection || p.proposal === PROPOSAL.ramp).map(p => p.connectionId), proposalCounts: count,
      relationshipStatus: decision,
      decisionReason: decision === PROPOSAL.unresolved && !states.adjacent ? `${best.d} cell(s) apart${states.constrained ? ', a constrained cell between' : ''}${states.connectionCandidate ? ', both cities have a valid road front into the cell between' : ''}: no shared edge to evaluate yet` : decision === PROPOSAL.separation ? `every road end across the shared edge needs a structure or has no counterpart (${ports.map(p => p.reason).filter(Boolean)[0] ?? 'no road ends'})` : `${ports.filter(p => p.proposal === decision).length} road end(s) ${decision} of ${ports.length} across ${seg.edgeEvaluations.length} shared edge(s)`,
      validationStatus: states.connected ? `verified: path ${path.lengthM} m over ${path.crossings} cross-city join(s)` : states.connectionCandidate ? 'proposal only: no cross-city road is built (G03c-02)' : 'not connected',
    });
  }

  // Road fronts of both cities toward the segment's gap cells, from the current scheduler candidates (evaluation only).
  frontsToward(seg) {
    const step = this.world.growth.step + 1; const cells = new Set(seg.territoryBoundary.gapCells);
    return [seg.cityA, seg.cityB].flatMap(id => (this.controller.cities.includes(id) ? this.controller.adapter.candidates(id, step, this.controller.dna[id]) : []).filter(c => cells.has(`${c.gx},${c.gy}`)).map(c => ({ cityId: id, candidateId: c.candidateId, growthFrontId: c.growthFrontId ?? null, status: c.status, reason: c.rejectionReason ?? null })));
  }
}

// Free cells on the L-shaped (x first) path between two chunks, exclusive (same rule as G03b).
function gapCells(a, b) {
  const out = []; let { gx, gy } = a.worldCoordinate; const t = b.worldCoordinate;
  while (gx !== t.gx || gy !== t.gy) { if (gx !== t.gx) gx += Math.sign(t.gx - gx); else gy += Math.sign(t.gy - gy); if (gx !== t.gx || gy !== t.gy) out.push({ gx, gy }); }
  return out;
}
export { CITY_IDS, DIRECTIONS, MORPH_RULES };
