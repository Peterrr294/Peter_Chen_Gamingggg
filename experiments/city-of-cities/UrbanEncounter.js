// A City of Cities — G03b Urban Encounter & Morphological Negotiation (pure data, runs in Node).
//
// When two cities grow toward each other, the meeting is detected, both boundaries are read, and a negotiation
// decides what the newcomer may do at the shared edge. Nothing in either city's existing fabric is changed.
//
//   UrbanEncounterDetector     per city pair, co-existing states (not one enum):
//       approaching            nearest chunks of the two cities are ≤ approachCells apart (Manhattan, hypothesis)
//       adjacent               the two cities share a chunk edge
//       constrained            a free cell between them is an ecological constraint (G03a rules) or every road entry
//                              into it exceeds the entry step; for a shared edge: the edge is mostly water or the
//                              median height step across it exceeds the entry step
//       connectionCandidate    at least one road port of one city passes the hard interface constraints toward the
//                              other (free cell between them, or the shared edge)
//       connected              a recorded cross-city road join exists AND a graph path core ↔ core is found
//   MorphologicalBoundaryContext   road / morphology / geography of one chunk side, from generated data only;
//                              a quantity the system does not store is reported as 'unavailable (…)'
//   negotiate(newcomer, target)    reads BOTH cities, scores the other city's ports facing the target, applies the
//                              hard constraints, and returns one of:
//       separation             no interface passes (barrier); nothing is filled, flattened or deleted
//       connection             the newcomer's generator can take the accepted ports as entry gates (organic DNA):
//                              the new chunk adapts locally, joins are made by identity (≤ 0.5 m, same type)
//       plan (Pending)         the newcomer's generator has no safe hook to adapt (grid DNA keeps its own lines):
//                              a verifiable connector plan is recorded, nothing is generated for it
// Decisions are stored in world.growth.encounterDecisions (saved / restored with the world state).
import { DNA_STRATEGY } from '../seed-terrain/networkStrategies.js';
import { CHUNK_SIZE } from './originConfig.js';
import { DIRECTIONS } from './growthDNA.js';
import { constraintOf } from './TerritoryModel.js';
import { MORPH_RULES, portPoint } from './MorphologicalGrowth.js';

// Public parameters (each with a spatial meaning; thresholds are hypotheses, not calibrated).
export const ENCOUNTER_RULES = Object.freeze({
  approachCells: 3, // cells: nearest chunks of two cities at most this far apart (Manhattan) are "approaching"
  maxEntryStep: MORPH_RULES.maxEntryStep, // m: port elevation vs. ground on the other side of the edge (same as G02b)
  maxGrade: 0.1, // rise / run over the first gradeRun metres into the target cell
  gradeRun: 32, // m
  maxCrossingDeg: 30, // °: a road may meet the shared edge at most this far from perpendicular
  maxInterfaces: 2, // accepted cross-city interfaces per negotiation ("a few major nodes")
  minInterfaceSpacing: 200, // m between accepted interfaces along the edge
  barrierWaterShare: 0.5, // share of a shared edge that is water → barrier
});
const H = CHUNK_SIZE / 2;
const r2 = v => +Number(v).toFixed(2);
const OPPOSITE = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' };
const SIDE_TO = { maxX: [1, 0], minX: [-1, 0], maxZ: [0, 1], minZ: [0, -1] };
const median = list => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const pairKey = (a, b) => [a, b].sort();

// ---------- MorphologicalBoundaryContext ----------
export function boundaryContext(world, chunk, side, connectivityShare = null) {
  const o = chunk.outputs; const m = o.morph ?? {};
  const roads = o.ports[side].filter(p => p.type === 'road').sort((a, b) => a.position - b.position);
  const gaps = roads.slice(1).map((p, i) => r2(p.position - roads[i].position));
  const prof = o.profiles[side];
  const probe = world.probe(chunk.worldCoordinate.gx, chunk.worldCoordinate.gy);
  return {
    chunkId: chunk.chunkId, cityId: chunk.cityId, side, strategy: DNA_STRATEGY[chunk.cityId],
    road: {
      orientationDeg: m.dominantOrientationDeg ?? 'unavailable', orientationConcentration: m.orientationConcentration ?? 'unavailable',
      hierarchy: { primary: roads.filter(p => p.roadClass === 'primary').length, secondary: roads.filter(p => p.roadClass === 'secondary').length, other: roads.filter(p => !['primary', 'secondary'].includes(p.roadClass)).length },
      endpoints: roads.map(p => ({ position: p.position, roadClass: p.roadClass, elevation: p.elevation, crossingDeg: crossingDeg(side, p.directionDeg), nodeId: p.nodeId, edgeId: p.edgeId })),
      spacingM: { median: median(gaps), min: gaps.length ? Math.min(...gaps) : null, gridPrimary: o.grid?.primarySpacing ?? 'unavailable (no fixed grid: organic / canal network)' },
      connectivity: connectivityShare === null ? 'unavailable (city graph not computed)' : { reachableFromCoreShare: connectivityShare },
    },
    morphology: {
      blockAreaMedianM2: m.blockAreaMedianM2 ?? 'unavailable', blockOrientationDeg: m.dominantOrientationDeg ?? 'unavailable', blockAspectMedian: m.blockAspectMedian ?? 'unavailable',
      boundaryBlocks: o.boundaryBlocks?.[side] ?? 'unavailable', parcelFrontageMedianM: m.parcelFrontageMedianM ?? 'unavailable',
      parcelDepthM: 'unavailable (parcel depth is not stored by the parcel generator)', buildingCoverage: m.buildingCoverage ?? 'unavailable',
      heightM: { mean: m.heightMeanM ?? null, p90: m.heightP90M ?? null, max: m.heightMaxM ?? null },
    },
    geography: {
      edgeHeightM: { min: r2(Math.min(...prof.h)), median: r2(median(prof.h)), max: r2(Math.max(...prof.h)) },
      cellMeanSlopeDeg: probe.meanLandSlope, edgeWaterShare: probe.edges[side]?.waterShare ?? 'unavailable', edgeBuildableShare: probe.edges[side]?.buildableShare ?? 'unavailable',
      constraints: constraintOf(probe) ?? [],
    },
  };
}

// Angle between a road at a port and the normal of the side (0 = perpendicular crossing).
function crossingDeg(side, directionDeg) {
  if (directionDeg === undefined || directionDeg === null) return null;
  const normal = side.endsWith('X') ? 0 : 90;
  const d = ((directionDeg - normal) % 180 + 180) % 180;
  return r2(Math.min(d, 180 - d));
}

// ---------- UrbanEncounterDetector ----------
export class UrbanEncounter {
  constructor(world, morph) { this.world = world; this.morph = morph; }

  chunksOf(cityId) { return [...this.world.chunks.values()].filter(c => c.cityId === cityId && c.outputs).sort((a, b) => a.chunkId.localeCompare(b.chunkId)); }

  // Hard-constraint evaluation of one city's road ports on `side` of `chunk`, toward the cell on the other side.
  interfaces(chunk, side) {
    const [dx, dy] = SIDE_TO[side];
    const gx = chunk.worldCoordinate.gx + dx; const gy = chunk.worldCoordinate.gy + dy;
    const occupant = this.world.chunkAt(gx, gy);
    const ground = occupant?.outputs ? null : this.morph.targetTerrain(gx, gy).height;
    const inward = { x: dx, z: dy };
    return chunk.outputs.ports[side].filter(p => p.type === 'road').map(p => {
      const pt = portPoint(chunk, side, p.position);
      const at = ground ? ground(pt.x, pt.z) : null;
      const ahead = ground ? ground(pt.x + inward.x * ENCOUNTER_RULES.gradeRun, pt.z + inward.z * ENCOUNTER_RULES.gradeRun) : null;
      const step = at === null ? null : r2(at - p.elevation);
      const grade = ahead === null ? null : r2(Math.abs(ahead - p.elevation) / ENCOUNTER_RULES.gradeRun);
      const crossing = crossingDeg(side, p.directionDeg);
      const reasons = [];
      if (step !== null && Math.abs(step) > ENCOUNTER_RULES.maxEntryStep) reasons.push(`entry step ${step} m > ${ENCOUNTER_RULES.maxEntryStep} m`);
      if (grade !== null && grade > ENCOUNTER_RULES.maxGrade) reasons.push(`grade ${grade} > ${ENCOUNTER_RULES.maxGrade} over ${ENCOUNTER_RULES.gradeRun} m`);
      if (crossing !== null && crossing > ENCOUNTER_RULES.maxCrossingDeg) reasons.push(`crossing ${crossing}° > ${ENCOUNTER_RULES.maxCrossingDeg}° from perpendicular`);
      const score = reasons.length ? 0 : r2((p.roadClass === 'primary' ? 0.4 : 0.2) + 0.3 * (1 - Math.abs(step ?? 0) / ENCOUNTER_RULES.maxEntryStep) + 0.3 * (1 - (crossing ?? 0) / 90));
      return { candidateId: `iface:${chunk.chunkId}:${side}:${p.position}`, chunkId: chunk.chunkId, cityId: chunk.cityId, side, position: p.position, point: { x: r2(pt.x), z: r2(pt.z) }, roadClass: p.roadClass, elevation: p.elevation, nodeId: p.nodeId, edgeId: p.edgeId, stepM: step, grade, crossingDeg: crossing, score, accepted: false, reasons };
    });
  }

  // Detect encounters for every pair of cities (derived from the world; decisions come from the history).
  detect(step = this.world.growth.step) {
    const ids = [...this.world.cities.keys()].sort();
    const out = [];
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
      const e = this.pair(ids[i], ids[j], step);
      if (e) out.push(e);
    }
    return out;
  }

  pair(cityA, cityB, step) {
    const w = this.world; const A = this.chunksOf(cityA); const B = this.chunksOf(cityB);
    let best = null; const shared = [];
    for (const a of A) for (const b of B) {
      const d = Math.abs(a.worldCoordinate.gx - b.worldCoordinate.gx) + Math.abs(a.worldCoordinate.gy - b.worldCoordinate.gy);
      if (!best || d < best.d || (d === best.d && `${a.chunkId}|${b.chunkId}` < `${best.a.chunkId}|${best.b.chunkId}`)) best = { a, b, d };
      if (d === 1) shared.push({ a, b, sideA: sideBetween(a, b), sideB: OPPOSITE[sideBetween(a, b)] });
    }
    if (!best || best.d > ENCOUNTER_RULES.approachCells) return null;
    const encounterId = `enc:${cityA}|${cityB}`;
    const decisions = (w.growth.encounterDecisions ?? []).filter(d => d.encounterId === encounterId);
    const states = { approaching: true, adjacent: shared.length > 0, constrained: false, connectionCandidate: false, connected: false };
    const terrainConditions = []; const roadInterfaceConditions = []; let boundaryLocation;
    const fronts = [...this.morph.fronts(cityA, step + 1), ...this.morph.fronts(cityB, step + 1)];
    let relevantFronts = [];
    if (shared.length) {
      boundaryLocation = { kind: 'sharedEdge', edges: shared.map(s => ({ chunkA: s.a.chunkId, sideA: s.sideA, chunkB: s.b.chunkId, sideB: s.sideB, point: edgeMid(s.a, s.sideA) })) };
      for (const s of shared) {
        const pa = s.a.outputs.profiles[s.sideA]; const pb = s.b.outputs.profiles[s.sideB];
        const dh = pa.h.map((h, k) => Math.abs(h - pb.h[k]));
        const wet = [...pa.w].filter((x, k) => x === '1' || pb.w[k] === '1').length / pa.w.length;
        const barrier = wet >= ENCOUNTER_RULES.barrierWaterShare || median(dh) > ENCOUNTER_RULES.maxEntryStep;
        terrainConditions.push({ edge: `${s.a.chunkId}:${s.sideA}`, medianHeightStepM: r2(median(dh)), maxHeightStepM: r2(Math.max(...dh)), waterShare: r2(wet), barrier });
        if (barrier) states.constrained = true;
        const pA = s.a.outputs.ports[s.sideA].filter(p => p.type === 'road'); const pB = s.b.outputs.ports[s.sideB].filter(p => p.type === 'road');
        const aligned = pA.map(p => ({ p, q: pB.map(q => ({ q, d: Math.abs(q.position - p.position) })).sort((x, y) => x.d - y.d)[0] })).filter(x => x.q);
        roadInterfaceConditions.push({ edge: `${s.a.chunkId}:${s.sideA}`, portsA: pA.length, portsB: pB.length, primaryA: pA.filter(p => p.roadClass === 'primary').length, primaryB: pB.filter(p => p.roadClass === 'primary').length,
          alignedWithinTolerance: aligned.filter(x => x.q.d <= MORPH_RULES.portTolerance).length, nearestOffsetsM: aligned.map(x => r2(x.q.d)), elevationStepsM: aligned.map(x => r2(x.q.q.elevation - x.p.elevation)) });
        if (aligned.some(x => x.q.d <= MORPH_RULES.portTolerance && Math.abs(x.q.q.elevation - x.p.elevation) <= ENCOUNTER_RULES.maxEntryStep)) states.connectionCandidate = true;
      }
    } else {
      const gap = gapCells(best.a, best.b);
      boundaryLocation = { kind: 'gap', cells: gap.map(c => `${c.gx},${c.gy}`), between: [best.a.chunkId, best.b.chunkId], point: w.cellToWorld(gap[Math.floor(gap.length / 2)]?.gx ?? best.a.worldCoordinate.gx, gap[Math.floor(gap.length / 2)]?.gy ?? best.a.worldCoordinate.gy) };
      relevantFronts = fronts.filter(f => gap.some(c => c.gx === f.target.gx && c.gy === f.target.gy));
      for (const c of gap) {
        const probe = w.probe(c.gx, c.gy); const hits = constraintOf(probe);
        const into = relevantFronts.filter(f => f.target.gx === c.gx && f.target.gy === c.gy);
        const allRefused = into.length > 0 && into.every(f => f.status === 'rejected');
        terrainConditions.push({ cell: `${c.gx},${c.gy}`, landform: probe.landform, meanLandSlopeDeg: probe.meanLandSlope, buildableFraction: probe.buildableFraction, waterFraction: probe.waterFraction, ecologicalConstraint: hits ?? [], frontsInto: into.map(f => ({ growthFrontId: f.growthFrontId, status: f.status, reason: f.reason })) });
        if (hits || allRefused) states.constrained = true;
      }
      // Interfaces toward a single free cell between the two cities (the cell where they would meet).
      if (gap.length === 1) {
        for (const [ch, other] of [[best.a, best.b], [best.b, best.a]]) {
          const side = sideToward(ch, gap[0]);
          if (!side) continue;
          const list = this.interfaces(ch, side);
          roadInterfaceConditions.push({ from: `${ch.chunkId}:${side}`, toward: `${gap[0].gx},${gap[0].gy}`, ports: list.length, passing: list.filter(x => !x.reasons.length).length, rejected: list.filter(x => x.reasons.length).map(x => ({ position: x.position, reasons: x.reasons })) });
          if (list.some(x => !x.reasons.length) && relevantFronts.some(f => f.status === 'eligible' && f.sourceChunkId === other.chunkId)) states.connectionCandidate = true;
        }
      }
    }
    if (shared.length) relevantFronts = fronts.filter(f => shared.some(s => f.sourceChunkId === s.a.chunkId || f.sourceChunkId === s.b.chunkId));
    const crossLinks = w.growth.history.filter(e => e.crossCityConnections?.length && [cityA, cityB].includes(e.cityId)).flatMap(e => e.crossCityConnections).filter(c => pairKey(c.crossCity.cityA, c.crossCity.cityB).join('|') === `${cityA}|${cityB}`);
    const path = crossLinks.length ? this.path(cityA, cityB) : null;
    states.connected = Boolean(path?.reachable);
    const last = decisions.at(-1) ?? null;
    if (last?.acceptedInterfaces.length) states.connectionCandidate = true; // interfaces passed the hard constraints when negotiated
    const currentRelationship = states.connected ? 'connected' : last?.outcome === 'plan' ? 'adjacent — connection plan pending' : states.adjacent && states.constrained ? 'adjacent — separated by a natural barrier' : states.adjacent ? 'adjacent — not connected' : states.constrained ? 'approaching — barrier between' : 'approaching';
    return {
      encounterId, cityA, cityB, step, states,
      participatingChunkIds: [...new Set(shared.length ? shared.flatMap(s => [s.a.chunkId, s.b.chunkId]) : [best.a.chunkId, best.b.chunkId])].sort(),
      distanceCells: best.d, boundaryLocation,
      relevantGrowthFrontIds: relevantFronts.map(f => f.growthFrontId).sort(),
      terrainConditions, roadInterfaceConditions,
      crossCityConnections: crossLinks.map(c => c.connectionId),
      currentRelationship,
      decisionReason: last?.reason ?? (states.constrained ? 'barrier measured between the cities (no decision yet)' : 'no negotiation yet'),
      validationStatus: states.connected ? `verified: path ${path.lengthM} m core ↔ core over ${path.crossings} cross-city join(s)` : crossLinks.length ? 'FAILED: cross-city joins recorded but no core ↔ core path' : last?.outcome === 'plan' ? 'pending (plan not generated)' : 'not applicable (no connection)',
      decisions: decisions.map(d => d.decisionId),
    };
  }

  // Road graph of both cities + their own G02b joins + cross-city joins; Dijkstra from core A to core B.
  path(cityA, cityB) {
    const w = this.world; const adj = new Map(); const nodes = new Set();
    const add = (a, b, len) => { for (const n of [a, b]) { if (!adj.has(n)) adj.set(n, []); nodes.add(n); } adj.get(a).push([b, len]); adj.get(b).push([a, len]); };
    for (const c of [...this.chunksOf(cityA), ...this.chunksOf(cityB)]) for (const [f, t, len] of c.outputs.roadGraph) add(`${c.chunkId}:${f}`, `${c.chunkId}:${t}`, len);
    // G03c-01: every recorded join (parent, same-city neighbour, cross-city) enters only if both nodes are in the road
    // graphs, it is not a duplicate, and, where a ramp plan exists, the two ends meet in height. Rejected ends are never joins.
    let crossings = 0; const seen = new Set(); const invalid = [];
    const inGraph = id => nodes.has(id);
    const join = (l, cross, ramped) => {
      const a = `${l.parent.chunkId}:${l.parent.nodeId}`; const b = `${l.child.chunkId}:${l.child.nodeId}`; const k = [a, b].sort().join('~');
      if (!inGraph(a) || !inGraph(b)) { invalid.push({ connectionId: l.connectionId, reason: 'node not in the road graph' }); return; }
      if (ramped && Math.abs(l.elevationStepM) > 0.06) { invalid.push({ connectionId: l.connectionId, reason: `height step ${l.elevationStepM} m` }); return; }
      if (seen.has(k)) return; seen.add(k); add(a, b, 0); if (cross) crossings += 1;
    };
    for (const e of w.growth.history.filter(x => x.mode === 'g02b-road-first' && [cityA, cityB].includes(x.cityId))) {
      const ramped = Boolean(e.ramps);
      for (const l of e.connections) join(l, false, ramped);
      for (const l of e.neighbourConnections ?? []) join(l, false, ramped);
      for (const l of e.crossCityConnections ?? []) join(l, true, ramped);
    }
    const src = [...nodes].filter(n => n.startsWith(`${w.cities.get(cityA).originChunkId}:`));
    const dst = new Set([...nodes].filter(n => n.startsWith(`${w.cities.get(cityB).originChunkId}:`)));
    const dist = new Map(src.map(n => [n, 0])); const prev = new Map(); const done = new Set();
    // Small graphs (≤ a few thousand nodes): array-scan Dijkstra keeps the code plain.
    const open = new Set(src); let hit = null;
    while (open.size) {
      let u = null; for (const n of open) if (u === null || dist.get(n) < dist.get(u) || (dist.get(n) === dist.get(u) && n < u)) u = n;
      open.delete(u); done.add(u);
      if (dst.has(u)) { hit = u; break; }
      for (const [v, len] of adj.get(u)) { if (done.has(v)) continue; const d = dist.get(u) + len; if (!dist.has(v) || d < dist.get(v)) { dist.set(v, d); prev.set(v, u); open.add(v); } }
    }
    if (!hit) return { reachable: false, crossings, lengthM: null, chunks: [], invalidJoins: invalid, joinsUsed: seen.size };
    const route = [hit]; while (prev.has(route[0])) route.unshift(prev.get(route[0]));
    return { reachable: true, crossings, lengthM: Math.round(dist.get(hit)), from: route[0], to: hit, nodes: route.length, chunks: [...new Set(route.map(n => n.split(':')[0]))], invalidJoins: invalid, joinsUsed: seen.size };
  }

  // ---------- Negotiation: newcomer `cityId` wants to grow into `target` ----------
  negotiate(cityId, target) {
    const w = this.world; const step = w.growth.step + 1;
    const fronts = this.morph.fronts(cityId, step).filter(f => f.target.gx === target.gx && f.target.gy === target.gy);
    const own = fronts.find(f => f.status === 'eligible') ?? null;
    // Other cities' chunks that would share an edge with the new chunk.
    const neighbours = Object.values(DIRECTIONS).map(([dx, dy, side]) => ({ chunk: w.chunkAt(target.gx + dx, target.gy + dy), childSide: side })).filter(n => n.chunk && n.chunk.cityId !== cityId && n.chunk.outputs);
    const decisions = [];
    for (const n of neighbours) {
      const other = n.chunk; const otherSide = OPPOSITE[n.childSide];
      const encounterId = `enc:${pairKey(cityId, other.cityId).join('|')}`;
      const candidates = this.interfaces(other, otherSide);
      const contextNew = own ? boundaryContext(w, w.chunks.get(own.sourceChunkId), own.side) : null;
      const contextOther = boundaryContext(w, other, otherSide, this.morph.connectivity(other.cityId).perChunk[other.chunkId]?.reachableFromCoreShare ?? null);
      // Accept the best passing candidates, primary first, spaced along the edge.
      const passing = candidates.filter(c => !c.reasons.length).sort((a, b) => b.score - a.score || a.position - b.position);
      const accepted = [];
      for (const c of passing) {
        if (accepted.length >= ENCOUNTER_RULES.maxInterfaces) { c.reasons.push(`not selected: ${ENCOUNTER_RULES.maxInterfaces} interfaces already accepted`); continue; }
        if (accepted.some(a => Math.abs(a.position - c.position) < ENCOUNTER_RULES.minInterfaceSpacing)) { c.reasons.push(`not selected: closer than ${ENCOUNTER_RULES.minInterfaceSpacing} m to an accepted interface`); continue; }
        c.accepted = true; accepted.push(c);
      }
      const strategy = DNA_STRATEGY[cityId];
      let outcome; let reason; let plan = null;
      if (!own) { outcome = 'separation'; reason = `${cityId} cannot enter ${target.gx},${target.gy}: ${fronts.map(f => f.reason).join('; ') || 'no growth front toward this cell'}`; }
      else if (!accepted.length) { outcome = 'separation'; reason = `no ${other.cityId} road on ${other.chunkId}:${otherSide} passes the hard constraints (${candidates.map(c => c.reasons[0]).join('; ') || 'no road port'}); the edge stays closed, terrain unchanged`; }
      else if (strategy === 'organic') { outcome = 'connection'; reason = `${accepted.length} ${other.cityId} road(s) accepted as entry gates of the new ${cityId} chunk (organic lanes adapt locally; ${other.cityId} unchanged)`; }
      else {
        outcome = 'plan';
        reason = `${cityId} uses a ${strategy} network that keeps its own inherited lines; the generator has no safe hook to bend them toward ${other.cityId} ports, so no connector is generated`;
        plan = { status: 'Pending verification (not generated)', proposal: 'after the newcomer is generated, join each accepted interface to the nearest newcomer road on the shared edge with a short boundary connector', interfaces: accepted.map(c => c.candidateId) };
      }
      decisions.push({
        decisionId: `${encounterId}:step${step}:${cityId}->${target.gx},${target.gy}`, encounterId, step, worldSeed: w.worldSeed, version: 'g03b-1',
        newcomer: cityId, other: other.cityId, targetCell: target, otherChunkId: other.chunkId, otherSide, childSide: n.childSide, newcomerFront: own?.growthFrontId ?? null,
        constraintParams: { ...ENCOUNTER_RULES, portTolerance: MORPH_RULES.portTolerance },
        boundaryContext: { newcomer: contextNew, other: contextOther },
        candidates, acceptedInterfaces: accepted.map(c => c.candidateId), rejectedInterfaces: candidates.filter(c => !c.accepted).map(c => ({ candidateId: c.candidateId, reasons: c.reasons })),
        outcome, reason, plan, allowedChanges: outcome === 'connection' ? `entry gates of the new chunk ${target.gx},${target.gy} only` : 'none', modifiedObjects: [], generatedObjects: [],
      });
    }
    return { step, target, own, fronts, decisions };
  }

  // Negotiate, then grow; the decision is completed with what was generated. Returns { decisions, result }.
  growWithNegotiation(cityId, target) {
    const w = this.world;
    const n = this.negotiate(cityId, target);
    const connect = n.decisions.find(d => d.outcome === 'connection');
    const crossCityEntries = connect ? connect.candidates.filter(c => c.accepted).map(c => ({ connectionId: `xconn:${c.chunkId}:${c.side}:${c.position}`, side: connect.childSide, point: c.point, roadClass: c.roadClass, type: 'road', elevation: c.elevation, parentNodeId: c.nodeId, parentEdgeId: c.edgeId, otherCityId: c.cityId, otherChunkId: c.chunkId })) : [];
    const result = n.own ? this.morph.grow(cityId, { target, crossCityEntries, encounterId: connect?.encounterId }) : { failure: { step: n.step, cityId, reason: 'no eligible growth front toward the target', fronts: n.fronts.map(f => ({ growthFrontId: f.growthFrontId, reason: f.reason })) } };
    for (const d of n.decisions) {
      if (result.failure) { d.result = { grown: false, reason: result.failure.reason }; continue; }
      const ev = result.event; const child = result.chunk;
      d.result = { grown: true, growthEventId: ev.growthEventId, newChunkId: ev.newChunkId };
      d.generatedObjects = [ev.newChunkId, ...ev.generatedRoadIds];
      if (d.outcome === 'connection') {
        d.crossCityConnections = ev.crossCityConnections; d.unmatched = ev.crossCityUnmatched;
        if (!ev.crossCityConnections.length) { d.outcome = 'separation'; d.reason += ' — but no child road reached an accepted point (recorded as separation)'; }
      } else {
        // Coincident joins are still checked by the same identity rule (same type, ≤ 0.5 m); plans list real offsets.
        const pairs = this.interfaces(w.chunks.get(d.otherChunkId), d.otherSide).map(c => {
          const near = child.outputs.ports[d.childSide].filter(p => p.type === 'road').map(p => ({ p, d: Math.abs(p.position - c.position) })).sort((a, b) => a.d - b.d)[0];
          return { candidateId: c.candidateId, otherPosition: c.position, newcomerPosition: near?.p.position ?? null, offsetM: near ? r2(near.d) : null, elevationStepM: near ? r2(near.p.elevation - c.elevation) : null };
        });
        d.coincidentJoins = pairs.filter(p => p.offsetM !== null && p.offsetM <= MORPH_RULES.portTolerance && Math.abs(p.elevationStepM) <= ENCOUNTER_RULES.maxEntryStep);
        if (d.plan) d.plan.connectors = pairs.filter(p => d.plan.interfaces.includes(p.candidateId)).map(p => ({ ...p, connectorLengthM: p.offsetM, gradeAlongEdge: p.offsetM ? r2(Math.abs(p.elevationStepM) / p.offsetM) : null }));
      }
    }
    w.growth.encounterDecisions = [...(w.growth.encounterDecisions ?? []), ...n.decisions];
    return { decisions: n.decisions, result };
  }
}

function sideBetween(a, b) {
  const dx = b.worldCoordinate.gx - a.worldCoordinate.gx; const dy = b.worldCoordinate.gy - a.worldCoordinate.gy;
  return dx === 1 ? 'maxX' : dx === -1 ? 'minX' : dy === 1 ? 'maxZ' : 'minZ';
}
function sideToward(chunk, cell) {
  const dx = cell.gx - chunk.worldCoordinate.gx; const dy = cell.gy - chunk.worldCoordinate.gy;
  return Math.abs(dx) + Math.abs(dy) !== 1 ? null : dx === 1 ? 'maxX' : dx === -1 ? 'minX' : dy === 1 ? 'maxZ' : 'minZ';
}
function edgeMid(chunk, side) { const [dx, dy] = SIDE_TO[side]; return { x: chunk.worldOrigin.x + dx * H, z: chunk.worldOrigin.z + dy * H }; }
// Free cells on the straight (L-shaped, x first) path between two chunks, exclusive.
function gapCells(a, b) {
  const out = []; let { gx, gy } = a.worldCoordinate; const t = b.worldCoordinate;
  while (gx !== t.gx || gy !== t.gy) { if (gx !== t.gx) gx += Math.sign(t.gx - gx); else gy += Math.sign(t.gy - gy); if (gx !== t.gx || gy !== t.gy) out.push({ gx, gy }); }
  return out;
}
