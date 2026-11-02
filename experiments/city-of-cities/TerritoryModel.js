// A City of Cities — G03a Urban Territory & Spatial Relationships (pure data analysis layer, runs in Node).
//
// Reads the World Context and the G02 growth history; it never changes growth, terrain or city generation.
//   Ownership (territories) is updated INCREMENTALLY from growth events (applyEvent); it is never rebuilt by
//   rescanning the world. Everything else is derived deterministically from the registries and the real terrain
//   probes in refresh(): world spatial states, frontiers, boundary segments, inter-city adjacencies, the city
//   relationship graph and the metrics.
//
// World spatial state per cell (priority urban > ecological > frontier > evaluated > unexplored):
//   unexplored            never evaluated by the world algorithms (no terrain probe) — not stored, not a constraint
//   evaluated             terrain probed (origin placement or growth frontier), not occupied, no constraint rule
//   frontier              evaluated and eligible for at least one city in the next growth step
//   ecologicalConstraint  evaluated and meets an explicit, city-neutral terrain / water rule (CONSTRAINT_RULES)
//   urbanTerritory        occupied by a city chunk (with `viable` = the chunk generated buildings)
// A city's own rejection (e.g. Venice: no water) never makes a cell ecological; rejected cells stay evaluated.
import { CHUNK_SIZE, CITY_IDS } from './originConfig.js';
import { DIRECTIONS } from './growthDNA.js';

const KM2 = (CHUNK_SIZE * CHUNK_SIZE) / 1e6; // 1.048576 km² per chunk
const key = (gx, gy) => `${gx},${gy}`;
const r3 = v => +Number(v).toFixed(3);
const pairKey = (a, b) => [a, b].sort().join('|');

// Explicit, city-neutral constraint rules (design assumptions A; thresholds from the measured G03a distribution of
// 243 probed cells: mountains mean land slope 22–36°, all other landforms ≤ 13°; no cell below 5 % buildable;
// coast water ≤ 37 %). There is no protection policy in the project: no cell is marked "protected".
export const CONSTRAINT_RULES = Object.freeze({
  steepTerrain: { metric: 'meanLandSlope', op: '>=', value: 18, unit: '°', meaning: 'mean slope of the land in the cell is too steep for urban fabric' },
  unbuildable: { metric: 'buildableFraction', op: '<', value: 0.05, unit: 'share', meaning: 'less than 5 % buildable land (same threshold as G01 / G02)' },
  waterBody: { metric: 'waterFraction', op: '>=', value: 0.5, unit: 'share', meaning: 'the cell is mostly water' },
});
export function constraintOf(probe) {
  const hits = Object.entries(CONSTRAINT_RULES).filter(([, r]) => (r.op === '>=' ? probe[r.metric] >= r.value : probe[r.metric] < r.value)).map(([id, r]) => ({ rule: id, value: probe[r.metric], threshold: `${r.op} ${r.value}${r.unit === '°' ? '°' : ''}` }));
  return hits.length ? hits : null;
}

// Cells crossed by the straight line between two cells (exclusive), Bresenham on the grid.
function lineCells(a, b) {
  const out = []; let x = a.gx; let y = a.gy; const dx = Math.abs(b.gx - x); const dy = -Math.abs(b.gy - y); const sx = x < b.gx ? 1 : -1; const sy = y < b.gy ? 1 : -1; let err = dx + dy;
  while (!(x === b.gx && y === b.gy)) { const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; } if (!(x === b.gx && y === b.gy)) out.push({ gx: x, gy: y }); }
  return out;
}

export class TerritoryModel {
  constructor(world) {
    this.world = world;
    this.appliedStep = 0;
    this.territories = new Map(); // cityId → territory (ownership part updated by events only)
    for (const o of [...world.cities.values()].sort((a, b) => a.cityId.localeCompare(b.cityId))) {
      const core = world.chunks.get(o.originChunkId);
      this.territories.set(o.cityId, { cityId: o.cityId, originChunkId: o.originChunkId, occupiedChunkIds: [core.chunkId], territoryGrowthHistory: [{ step: 0, chunkId: core.chunkId, parentChunkId: null, generation: 0 }] });
    }
    this.derived = null;
  }

  // Replays the growth history from the cores (deterministic; used after load and as a consistency check).
  static build(world) { const m = new TerritoryModel(world); for (const e of world.growth.history) m.applyEvent(e); return m; }

  // Incremental ownership update from one G02 growth event. Refuses anything that would be an unrecorded overwrite.
  applyEvent(e) {
    if (e.step !== this.appliedStep + 1) throw new Error(`Territory: event step ${e.step} after ${this.appliedStep}`);
    const t = this.territories.get(e.cityId);
    const chunk = this.world.chunks.get(e.newChunkId);
    if (!t || !chunk || chunk.cityId !== e.cityId) throw new Error(`Territory: event ${e.step} does not match the world registry`);
    for (const other of this.territories.values()) if (other.occupiedChunkIds.includes(e.newChunkId)) throw new Error(`Territory: ${e.newChunkId} already owned by ${other.cityId}`);
    if (!t.occupiedChunkIds.includes(e.parentChunkId)) throw new Error(`Territory: parent ${e.parentChunkId} is not in ${e.cityId}`);
    t.occupiedChunkIds.push(e.newChunkId);
    t.territoryGrowthHistory.push({ step: e.step, chunkId: e.newChunkId, parentChunkId: e.parentChunkId, generation: e.generation });
    this.appliedStep = e.step;
    this.derived = null;
  }

  // Derived analysis. `controller` (WorldGrowthController) supplies the real frontier evaluation of the next step.
  refresh(controller) {
    const w = this.world;
    const frontier = controller.evaluate(w.growth.step + 1); // same evaluation the next growth step will use (cached probes)
    // --- World spatial state of every evaluated or occupied cell ---
    const cells = new Map();
    for (const [k, probe] of w.probes) {
      const chunk = w.chunkAt(probe.gx, probe.gy);
      const constraint = constraintOf(probe);
      cells.set(k, { gx: probe.gx, gy: probe.gy, landform: probe.landform, constraint, state: chunk ? 'urbanTerritory' : constraint ? 'ecologicalConstraint' : 'evaluated', cityId: chunk?.cityId ?? null, chunkId: chunk?.chunkId ?? null, eligibleFor: [], blockedFor: [] });
    }
    for (const c of w.chunks.values()) {
      const k = key(c.worldCoordinate.gx, c.worldCoordinate.gy);
      if (!cells.has(k)) cells.set(k, { gx: c.worldCoordinate.gx, gy: c.worldCoordinate.gy, landform: c.terrainType, constraint: null, state: 'urbanTerritory', cityId: c.cityId, chunkId: c.chunkId, eligibleFor: [], blockedFor: [] });
      const cell = cells.get(k);
      cell.viable = (c.outputs?.counts.buildings ?? 0) > 0;
    }
    for (const [cityId, list] of Object.entries(frontier)) for (const cand of list) {
      const cell = cells.get(key(cand.gx, cand.gy));
      if (!cell || cell.state === 'urbanTerritory') continue;
      if (cand.status === 'eligible') cell.eligibleFor.push({ cityId, score: cand.score });
      else cell.blockedFor.push({ cityId, reason: cand.rejectionReason });
    }
    for (const cell of cells.values()) if (cell.state === 'evaluated' && cell.eligibleFor.length) cell.state = 'frontier';
    const stateAt = (gx, gy) => cells.get(key(gx, gy))?.state ?? 'unexplored';

    // --- Territories: areas, frontiers, boundaries ---
    const territories = [];
    const adjacencies = new Map();
    for (const t of this.territories.values()) {
      const chunks = t.occupiedChunkIds.map(id => w.chunks.get(id));
      let built = 0; let parcels = 0; let roadKm = 0; let waterKm2 = 0; let unbuildableKm2 = 0; let viable = 0;
      for (const c of chunks) {
        built += c.outputs.areas?.builtFootprintM2 ?? 0; parcels += c.outputs.areas?.parcelM2 ?? 0; roadKm += c.outputs.counts.roadKm;
        if (c.outputs.counts.buildings > 0) viable += 1;
        const p = w.probes.get(key(c.worldCoordinate.gx, c.worldCoordinate.gy));
        if (p) { waterKm2 += p.waterFraction * KM2; unbuildableKm2 += Math.max(0, 1 - p.buildableFraction - p.waterFraction) * KM2; }
      }
      const segments = [];
      for (const c of chunks) for (const [dir, [dx, dy, side]] of Object.entries(DIRECTIONS)) {
        const nx = c.worldCoordinate.gx + dx; const ny = c.worldCoordinate.gy + dy;
        const other = w.chunkAt(nx, ny);
        const type = other ? (other.cityId === t.cityId ? 'urbanSameCity' : 'urbanOtherCity') : { unexplored: 'urbanUnexplored', evaluated: 'urbanEvaluated', frontier: 'urbanEvaluated', ecologicalConstraint: 'urbanEcological' }[stateAt(nx, ny)];
        const { x, z } = c.worldOrigin; const h = CHUNK_SIZE / 2;
        const ends = dx ? [{ x: x + dx * h, z: z - h }, { x: x + dx * h, z: z + h }] : [{ x: x - h, z: z + dy * h }, { x: x + h, z: z + dy * h }];
        segments.push({ chunkId: c.chunkId, direction: dir, side, neighbour: { gx: nx, gy: ny }, type, frontier: stateAt(nx, ny) === 'frontier', otherCityId: other && other.cityId !== t.cityId ? other.cityId : null, otherChunkId: other?.chunkId ?? null, from: ends[0], to: ends[1], lengthM: CHUNK_SIZE });
        if (type === 'urbanOtherCity') {
          const k = pairKey(c.chunkId, other.chunkId);
          if (!adjacencies.has(k)) adjacencies.set(k, this.adjacencyRecord(c, other, side, ends));
        }
      }
      const list = frontier[t.cityId] ?? [];
      const active = list.filter(c => c.status === 'eligible').map(c => ({ cell: key(c.gx, c.gy), score: c.score, landform: c.terms?.landform }));
      const blocked = list.filter(c => c.status !== 'eligible').map(c => ({ cell: key(c.gx, c.gy), reason: c.rejectionReason }));
      const byType = segments.reduce((acc, s) => { acc[s.type] = (acc[s.type] ?? 0) + s.lengthM; return acc; }, {});
      const reasons = blocked.reduce((acc, b) => { const k2 = b.reason.startsWith('occupied by') ? 'occupied by another city' : b.reason.replace(/-?\d+(\.\d+)?/g, '#'); acc[k2] = (acc[k2] ?? 0) + 1; return acc; }, {});
      territories.push({
        cityId: t.cityId, originChunkId: t.originChunkId, occupiedChunkIds: [...t.occupiedChunkIds], territoryGrowthHistory: t.territoryGrowthHistory.map(x => ({ ...x })),
        chunkCount: chunks.length, viableChunks: viable, maxGeneration: Math.max(...chunks.map(c => c.generation)),
        territoryArea: { chunkCoverageKm2: r3(chunks.length * KM2), builtFootprintKm2: r3(built / 1e6), parcelKm2: r3(parcels / 1e6), roadKm: r3(roadKm), waterInsideKm2: r3(waterKm2), otherNonBuildableInsideKm2: r3(unbuildableKm2) },
        activeFrontiers: active, blockedFrontiers: blocked, blockedReasons: reasons,
        status: active.length ? 'growing' : 'stopped', stopReason: active.length ? null : `no eligible frontier cell (${Object.entries(reasons).map(([k2, v]) => `${k2} ×${v}`).join('; ') || 'no frontier'})`,
        neighboringCities: [...new Set(segments.filter(s => s.otherCityId).map(s => s.otherCityId))].sort(),
        boundarySegments: segments, boundaryLengthM: { external: segments.filter(s => s.type !== 'urbanSameCity').reduce((n, s) => n + s.lengthM, 0), byType },
      });
    }

    // --- City relationship graph (15 pairs) ---
    const relationships = [];
    for (let i = 0; i < CITY_IDS.length; i += 1) for (let j = i + 1; j < CITY_IDS.length; j += 1) {
      const A = CITY_IDS[i]; const B = CITY_IDS[j];
      const ca = this.territories.get(A).occupiedChunkIds.map(id => w.chunks.get(id)); const cb = this.territories.get(B).occupiedChunkIds.map(id => w.chunks.get(id));
      const shared = [...adjacencies.values()].filter(r => (r.cityA === A && r.cityB === B) || (r.cityA === B && r.cityB === A));
      let best = null;
      for (const a of ca) for (const b of cb) {
        const d = Math.hypot(a.worldOrigin.x - b.worldOrigin.x, a.worldOrigin.z - b.worldOrigin.z);
        if (!best || d < best.d || (d === best.d && (a.chunkId + b.chunkId) < (best.a.chunkId + best.b.chunkId))) best = { d, a, b };
      }
      const steps = Math.abs(best.a.worldCoordinate.gx - best.b.worldCoordinate.gx) + Math.abs(best.a.worldCoordinate.gy - best.b.worldCoordinate.gy);
      const between = shared.length ? [] : lineCells(best.a.worldCoordinate, best.b.worldCoordinate).map(c => ({ ...c, state: stateAt(c.gx, c.gy), rule: cells.get(key(c.gx, c.gy))?.constraint?.map(x => x.rule).join('+') ?? null }));
      const eco = between.filter(c => c.state === 'ecologicalConstraint'); const unknown = between.filter(c => c.state === 'unexplored');
      const corner = !shared.length && Math.max(Math.abs(best.a.worldCoordinate.gx - best.b.worldCoordinate.gx), Math.abs(best.a.worldCoordinate.gy - best.b.worldCoordinate.gy)) === 1;
      const barrier = shared.length ? 'n/a (adjacent)' : corner ? 'n/a (corner contact: the territories touch at one chunk corner, no cell between)' : eco.length ? `present on the direct line: ${eco.length} of ${between.length} cells (${[...new Set(eco.map(c => c.rule))].join(', ')})` : unknown.length ? `unknown: ${unknown.length} of ${between.length} cells on the direct line unexplored` : `none on the direct line (${between.length} evaluated cells)`;
      const aligned = shared.reduce((n, r) => n + r.roadInterface.alignedPorts, 0);
      relationships.push({
        cities: [A, B], relation: shared.length ? 'directAdjacency' : 'spatialSeparation', cornerContact: corner,
        sharedEdges: shared.length, sharedBoundaryM: shared.length * CHUNK_SIZE,
        nearest: { chunks: [best.a.chunkId, best.b.chunkId], centreDistanceM: Math.round(best.d), gapCells: Math.max(0, steps - 1) },
        environmentalBarrier: barrier, barrierStatus: shared.length || corner ? 'n/a' : eco.length ? 'present' : unknown.length ? 'unknown' : 'none',
        verifiedConnection: shared.length ? (aligned ? 'unknown: road ports aligned across the shared edge, roads not joined (G02 joins nothing)' : 'none: no aligned ports') : 'none: no infrastructure outside generated chunks',
        directLine: between.map(c => `${c.gx},${c.gy}:${c.state}`),
      });
    }

    // --- Metrics ---
    const count = s => [...cells.values()].filter(c => c.state === s).length;
    const evaluatedNonUrban = count('evaluated') + count('frontier');
    const metrics = {
      step: w.growth.step, totalChunks: w.chunks.size,
      urbanized: { chunkCoverageKm2: r3(w.chunks.size * KM2), builtFootprintKm2: r3(territories.reduce((n, t) => n + t.territoryArea.builtFootprintKm2, 0)), parcelKm2: r3(territories.reduce((n, t) => n + t.territoryArea.parcelKm2, 0)), viableChunks: territories.reduce((n, t) => n + t.viableChunks, 0) },
      cells: { urbanTerritory: count('urbanTerritory'), frontier: count('frontier'), evaluated: count('evaluated'), ecologicalConstraint: count('ecologicalConstraint'), urbanOnConstrainedTerrain: [...cells.values()].filter(c => c.state === 'urbanTerritory' && c.constraint).length, protected: 0 },
      evaluatedNonUrbanKm2: r3(evaluatedNonUrban * KM2), ecologicalConstraintKm2: r3(count('ecologicalConstraint') * KM2),
      interCityAdjacencies: { sharedEdges: adjacencies.size, cityPairs: relationships.filter(r => r.relation === 'directAdjacency').length, cornerContactPairs: relationships.filter(r => r.cornerContact).length },
      distribution: Object.fromEntries(territories.map(t => [t.cityId, { chunks: t.chunkCount, share: r3(t.chunkCount / w.chunks.size) }])),
      stoppedCities: territories.filter(t => t.status === 'stopped').map(t => t.cityId),
    };
    this.derived = { step: w.growth.step, cells, territories, adjacencies: [...adjacencies.values()], relationships, metrics, frontier };
    return this.derived;
  }

  // Inter-city shared edge: location, length, terrain conditions (G02 conflict record), road / water interfaces.
  adjacencyRecord(a, b, sideA, ends) {
    const sideB = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' }[sideA];
    const later = a.growthStep > b.growthStep ? a : b; const earlier = later === a ? b : a;
    const event = this.world.growth.history.find(e => e.newChunkId === later.chunkId);
    const conflict = event?.conflicts.find(c => c.with === earlier.chunkId) ?? null;
    const wa = a.outputs.profiles[sideA].w; const wb = b.outputs.profiles[sideB].w;
    let bothWet = 0; for (let i = 0; i < wa.length; i += 1) if (wa[i] === '1' && wb[i] === '1') bothWet += 1;
    const pa = a.outputs.ports[sideA]; const pb = b.outputs.ports[sideB];
    const aligned = pa.filter(p => pb.some(q => Math.abs(q.position - p.position) <= 48 && q.type === p.type)).length;
    const [cityA, cityB] = [a.cityId, b.cityId];
    return {
      cityA, cityB, chunkA: a.chunkId, chunkB: b.chunkId, location: { from: ends[0], to: ends[1], mid: { x: (ends[0].x + ends[1].x) / 2, z: (ends[0].z + ends[1].z) / 2 } }, lengthM: CHUNK_SIZE,
      terrain: conflict ? { geometry: conflict.geometry, maxDh: conflict.maxDh, hydrology: conflict.hydrology, wetMismatch: conflict.wetMismatch, landforms: [a.terrainType, b.terrainType] } : { geometry: 'unknown', landforms: [a.terrainType, b.terrainType] },
      roadInterface: { portsA: pa.length, portsB: pb.length, alignedPorts: aligned, status: aligned ? 'ports aligned (not joined)' : pa.length + pb.length ? 'ports not aligned' : 'no road ports on this edge' },
      waterInterface: { sharedWetSamples: bothWet, status: bothWet ? `water continues across ${bothWet * 8} m of the edge` : 'no shared water on the edge' },
      connection: 'not verified (G02 does not join cross-chunk roads)',
    };
  }

  // Compact, comparable snapshot (persisted with the World State; also the regression signature of G03a).
  snapshot() {
    const d = this.derived;
    if (!d) throw new Error('refresh() first');
    return {
      version: 1, step: d.step, constraintRules: CONSTRAINT_RULES,
      evaluatedCells: [...this.world.probes.keys()].sort(),
      cellStates: [...d.cells.values()].sort((a, b) => a.gy - b.gy || a.gx - b.gx).map(c => `${c.gx},${c.gy}:${c.state}${c.cityId ? `:${c.cityId}` : ''}${c.constraint ? `:${c.constraint.map(x => x.rule).join('+')}` : ''}`),
      territories: d.territories.map(t => ({ cityId: t.cityId, originChunkId: t.originChunkId, occupiedChunkIds: t.occupiedChunkIds, chunkCount: t.chunkCount, territoryArea: t.territoryArea, maxGeneration: t.maxGeneration, active: t.activeFrontiers.length, blocked: t.blockedFrontiers.length, status: t.status, stopReason: t.stopReason, neighboringCities: t.neighboringCities, boundaryLengthM: t.boundaryLengthM })),
      adjacencies: d.adjacencies.map(a => ({ cities: [a.cityA, a.cityB], chunks: [a.chunkA, a.chunkB], terrain: a.terrain, roadInterface: a.roadInterface, waterInterface: a.waterInterface })),
      relationships: d.relationships.map(r => ({ cities: r.cities, relation: r.relation, cornerContact: r.cornerContact, sharedEdges: r.sharedEdges, nearest: r.nearest, barrierStatus: r.barrierStatus, verifiedConnection: r.verifiedConnection })),
      metrics: d.metrics,
    };
  }

  // After WorldContext.restore + chunk regeneration: re-probe the saved evaluated cells (deterministic), replay the
  // growth history, refresh, and require the saved snapshot to be reproduced exactly.
  static restore(world, controller, saved) {
    for (const k of saved.evaluatedCells) { const [gx, gy] = k.split(',').map(Number); world.probe(gx, gy); }
    const m = TerritoryModel.build(world);
    m.refresh(controller);
    const now = m.snapshot();
    if (JSON.stringify(now) !== JSON.stringify(saved)) throw new Error('Territory snapshot after load differs from the saved one');
    return m;
  }
}
