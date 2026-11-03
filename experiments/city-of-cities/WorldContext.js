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
import { generateNetwork } from '../seed-terrain/NetworkGenerator.js';
import { generateBlocks } from '../seed-terrain/BlockGenerator.js';
import { generateParcels } from '../seed-terrain/ParcelGenerator.js';
import { generateBuildings } from '../seed-terrain/BuildingGenerator.js';
import { cellOf, landformAt } from '../growing-world/growthConfig.js';
import { networkOf, terrainOf } from '../growing-world/WorldGrowthController.js';
import { CHUNK_SIZE, CITY_IDS, ORIGIN_PROFILES, SCHEMA_VERSION, STATE_KIND, chunkIdOf, citySeedOf, cityLabel, growthOf, morphologyOf, normaliseParams, urbanSeedOf } from './originConfig.js';
import { placeOriginsSteps } from './OriginPlacement.js';
import { normaliseGrowthParams } from './growthDNA.js';
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { planVertical, rampSignature, vacateBuildings } from './RoadRampPlanner.js';

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
    // G02b: a chunk with a growthContext continues its parent's road skeleton (grid anchor) and city height centre
    // through the generators' optional arguments; without it the G01 / G02 path below is unchanged.
    const ctx = chunk.generationParameters.growthContext ?? null;
    const net = ctx ? growthNetwork(cell, chunk.cityId, terrain, ctx) : networkOf(cell, chunk.cityId, terrain);
    const t2 = now();
    const city = ctx ? growthUrban(terrain, net, chunk.generationParameters.urbanSeed, ctx) : generateUrbanLayer(terrain, net, net.network, null, { worldSeed: chunk.generationParameters.urbanSeed });
    const t3 = now();
    // G02c-02: vertical alignment of this uncommitted chunk. Plan geometry, blocks and parcels stay those of the generated network.
    const vertical = ctx?.vertical ? planVertical(net.network, terrain.fields, createSampler(terrain.fields), { ...ctx.vertical, chunkId }) : null;
    let vacated = [];
    if (vertical) {
      city.network = vertical.network;
      ({ buildings: city.buildings, vacated } = vacateBuildings(city.buildings, terrain.fields, vertical.height));
    }
    const outputs = {
      resolvedDNA: city.cityMatch.selectedDNA.id, fitScore: city.cityMatch.selectedDNA.fitScore,
      signatures: { height: terrain.fields.stats.heightSignature, water: terrain.fields.stats.waterSignature, network: city.network.signature, blocks: city.blocks.signature, parcels: city.parcels.signature, buildings: city.buildings.signature, ...(vertical ? { ramps: rampSignature(vertical.records, vacated) } : {}) },
      counts: { roadKm: round(city.network.stats.roadLength / 1000, 2), networkEdges: city.network.edges.length, blocks: city.blocks.stats.blocks, parcels: city.parcels.stats.parcels, buildings: city.buildings.stats.buildings },
      ms: { terrain: Math.round(t1 - t0), network: Math.round(t2 - t1), urban: Math.round(t3 - t2), total: Math.round(t3 - t0) },
      // G02: road / canal ports per side (growth infrastructure term) and 8 m edge profiles (conflict records).
      ports: portsBySide(city.network), profiles: edgeProfiles(terrain.fields),
      // G03a: real built quantities (m²), kept apart from the 1024 × 1024 m chunk coverage.
      grid: city.network.grid ?? null, buildingCentre: city.buildings.source.centre, centreSource: city.buildings.source.centreSource,
      boundaryBlocks: boundaryBlocks(city.blocks, terrain.fields.grid),
      roadGraph: city.network.edges.filter(e => e.kind !== 'canal').map(e => [e.from, e.to, Math.round(e.length), e.roadClass]), // G02b: city-level reachability
      morph: morphologyMetrics(city, terrain.fields.grid),
      ...(vertical ? { ramps: { profile: ctx.vertical.profile, records: vertical.records, vacatedBuildings: vacated, corridorCells: vertical.corridorCells.size } } : {}),
      areas: { builtFootprintM2: Math.round((city.buildings.buildings ?? []).reduce((s, x) => s + (x.footprintArea ?? 0), 0)), parcelM2: Math.round((city.parcels.parcels ?? []).reduce((s, x) => s + (x.area ?? 0), 0)) },
    };
    this.chunks.set(chunkId, { ...chunk, generationStatus: 'generated', outputs });
    const origin = this.cities.get(chunk.cityId);
    if (chunk.role === 'core') this.cities.set(chunk.cityId, { ...origin, generationStatus: 'core generated' });
    // The page draws the corridor; every measurement above keeps the world terrain.
    const shown = vertical ? { ...terrain, fields: { ...terrain.fields, height: vertical.height } } : terrain;
    return { chunk: this.chunks.get(chunkId), layers: { terrain: shown, net, city } };
  }

  // ---------- G02: growth chunks ----------
  // Registers one growth chunk (planned; generateChunk fills its outputs). Checks: free cell, parent of the same city,
  // parent edge-adjacent. Terrain seed and variation come from the cell (world-owned); urbanSeed from the citySeed.
  addGrowthChunk({ cityId, gx, gy, parentChunkId, step, reason, growthContext = null }) {
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
      generationParameters: { variation: cell.variation, transitionWidth: 128, chunkSize: this.chunkSize, urbanSeed: urbanSeedOf(citySeed, chunkId), idMode: 'spatial (07.1a)', terrainMode: 'raw (no seam correction)', ...(growthContext ? { growthContext } : {}) },
      growthReason: reason ?? null, generationStatus: 'planned', outputs: null,
    };
    this.chunks.set(chunkId, chunk);
    this.occupancy.set(cellKey(gx, gy), chunkId);
    return chunk;
  }

  // G02c: undo a growth chunk that failed validation before commit. Only a chunk no other chunk depends on can go.
  removeGrowthChunk(chunkId) {
    const chunk = this.chunks.get(chunkId);
    if (!chunk || chunk.role !== 'growth') throw new Error(`${chunkId} is not a growth chunk`);
    if ([...this.chunks.values()].some(c => c.parentChunkId === chunkId) || this.growth.history.some(e => e.newChunkId === chunkId)) throw new Error(`${chunkId} is already committed`);
    this.chunks.delete(chunkId);
    this.occupancy.delete(cellKey(chunk.worldCoordinate.gx, chunk.worldCoordinate.gy));
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
      growth: { generation: this.growth.generation, step: this.growth.step, stalled: this.growth.stalled, history: this.growth.history, encounterDecisions: this.growth.encounterDecisions ?? [], morphFailures: this.growth.morphFailures ?? [], ...(this.growth.mode ? { mode: this.growth.mode, roadAttempts: this.growth.roadAttempts ?? [] } : {}), ...(this.growth.gradeProfile ? { gradeProfile: this.growth.gradeProfile, candidateCache: this.growth.candidateCache ?? {} } : {}), historySchema: '{ step, cityId, parentChunkId, newChunkId, targetCoordinate, selectionScore, selectionWeight, growthReason, worldSeed, generationParameters, conflicts }' },
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
      const rebuilt = world.addGrowthChunk({ cityId: chunk.cityId, gx: chunk.worldCoordinate.gx, gy: chunk.worldCoordinate.gy, parentChunkId: chunk.parentChunkId, step: chunk.growthStep, reason: event.growthReason, growthContext: chunk.generationParameters.growthContext ?? null });
      if (rebuilt.terrainSeed !== chunk.terrainSeed || rebuilt.generation !== chunk.generation || JSON.stringify(rebuilt.generationParameters) !== JSON.stringify(chunk.generationParameters)) throw new Error(`Growth chunk ${chunk.chunkId} does not match the world rules`);
      world.chunks.set(chunk.chunkId, { ...rebuilt, expectedSignatures: chunk.expectedSignatures });
    }
    // States saved before placement v2 keep their stored origins (cells are restored, never re-placed).
    world.placement = saved.placement ? { placementVersion: 1, ...saved.placement, placed: [], candidates: null } : null;
    world.growth = { generation: saved.growth.generation, step: saved.growth.step ?? 0, stalled: saved.growth.stalled ?? null, history: [...saved.growth.history], encounterDecisions: [...(saved.growth.encounterDecisions ?? [])], morphFailures: [...(saved.growth.morphFailures ?? [])], ...(saved.growth.mode ? { mode: saved.growth.mode, roadAttempts: [...(saved.growth.roadAttempts ?? [])] } : {}), ...(saved.growth.gradeProfile ? { gradeProfile: saved.growth.gradeProfile, candidateCache: { ...(saved.growth.candidateCache ?? {}) } } : {}) };
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
  for (const p of network.edgePorts) out[p.side].push({ position: Math.round(p.position * 10) / 10, type: p.type, roadClass: p.roadClass, nodeId: p.nodeId, edgeId: p.edgeId, elevation: Math.round(p.elevation * 100) / 100, directionDeg: Math.round((p.directionDeg ?? 0) * 10) / 10 }); // G02b: ids + elevation; G03b: road direction at the port (additive)
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

// ---------- G02b helpers (generators called with their optional growth arguments) ----------
function growthNetwork(cell, cityId, terrain, ctx) {
  const t0 = now();
  const cityMatch = matchCity(terrain.analysis, { override: cityId });
  const network = generateNetwork(terrain.fields, terrain.analysis, cityMatch, terrain.config, { loops: true, growth: { grid: ctx.grid ?? null, entryPorts: [...(ctx.entryPorts ?? []), ...(ctx.crossCityEntries ?? [])], side: ctx.side } });
  return { key: `${terrain.key}|${cityId}|growth`, empty: false, cityMatch, network, ms: now() - t0, stageMs: {} };
}
function growthUrban(terrain, net, urbanSeed, ctx) {
  const { config, fields, analysis } = terrain;
  const id = { identity: { worldSeed: urbanSeed } };
  const blocks = generateBlocks(fields, analysis, net.network, net.cityMatch, config, id);
  const parcels = generateParcels(blocks, fields, net.network, net.cityMatch, config, id);
  const buildings = generateBuildings(parcels, fields, net.cityMatch, config, { ...id, ...(ctx.centre ? { centre: ctx.centre } : {}) });
  return { cityMatch: net.cityMatch, network: net.network, rawNetwork: net.network, blocks, parcels, buildings };
}
// Blocks that touch each chunk side (within 2 m): the block growth front of that side.
function boundaryBlocks(blocks, grid) {
  const { originX, originZ, size } = grid; const h = size / 2; const tol = 2;
  const out = { minX: { count: 0, areaM2: 0 }, maxX: { count: 0, areaM2: 0 }, minZ: { count: 0, areaM2: 0 }, maxZ: { count: 0, areaM2: 0 } };
  for (const b of blocks.blocks ?? []) {
    const sides = new Set();
    for (const p of b.polygon) {
      if (Math.abs(p.x - (originX - h)) < tol) sides.add('minX'); if (Math.abs(p.x - (originX + h)) < tol) sides.add('maxX');
      if (Math.abs(p.z - (originZ - h)) < tol) sides.add('minZ'); if (Math.abs(p.z - (originZ + h)) < tol) sides.add('maxZ');
    }
    for (const side of sides) { out[side].count += 1; out[side].areaM2 += Math.round(b.area ?? 0); }
  }
  return out;
}

// G02b morphology metrics of one generated chunk (all from generated data).
function morphologyMetrics(city, grid) {
  const km2 = (grid.size * grid.size) / 1e6;
  const roads = city.network.edges.filter(e => e.kind !== 'canal' && e.kind !== 'tunnel');
  // Dominant orientation: length-weighted circular mean of 4θ (orthogonal families fold together), in [0°, 90°).
  let sx = 0; let sz = 0; let total = 0;
  for (const e of roads) { const a = (e.axisDeg * Math.PI) / 180 * 4; sx += Math.cos(a) * e.length; sz += Math.sin(a) * e.length; total += e.length; }
  const dominantDeg = total ? ((((Math.atan2(sz, sx) * 180) / Math.PI / 4) % 90) + 90) % 90 : null;
  const quantile = (list, q) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const theta = ((dominantDeg ?? 0) * Math.PI) / 180; const u = [Math.cos(theta), Math.sin(theta)]; const v = [-u[1], u[0]];
  const aspects = (city.blocks.blocks ?? []).map(b => {
    const a = b.polygon.map(p => p.x * u[0] + p.z * u[1]); const c = b.polygon.map(p => p.x * v[0] + p.z * v[1]);
    const w = Math.max(...a) - Math.min(...a); const h = Math.max(...c) - Math.min(...c);
    return Math.max(w, h) / Math.max(1e-6, Math.min(w, h));
  });
  const frontage = (city.parcels.parcels ?? []).map(p => (p.frontages ?? []).reduce((s, f) => s + f.length, 0)).filter(x => x > 0);
  const heights = (city.buildings.buildings ?? []).map(b => b.height);
  const footprint = (city.buildings.buildings ?? []).reduce((s, b) => s + (b.footprintArea ?? 0), 0);
  const parcelArea = (city.parcels.parcels ?? []).reduce((s, p) => s + (p.area ?? 0), 0);
  const r = (x, d = 2) => (x === null || x === undefined ? null : +Number(x).toFixed(d));
  return {
    dominantOrientationDeg: r(dominantDeg, 2), orientationConcentration: r(total ? Math.hypot(sx, sz) / total : null, 3),
    roadDensityKmPerKm2: r(total / 1000 / km2, 2), primaryKm: r(roads.filter(e => e.roadClass === 'primary').reduce((s, e) => s + e.length, 0) / 1000, 2),
    blockAreaMedianM2: r(quantile((city.blocks.blocks ?? []).map(b => b.area), 0.5), 0), blockAspectMedian: r(quantile(aspects, 0.5), 2),
    parcelFrontageMedianM: r(quantile(frontage, 0.5), 1), buildingCoverage: r(parcelArea ? footprint / parcelArea : null, 3),
    heightMeanM: r(heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : null, 1), heightP90M: r(quantile(heights, 0.9), 1), heightMaxM: r(heights.length ? Math.max(...heights) : null, 1),
    deadEnds: deadEnds(city.network, grid),
  };
}
// Road nodes of degree 1 that are not on the chunk boundary (the boundary ends are ports, not dead ends).
function deadEnds(network, grid) {
  const deg = new Map();
  for (const e of network.edges) if (e.kind !== 'canal') { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
  return network.nodes.filter(n => deg.get(n.id) === 1 && !n.onBoundary).length;
}
