// A City of Cities — G03c-02 Inter-City Road Connection (pure data, runs in Node).
//
// A road between two cities is built only where it can be built without touching what is already committed:
// in the newcomer chunk, before it is committed, as part of its own Plan → Generate → Validate → Commit.
//   1. Interfaces: every road end of another city's committed chunk on the edge the newcomer will share. Each is read
//      from both sides (other city: class, direction, elevation; newcomer cell: real ground at that point) and checked
//      against hard limits: earthwork limit of the ramp plan, crossing angle (G03b). Scores and limits are assumptions.
//   2. Negotiation by the newcomer's DNA (G03b rule): an organic newcomer takes at most two accepted interfaces, 200 m
//      apart, as entry gates of its lanes; a grid newcomer keeps its inherited lines and offers only its own coincident
//      road ends (no connector hook exists, so a mismatch stays a plan).
//   3. The G02c-02 ramp plan grades the newcomer's road from the other city's elevation; only an end that meets in XY
//      and height joins (crossCityConnections), and validation refuses a join that does not.
//   4. After commit: one connection record per join, and Connected only when a core-to-core path exists in the graph.
// The other city's chunks, every core and the terrain are never changed. A connection belongs to both cities by record
// (cityA, cityB); no new City ID exists and territories do not merge.
import { DNA_STRATEGY } from '../seed-terrain/networkStrategies.js';
import { DIRECTIONS } from './growthDNA.js';
import { ENCOUNTER_RULES } from './UrbanEncounter.js';
import { RAMP_RULES, RAMP_STATUS } from './RoadRampPlanner.js';
import { portPoint } from './MorphologicalGrowth.js';

// Uncalibrated experiment parameters.
export const INTERCITY_RULES = Object.freeze({
  maxGroundOffsetM: RAMP_RULES.maxGroundOffsetM, // interface: other city's road end vs. the newcomer's ground at that point
  maxCrossingDeg: ENCOUNTER_RULES.maxCrossingDeg, // interface: road at most this far from perpendicular to the edge
  maxInterfaces: ENCOUNTER_RULES.maxInterfaces, // accepted gates per shared edge (organic newcomer)
  minInterfaceSpacing: ENCOUNTER_RULES.minInterfaceSpacing, // m between accepted gates
  score: { primary: 0.4, secondary: 0.2, other: 0.1, step: 0.3, crossing: 0.3 }, // class + height + angle
});
const r2 = v => +Number(v).toFixed(2);
const crossingDeg = (side, directionDeg) => { const normal = side.endsWith('X') ? 0 : 90; const d = ((directionDeg - normal) % 180 + 180) % 180; return r2(Math.min(d, 180 - d)); };

// Interfaces and the negotiated entries for a newcomer `cityId` about to grow into `target`.
export function interCityPlan(world, morph, cityId, target) {
  const strategy = DNA_STRATEGY[cityId]; const ground = morph.targetTerrain(target.gx, target.gy).height;
  const S = INTERCITY_RULES; const edges = [];
  for (const [, [dx, dy, childSide, otherSide]] of Object.entries(DIRECTIONS)) {
    const other = world.chunkAt(target.gx + dx, target.gy + dy);
    if (!other || other.cityId === cityId || !other.outputs) continue;
    const interfaces = other.outputs.ports[otherSide].filter(p => p.type === 'road').map(p => {
      const pt = portPoint(other, otherSide, p.position); const g = ground(pt.x, pt.z); const step = r2(g - p.elevation); const crossing = crossingDeg(otherSide, p.directionDeg ?? 0);
      const reasons = [];
      if (Math.abs(step) > S.maxGroundOffsetM) reasons.push(`terrain seam ${Math.abs(step)} m over the ${S.maxGroundOffsetM} m earthwork limit`);
      if (crossing > S.maxCrossingDeg) reasons.push(`crossing ${crossing}° over ${S.maxCrossingDeg}° from perpendicular`);
      const score = reasons.length ? 0 : r2((S.score[p.roadClass] ?? S.score.other) + S.score.step * (1 - Math.abs(step) / S.maxGroundOffsetM) + S.score.crossing * (1 - crossing / 90));
      return { connectionId: `xconn:${other.chunkId}:${otherSide}:${p.position}`, cityId: other.cityId, chunkId: other.chunkId, side: otherSide, childSide, position: p.position, point: { x: r2(pt.x), z: r2(pt.z) }, roadClass: p.roadClass, elevation: p.elevation, nodeId: p.nodeId, edgeId: p.edgeId, groundOfNewcomer: r2(g), stepM: step, crossingDeg: crossing, score, reasons, accepted: false };
    });
    const passing = interfaces.filter(i => !i.reasons.length).sort((a, b) => b.score - a.score || a.position - b.position);
    if (strategy === 'organic') {
      for (const i of passing) {
        if (passing.filter(x => x.accepted).length >= S.maxInterfaces) { i.reasons.push(`not selected: ${S.maxInterfaces} gates already accepted`); continue; }
        if (passing.some(x => x.accepted && Math.abs(x.position - i.position) < S.minInterfaceSpacing)) { i.reasons.push(`not selected: closer than ${S.minInterfaceSpacing} m to an accepted gate`); continue; }
        i.accepted = true;
      }
    } else for (const i of passing) i.accepted = true; // a grid keeps its lines: only a road end of its own at the same point can meet these
    edges.push({ otherChunkId: other.chunkId, otherCityId: other.cityId, otherSide, childSide, newcomerStrategy: strategy, mode: strategy === 'organic' ? 'gates (lanes adapt in the new chunk)' : `${strategy}: own lines only; a mismatch stays a plan (no connector hook)`, interfaces });
  }
  const accepted = edges.flatMap(e => e.interfaces.filter(i => i.accepted));
  const entry = i => ({ connectionId: i.connectionId, side: i.childSide, point: i.point, roadClass: i.roadClass, type: 'road', elevation: i.elevation, parentNodeId: i.nodeId, parentEdgeId: i.edgeId, otherCityId: i.cityId, otherChunkId: i.chunkId });
  return {
    edges,
    gates: accepted.map(entry), // organic lanes use them as gates; a grid generator ignores them, they only name the ends to join
    vertical: accepted.map(i => ({ connectionId: i.connectionId, kind: 'crossCity', parentChunkId: i.chunkId, parentNodeId: i.nodeId, parentEdgeId: i.edgeId, side: i.childSide, position: i.position, roadClass: i.roadClass, elevation: i.elevation })),
  };
}

// After commit: one record per cross-city join, validated by geometry and by a real graph path (core to core).
export function connectionRecords(world, event, encounterOf, pathOf) {
  const out = [];
  for (const c of event.crossCityConnections ?? []) {
    const other = world.chunks.get(c.parent.chunkId); const child = world.chunks.get(c.child.chunkId);
    const side = c.connectionId.split(':')[2];
    const pa = other.outputs.ports[side].find(p => p.nodeId === c.parent.nodeId && p.edgeId === c.parent.edgeId);
    const childSide = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' }[side];
    const pb = child.outputs.ports[childSide].find(p => p.nodeId === c.child.nodeId && p.edgeId === c.child.edgeId);
    const ramp = (event.ramps ?? []).find(r => r.connectionId === c.connectionId);
    const A = portPoint(other, side, pa.position); const B = portPoint(child, childSide, pb.position);
    const [cityA, cityB] = [other.cityId, child.cityId].sort();
    const path = pathOf(cityA, cityB);
    const xy = r2(Math.hypot(A.x - B.x, A.z - B.z)); const dz = r2(Math.abs(pa.elevation - pb.elevation));
    out.push({
      connectionId: `icx:${cityA}|${cityB}:${c.connectionId.slice('xconn:'.length)}`, encounterId: encounterOf(other.chunkId, child.chunkId), worldSeed: world.worldSeed, growthStep: event.step,
      cityA, cityB, sourceRoadA: `${other.chunkId}:e${pa.edgeId}`, sourceRoadB: `${child.chunkId}:e${pb.edgeId}`, sourceChunkA: other.chunkId, sourceChunkB: child.chunkId, builtIn: child.chunkId,
      connectionGeometry: { joinNode: { x: r2(A.x), y: pa.elevation, z: r2(A.z) }, otherCityNode: c.parent, newcomerNode: c.child, rampId: ramp?.rampId ?? null, rampStatus: ramp?.status ?? null, rampLengthM: ramp?.rampLengthM ?? 0 },
      roadClass: { [other.cityId]: pa.roadClass, [child.cityId]: pb.roadClass }, elevationProfile: ramp?.profile ?? [], maximumGrade: ramp?.maxGrade ?? 0,
      decisionParameters: { interCity: INTERCITY_RULES, gradeProfile: event.gradeProfile ?? null, ramp: { maxGroundOffsetM: RAMP_RULES.maxGroundOffsetM, endpointToleranceM: RAMP_RULES.endpointToleranceM } },
      sourceGrowthEvents: [world.growth.history.find(e => e.newChunkId === other.chunkId)?.growthEventId ?? `core:${other.chunkId}`, event.growthEventId],
      validationResults: { xyM: xy, dzM: dz, withinTolerance: xy <= RAMP_RULES.endpointToleranceM && dz <= RAMP_RULES.endpointToleranceM, path: path.reachable ? { lengthM: path.lengthM, crossings: path.crossings, chunks: path.chunks } : null },
      connectionStatus: path.reachable && xy <= RAMP_RULES.endpointToleranceM && dz <= RAMP_RULES.endpointToleranceM ? 'connected' : 'committed (no core-to-core path)',
    });
  }
  return out;
}
export const rampAccepts = status => status === RAMP_STATUS.accepted || status === RAMP_STATUS.flush;
