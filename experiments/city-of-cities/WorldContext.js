// A City of Cities — G01 World Context (pure data, runs in Node).
//
//   World  — world seed, global coordinate system, on-demand terrain sampling, city origin registry, occupancy,
//            growth state (generation 0, empty history) and the versioned World State.
//   City   — City Origin records (cityId, origin chunk, seeds, Morphology DNA, Growth DNA, placement reason, status).
//   Chunk  — independent chunk records (cell, seeds, landform, generation parameters, output signatures). One city
//            has exactly one core chunk in G01; growth chunks are a future extension (parentChunkId, generation).
//
// Terrain is world-owned and city-neutral: a cell's landform, terrain seed and variation depend on worldSeed + cell
// only (G01 prototype field, growing-world/growthConfig.js). G01 adds only city cores; G02 adds growth chunks through
// addGrowthChunk(), called by WorldGrowthController (one per growth step). Records are never edited after creation
// except for their generation status and outputs (filled once by generateChunk).
import { computeMatchMetrics, matchCity } from '../seed-terrain/CityMatcher.js';
import { generateUrbanLayer } from '../world-grid/WorldGrid.js';
import { cellOf, landformAt } from '../growing-world/growthConfig.js';
import { networkOf, terrainOf } from '../growing-world/WorldGrowthController.js';
import { CHUNK_SIZE, CITY_IDS, ORIGIN_PROFILES, SCHEMA_VERSION, STATE_KIND, chunkIdOf, citySeedOf, cityLabel, growthOf, morphologyOf, normaliseParams, urbanSeedOf } from './originConfig.js';
import { placeOriginsSteps } from './OriginPlacement.js';
import { normaliseGrowthParams } from './growthDNA.js';

const now = () => (globalThis.performance ?? Date).now();
const round = (v, d = 3) => +Number(v).toFixed(d);
const cellKey = (gx, gy) => `${gx},${gy}`;
const NEIGHBOURS = [[1, 0, '+x'], [-1, 0, '−x'], [0, 1, '+z'], [0, -1, '−z']];

export class WorldContext {
  constructor(params = {}) {
    this.params = normaliseParams(params);
    this.growthParams = normaliseGrowthParams(params); // G02 (wTerrain, wWater, wInfra, wUrban, jitter)
    this.chunkSize = CHUNK_SIZE;
    this.probes = new Map(); // cellKey → compact terrain probe (cache, derivable)
    this.stats = { probes: 0, probeMs: 0 };
    this.clear();
  }

  get worldSeed() { return this.params.worldSeed; }

  // Registries are emptied; the probe cache is kept (it depends on worldSeed + cell only).
  clear() {
    this.cities = new Map(); // cityId → City Origin
    this.chunks = new Map(); // chunkId → chunk record
    this.occupancy = new Map(); // cellKey → chunkId
    this.placement = null; // last placement report (candidates, rejections, failures)
    this.growth = { generation: 0, step: 0, history: [], stalled: null }; // G02: one event per successful growth step
  }

  // ---------- Global coordinates ----------
  cellToWorld(gx, gy) { return { x: gx * this.chunkSize, z: gy * this.chunkSize }; }
  worldToCell(x, z) { return { gx: Math.round(x / this.chunkSize), gy: Math.round(z / this.chunkSize) }; }
  cell(gx, gy) { return cellOf(this.worldSeed, gx, gy); } // { landform, terrainSeed, variation, worldOrigin, … }
  landformAt(gx, gy) { return landformAt(this.worldSeed, gx, gy); } // cheap: landform field only

  // ---------- On-demand terrain sampling (terrain + analysis + 02.6 metrics; no roads, parcels, buildings) ----------
  probe(gx, gy) {
    const key = cellKey(gx, gy);
    if (this.probes.has(key)) return this.probes.get(key);
    const started = now();
    const cell = this.cell(gx, gy);
    const terrain = terrainOf(cell);
    const m = computeMatchMetrics(terrain.analysis);
    const match = matchCity(terrain.analysis);
    const probe = {
      gx, gy, landform: cell.landform, terrainSeed: cell.terrainSeed,
      waterFraction: round(m.waterFraction ?? 0), buildableFraction: round(m.buildableFraction ?? 0), largestBuildable: round(m.largestBuildableShare ?? 0),
      lowSlope: round(m.highSuitabilityShareOfLand ?? 0), mixedSlope: round(m.mixedSlopeShareOfLand ?? 0),
      fit: Object.fromEntries(match.rankedCandidates.map(c => [c.id, { fitScore: c.fitScore, conflicts: c.conflicts.filter(x => x.triggered).map(x => x.id) }])),
      heightSignature: terrain.fields.stats.heightSignature,
      // G02 terrain / water inputs (all computed from the real fields; nothing estimated).
      meanLandSlope: round(terrain.fields.stats.meanLandSlope, 2), slopeP95: round(terrain.fields.stats.slopeP95, 2), maxLandSlope: round(maxLandSlope(terrain.fields), 2),
      distanceToWater: distanceToWater(terrain.fields), // m from the cell centre to the nearest wet sample in the cell; null = no water in the cell
      waterfrontBuildable: round(waterfrontBuildable(terrain.fields), 4), // G01 placement v2: share of the cell that is buildable land within 32 m of water
      edges: Object.fromEntries(Object.entries(terrain.analysis.boundaryConnections.edges).map(([side, e]) => [side, { buildableShare: round(e.buildableLength / terrain.analysis.boundaryConnections.edgeLength), waterShare: round(e.waterLength / terrain.analysis.boundaryConnections.edgeLength) }])),
    };
    this.probes.set(key, probe);
    this.stats.probes += 1;
    this.stats.probeMs += now() - started;
    return probe;
  }

  // ---------- City origins ----------
  // Generator: yields progress after each probe so a page can keep its UI responsive; the result does not depend
  // on how it is consumed. `cityIds` order is irrelevant (placement order is derived from the data).
  *initialiseSteps(cityIds = CITY_IDS) {
    this.clear();
    const report = yield* placeOriginsSteps(this, cityIds);
    this.placement = report;
    // Placement v2: atomic. A failure registers no city, so no partially initialised world remains.
    if (!report.failures.length) for (const p of report.placed) this.registerOrigin(p);
    return report;
  }

  initialise(cityIds = CITY_IDS) { const it = this.initialiseSteps(cityIds); let r = it.next(); while (!r.done) r = it.next(); return r.value; }

  registerOrigin(p) {
    const { cityId, gx, gy } = p;
    const cell = this.cell(gx, gy);
    const chunkId = chunkIdOf(gx, gy);
    if (this.occupancy.has(cellKey(gx, gy))) throw new Error(`Cell ${gx},${gy} already occupied by ${this.occupancy.get(cellKey(gx, gy))}`);
    const citySeed = citySeedOf(this.worldSeed, cityId);
    const origin = {
      cityId, label: cityLabel(cityId), originChunkId: chunkId,
      worldCoordinate: { gx, gy }, worldPosition: cell.worldOrigin, citySeed,
      morphologyDNA: morphologyOf(cityId), growthDNA: growthOf(cityId), originProfile: ORIGIN_PROFILES[cityId],
      placementReason: p.reason, generationStatus: 'placed', growthGeneration: 0,
    };
    const chunk = {
      chunkId, cityId, role: 'core', parentChunkId: null, coreChunkId: chunkId, generation: 0, growthStep: 0,
      worldCoordinate: { gx, gy }, worldOrigin: cell.worldOrigin,
      terrainSeed: cell.terrainSeed, terrainType: cell.landform,
      generationParameters: { variation: cell.variation, transitionWidth: 128, chunkSize: this.chunkSize, urbanSeed: urbanSeedOf(citySeed, chunkId), idMode: 'spatial (07.1a)', terrainMode: 'raw (no seam correction)' },
      generationStatus: 'planned', outputs: null,
    };
    this.cities.set(cityId, origin);
    this.chunks.set(chunkId, chunk);
    this.occupancy.set(cellKey(gx, gy), chunkId);
  }

  // ---------- Independent chunk generation (existing chain, unchanged) ----------
  // Terrain → analysis → City Match (City ID forced) → network → blocks → parcels → buildings. Every call builds
  // from the chunk's own seeds; no state is shared between chunks, so the call order cannot change a result.
  generateChunk(chunkId) {
    const chunk = this.chunks.get(chunkId);
    const t0 = now();
    const cell = this.cell(chunk.worldCoordinate.gx, chunk.worldCoordinate.gy);
    const terrain = terrainOf(cell);
    const t1 = now();
    const net = networkOf(cell, chunk.cityId, terrain);
    const t2 = now();
    const city = generateUrbanLayer(terrain, net, net.network, null, { worldSeed: chunk.generationParameters.urbanSeed });
    const t3 = now();
    const outputs = {
      resolvedDNA: city.cityMatch.selectedDNA.id, fitScore: city.cityMatch.selectedDNA.fitScore,
      signatures: { height: terrain.fields.stats.heightSignature, water: terrain.fields.stats.waterSignature, network: city.network.signature, blocks: city.blocks.signature, parcels: city.parcels.signature, buildings: city.buildings.signature },
      counts: { roadKm: round(city.network.stats.roadLength / 1000, 2), networkEdges: city.network.edges.length, blocks: city.blocks.stats.blocks, parcels: city.parcels.stats.parcels, buildings: city.buildings.stats.buildings },
      ms: { terrain: Math.round(t1 - t0), network: Math.round(t2 - t1), urban: Math.round(t3 - t2), total: Math.round(t3 - t0) },
      // G02: road / canal ports per side (growth infrastructure term) and 8 m edge profiles (conflict records).
      ports: portsBySide(city.network), profiles: edgeProfiles(terrain.fields),
    };
    this.chunks.set(chunkId, { ...chunk, generationStatus: 'generated', outputs });
    const origin = this.cities.get(chunk.cityId);
    if (chunk.role === 'core') this.cities.set(chunk.cityId, { ...origin, generationStatus: 'core generated' });
    return { chunk: this.chunks.get(chunkId), layers: { terrain, net, city } };
  }

  // ---------- G02: growth chunks ----------
  // Registers one growth chunk (planned; generateChunk fills its outputs). Checks: free cell, parent of the same city,
  // parent edge-adjacent. Terrain seed and variation come from the cell (world-owned); urbanSeed from the citySeed.
  addGrowthChunk({ cityId, gx, gy, parentChunkId, step, reason }) {
    const parent = this.chunks.get(parentChunkId);
    if (!parent || parent.cityId !== cityId) throw new Error(`Parent ${parentChunkId} is not a chunk of ${cityId}`);
    if (Math.abs(parent.worldCoordinate.gx - gx) + Math.abs(parent.worldCoordinate.gy - gy) !== 1) throw new Error(`Parent ${parentChunkId} is not edge-adjacent to ${gx},${gy}`);
    if (this.occupancy.has(cellKey(gx, gy))) throw new Error(`Cell ${gx},${gy} already occupied by ${this.occupancy.get(cellKey(gx, gy))}`);
    const cell = this.cell(gx, gy);
    const chunkId = chunkIdOf(gx, gy);
    const citySeed = this.cities.get(cityId).citySeed;
    const chunk = {
      chunkId, cityId, role: 'growth', parentChunkId, coreChunkId: parent.coreChunkId, generation: parent.generation + 1, growthStep: step,
      worldCoordinate: { gx, gy }, worldOrigin: cell.worldOrigin, terrainSeed: cell.terrainSeed, terrainType: cell.landform,
      generationParameters: { variation: cell.variation, transitionWidth: 128, chunkSize: this.chunkSize, urbanSeed: urbanSeedOf(citySeed, chunkId), idMode: 'spatial (07.1a)', terrainMode: 'raw (no seam correction)' },
      growthReason: reason ?? null, generationStatus: 'planned', outputs: null,
    };
    this.chunks.set(chunkId, chunk);
    this.occupancy.set(cellKey(gx, gy), chunkId);
    return chunk;
  }

  chunkAt(gx, gy) { const id = this.occupancy.get(cellKey(gx, gy)); return id ? this.chunks.get(id) : null; }

  // ---------- Growth interface (G01 read-only query; the G02 frontier lives in WorldGrowthController) ----------
  // Potential growth directions of a city: the 4 edge neighbours of its chunks that are free, with the landform
  // (cheap field lookup) and the city's landform compatibility. Creates nothing.
  frontierOf(cityId) {
    const out = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.cityId !== cityId) continue;
      const { gx, gy } = chunk.worldCoordinate;
      for (const [dx, dy, dir] of NEIGHBOURS) {
        const nx = gx + dx; const ny = gy + dy;
        if (this.occupancy.has(cellKey(nx, ny))) continue;
        const landform = this.landformAt(nx, ny);
        out.push({ gx: nx, gy: ny, direction: dir, from: chunk.chunkId, landform, compatibility: this.cities.get(cityId).growthDNA.terrainSuitability[landform] });
      }
    }
    return out;
  }

  // What must be regenerated if one city's origin changed (placement is coupled only through the distance rule).
  dependenciesOf(cityId) {
    const origin = this.cities.get(cityId);
    const later = [...this.cities.values()].filter(o => o.placementReason.order > origin.placementReason.order).map(o => o.cityId);
    return { chunk: origin.originChunkId, ownChunkOnly: 'content of a core depends on its cell + City ID + urbanSeed only', placementMayAffect: later, constrainedBy: origin.placementReason.constrainedBy };
  }

  // ---------- World State ----------
  serialise() {
    return {
      kind: STATE_KIND, schemaVersion: SCHEMA_VERSION, worldSeed: this.worldSeed, params: { ...this.params },
      coordinateSystem: { chunkSize: this.chunkSize, cell: 'integer (gx, gy); world x = gx · chunkSize, world z = gy · chunkSize; unbounded' },
      cities: [...this.cities.values()].sort((a, b) => a.cityId.localeCompare(b.cityId)).map(o => ({
        cityId: o.cityId, originChunkId: o.originChunkId, worldCoordinate: o.worldCoordinate, worldPosition: o.worldPosition, citySeed: o.citySeed,
        growthGeneration: o.growthGeneration, placementReason: o.placementReason,
      })),
      growthParams: { ...this.growthParams },
      chunks: [...this.chunks.values()].sort((a, b) => a.growthStep - b.growthStep || a.chunkId.localeCompare(b.chunkId)).map(c => ({
        chunkId: c.chunkId, cityId: c.cityId, role: c.role, parentChunkId: c.parentChunkId, coreChunkId: c.coreChunkId, generation: c.generation, growthStep: c.growthStep,
        worldCoordinate: c.worldCoordinate, terrainSeed: c.terrainSeed, terrainType: c.terrainType, generationParameters: c.generationParameters,
        expectedSignatures: c.outputs?.signatures ?? c.expectedSignatures ?? null,
      })),
      placement: this.placement ? { placementVersion: this.placement.placementVersion ?? 1, order: this.placement.order, failures: this.placement.failures } : null,
      growth: { generation: this.growth.generation, step: this.growth.step, stalled: this.growth.stalled, history: this.growth.history, historySchema: '{ step, cityId, parentChunkId, newChunkId, targetCoordinate, selectionScore, selectionWeight, growthReason, worldSeed, generationParameters, conflicts }' },
    };
  }

  // Restore from a saved state: seeds, landforms and parameters are re-derived and must match (nothing is guessed).
  static restore(saved) {
    if (saved?.kind !== STATE_KIND || ![1, SCHEMA_VERSION].includes(saved.schemaVersion)) throw new Error(`Unsupported world state ${saved?.kind} v${saved?.schemaVersion}`);
    const world = new WorldContext({ ...saved.params, ...(saved.growthParams ?? {}) });
    for (const c of saved.cities) {
      const chunk = saved.chunks.find(k => k.chunkId === c.originChunkId);
      if (!chunk) throw new Error(`Origin chunk ${c.originChunkId} of ${c.cityId} missing`);
      world.registerOrigin({ cityId: c.cityId, gx: c.worldCoordinate.gx, gy: c.worldCoordinate.gy, reason: c.placementReason });
      const rebuilt = world.chunks.get(c.originChunkId);
      if (world.cities.get(c.cityId).citySeed !== c.citySeed) throw new Error(`citySeed mismatch for ${c.cityId}`);
      if (rebuilt.terrainSeed !== chunk.terrainSeed || rebuilt.terrainType !== chunk.terrainType || JSON.stringify(rebuilt.generationParameters) !== JSON.stringify(chunk.generationParameters)) throw new Error(`Chunk ${chunk.chunkId} does not match the world rules`);
      world.chunks.set(chunk.chunkId, { ...rebuilt, expectedSignatures: chunk.expectedSignatures });
    }
    // G02 growth chunks, in growth order; every rule of addGrowthChunk is re-checked and the history must agree.
    for (const chunk of saved.chunks.filter(c => c.role === 'growth').sort((a, b) => a.growthStep - b.growthStep)) {
      const event = saved.growth.history.find(e => e.newChunkId === chunk.chunkId);
      if (!event || event.step !== chunk.growthStep || event.parentChunkId !== chunk.parentChunkId) throw new Error(`Growth chunk ${chunk.chunkId} has no matching history event`);
      const rebuilt = world.addGrowthChunk({ cityId: chunk.cityId, gx: chunk.worldCoordinate.gx, gy: chunk.worldCoordinate.gy, parentChunkId: chunk.parentChunkId, step: chunk.growthStep, reason: event.growthReason });
      if (rebuilt.terrainSeed !== chunk.terrainSeed || rebuilt.generation !== chunk.generation || JSON.stringify(rebuilt.generationParameters) !== JSON.stringify(chunk.generationParameters)) throw new Error(`Growth chunk ${chunk.chunkId} does not match the world rules`);
      world.chunks.set(chunk.chunkId, { ...rebuilt, expectedSignatures: chunk.expectedSignatures });
    }
    // States saved before placement v2 keep their stored origins (cells are restored, never re-placed).
    world.placement = saved.placement ? { placementVersion: 1, ...saved.placement, placed: [], candidates: null } : null;
    world.growth = { generation: saved.growth.generation, step: saved.growth.step ?? 0, stalled: saved.growth.stalled ?? null, history: [...saved.growth.history] };
    return world;
  }
}

// ---------- G02 helpers (read fields / networks only) ----------
function maxLandSlope(fields) {
  let max = 0;
  for (let i = 0; i < fields.slope.length; i += 1) if (!fields.waterMask[i] && fields.slope[i] > max) max = fields.slope[i];
  return max;
}

function distanceToWater(fields) {
  const { columns, spacing, segments } = fields.grid;
  const c = segments / 2;
  let best = Infinity;
  for (let i = 0; i < fields.waterMask.length; i += 1) {
    if (!fields.waterMask[i]) continue;
    const d = Math.hypot(Math.floor(i / columns) - c, (i % columns) - c);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? Math.round(best * spacing) : null;
}

function portsBySide(network) {
  const out = { minX: [], maxX: [], minZ: [], maxZ: [] };
  for (const p of network.edgePorts) out[p.side].push({ position: Math.round(p.position * 10) / 10, type: p.type, roadClass: p.roadClass });
  return out;
}

function edgeProfiles(fields) {
  const { segments, columns } = fields.grid;
  const sides = { minX: [], maxX: [], minZ: [], maxZ: [] };
  const pick = i => [Math.round(fields.height[i] * 100) / 100, fields.waterMask[i] ? 1 : 0];
  for (let i = 0; i <= segments; i += 2) {
    sides.minX.push(pick(i * columns)); sides.maxX.push(pick(i * columns + segments));
    sides.minZ.push(pick(i)); sides.maxZ.push(pick(segments * columns + i));
  }
  return Object.fromEntries(Object.entries(sides).map(([k, v]) => [k, { h: v.map(x => x[0]), w: v.map(x => x[1]).join('') }]));
}

// Placement v2: buildable land samples within 8 samples (32 m) of a water sample, as a share of all samples. (A 12 m band
// was tried first and measured ≈ 0: the non-buildable shore belt — below the 1 m freeboard or steeper than 10° — is wider.)
function waterfrontBuildable(fields) {
  const { columns, segments } = fields.grid;
  const { waterMask, buildableMask } = fields;
  let n = 0;
  for (let row = 0; row <= segments; row += 1) {
    for (let col = 0; col <= segments; col += 1) {
      const i = row * columns + col;
      if (!buildableMask[i]) continue;
      let near = false;
      for (let d = 1; d <= 8 && !near; d += 1) {
        for (const [dr, dc] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
          const r = row + dr; const c = col + dc;
          if (r >= 0 && c >= 0 && r <= segments && c <= segments && waterMask[r * columns + c]) { near = true; break; }
        }
      }
      if (near) n += 1;
    }
  }
  return n / waterMask.length;
}
