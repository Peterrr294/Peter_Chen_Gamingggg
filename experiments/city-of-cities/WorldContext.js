// A City of Cities — G01 World Context (pure data, runs in Node).
//
//   World  — world seed, global coordinate system, on-demand terrain sampling, city origin registry, occupancy,
//            growth state (generation 0, empty history) and the versioned World State.
//   City   — City Origin records (cityId, origin chunk, seeds, Morphology DNA, Growth DNA, placement reason, status).
//   Chunk  — independent chunk records (cell, seeds, landform, generation parameters, output signatures). One city
//            has exactly one core chunk in G01; growth chunks are a future extension (parentChunkId, generation).
//
// Terrain is world-owned and city-neutral: a cell's landform, terrain seed and variation depend on worldSeed + cell
// only (G01 prototype field, growing-world/growthConfig.js). Growth is NOT implemented: frontierOf() is a read-only
// query and no method adds a chunk other than a city core.
import { computeMatchMetrics, matchCity } from '../seed-terrain/CityMatcher.js';
import { generateUrbanLayer } from '../world-grid/WorldGrid.js';
import { cellOf, landformAt } from '../growing-world/growthConfig.js';
import { networkOf, terrainOf } from '../growing-world/WorldGrowthController.js';
import { CHUNK_SIZE, CITY_IDS, ORIGIN_PROFILES, SCHEMA_VERSION, STATE_KIND, chunkIdOf, citySeedOf, cityLabel, growthOf, morphologyOf, normaliseParams, urbanSeedOf } from './originConfig.js';
import { placeOriginsSteps } from './OriginPlacement.js';

const now = () => (globalThis.performance ?? Date).now();
const round = (v, d = 3) => +Number(v).toFixed(d);
const cellKey = (gx, gy) => `${gx},${gy}`;
const NEIGHBOURS = [[1, 0, '+x'], [-1, 0, '−x'], [0, 1, '+z'], [0, -1, '−z']];

export class WorldContext {
  constructor(params = {}) {
    this.params = normaliseParams(params);
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
    this.growth = { generation: 0, history: [] }; // schema reserved for G02; nothing is appended in G01
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
    for (const p of report.placed) this.registerOrigin(p);
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
      chunkId, cityId, role: 'core', parentChunkId: null, generation: 0,
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
    };
    this.chunks.set(chunkId, { ...chunk, generationStatus: 'generated', outputs });
    const origin = this.cities.get(chunk.cityId);
    this.cities.set(chunk.cityId, { ...origin, generationStatus: 'core generated' });
    return { chunk: this.chunks.get(chunkId), layers: { terrain, net, city } };
  }

  // ---------- Growth interface (reserved for G02; read-only in G01) ----------
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
      chunks: [...this.chunks.values()].sort((a, b) => a.chunkId.localeCompare(b.chunkId)).map(c => ({
        chunkId: c.chunkId, cityId: c.cityId, role: c.role, parentChunkId: c.parentChunkId, generation: c.generation,
        worldCoordinate: c.worldCoordinate, terrainSeed: c.terrainSeed, terrainType: c.terrainType, generationParameters: c.generationParameters,
        expectedSignatures: c.outputs?.signatures ?? null,
      })),
      placement: this.placement ? { order: this.placement.order, failures: this.placement.failures } : null,
      growth: { generation: this.growth.generation, history: this.growth.history, historySchema: 'G02: { step, chunkId, cityId, parentChunkId, reason }' },
    };
  }

  // Restore from a saved state: seeds, landforms and parameters are re-derived and must match (nothing is guessed).
  static restore(saved) {
    if (saved?.kind !== STATE_KIND || saved.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported world state ${saved?.kind} v${saved?.schemaVersion}`);
    const world = new WorldContext(saved.params);
    for (const c of saved.cities) {
      const chunk = saved.chunks.find(k => k.chunkId === c.originChunkId);
      if (!chunk) throw new Error(`Origin chunk ${c.originChunkId} of ${c.cityId} missing`);
      world.registerOrigin({ cityId: c.cityId, gx: c.worldCoordinate.gx, gy: c.worldCoordinate.gy, reason: c.placementReason });
      const rebuilt = world.chunks.get(c.originChunkId);
      if (world.cities.get(c.cityId).citySeed !== c.citySeed) throw new Error(`citySeed mismatch for ${c.cityId}`);
      if (rebuilt.terrainSeed !== chunk.terrainSeed || rebuilt.terrainType !== chunk.terrainType || JSON.stringify(rebuilt.generationParameters) !== JSON.stringify(chunk.generationParameters)) throw new Error(`Chunk ${chunk.chunkId} does not match the world rules`);
      world.chunks.set(chunk.chunkId, { ...rebuilt, expectedSignatures: chunk.expectedSignatures });
    }
    world.placement = saved.placement ? { ...saved.placement, placed: [], candidates: null } : null;
    world.growth = { generation: saved.growth.generation, history: [...saved.growth.history] };
    return world;
  }
}
