// 06.2 / 06.3a World Grid runtime (pure data, no rendering). Layers per chunk, each cached by key:
//   raw      — the unchanged single-chunk landform generation, placed at worldOrigin (key: landform, seed, variation, origin)
//   harmony  — world-level, from all raw chunks + transitionWidth (TerrainHarmonizer); deterministic, order-independent,
//              independent of City ID. terrainMode 'raw' skips it (06.2 behaviour, identical to the single-chunk page).
//   terrain  — fields + terrainAnalysis derived from the harmonised (or raw) height / water level (key: their checksums)
//   city     — City Match → Network → Block → Parcel → Building (key: terrain key + cityId)
// A layer is rebuilt only when its key changes, so stale roads / parcels / buildings never survive a terrain change.
//
// Placement: the landform rules sample the chunk-local frame (as on the single-chunk page, origin 0); the chunk is
// placed by translating its grid origin to worldOrigin, so every downstream layer works in world coordinates.
import { checksum } from '../cellular-noise/noise.js';
import { CHUNK, createSeedTerrainConfig } from '../seed-terrain/config.js';
import { generateChunk } from '../seed-terrain/TerrainGenerator.js';
import { applyNeighborConstraints, deriveFields } from '../seed-terrain/TerrainFields.js';
import { analyseTerrain } from '../seed-terrain/TerrainAnalysis.js';
import { matchCity } from '../seed-terrain/CityMatcher.js';
import { generateNetwork } from '../seed-terrain/NetworkGenerator.js';
import { generateBlocks } from '../seed-terrain/BlockGenerator.js';
import { generateParcels } from '../seed-terrain/ParcelGenerator.js';
import { generateBuildings } from '../seed-terrain/BuildingGenerator.js';
import { cityModeOf } from './worldConfig.js';
import { harmonizeWorld } from './TerrainHarmonizer.js';

const now = () => performance.now();
const sum = array => checksum(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));

export const rawKeyOf = (world, slot) => [slot.landform, slot.terrainSeed, world.variation, slot.worldOrigin.x, slot.worldOrigin.z].join('|');

const terrainConfigOf = (world, slot) => ({
  ...createSeedTerrainConfig({ landform: slot.landform, seed: slot.terrainSeed, variation: world.variation, transitionWidth: world.transitionWidth }),
  chunk: { ...CHUNK, originX: slot.worldOrigin.x, originZ: slot.worldOrigin.z },
});

export function generateRawLayer(world, slot) {
  const started = now();
  const config = terrainConfigOf(world, slot);
  const local = generateChunk({ ...config, chunk: CHUNK }); // landform layout in the chunk-local frame
  const chunk = { ...local, grid: { ...local.grid, originX: slot.worldOrigin.x, originZ: slot.worldOrigin.z } };
  return { key: rawKeyOf(world, slot), chunk, ms: now() - started };
}

// Fields + analysis from a height / water-level pair (raw or harmonised). Same functions as the single-chunk page.
export function generateTerrainLayer(world, slot, raw, surfaceData, key) {
  const started = now();
  const config = terrainConfigOf(world, slot);
  const fields = deriveFields({ ...raw.chunk, height: surfaceData.height, waterSurface: surfaceData.waterSurface }, config);
  applyNeighborConstraints(fields); // reserved interface, no neighbours passed (harmonisation happens before fields)
  const analysis = analyseTerrain(fields, config);
  return { key, config, fields, analysis, harmony: surfaceData.harmony ?? null, ms: now() - started };
}

export function generateCityLayer(world, slot, terrain) {
  if (slot.cityId === null) return { key: `${terrain.key}|null`, empty: true, ms: 0, stageMs: {} };
  const t0 = now();
  const { config, fields, analysis } = terrain;
  const cityMatch = matchCity(analysis, { override: slot.cityId === 'auto' ? null : slot.cityId });
  const t1 = now();
  const network = generateNetwork(fields, analysis, cityMatch, config, { loops: true });
  const t2 = now();
  const blocks = generateBlocks(fields, analysis, network, cityMatch, config);
  const t3 = now();
  const parcels = generateParcels(blocks, fields, network, cityMatch, config);
  const t4 = now();
  const buildings = generateBuildings(parcels, fields, cityMatch, config);
  const t5 = now();
  return {
    key: `${terrain.key}|${slot.cityId}`, empty: false, cityMatch, network, blocks, parcels, buildings,
    ms: t5 - t0, stageMs: { match: t1 - t0, network: t2 - t1, blocks: t3 - t2, parcels: t4 - t3, buildings: t5 - t4 },
  };
}

export class WorldGrid {
  constructor(world) {
    this.world = world;
    this.harmony = null; // { key, report, outputs, ms }
    this.chunks = new Map(world.slots.map(slot => [slot.chunkId, { slot, raw: null, target: null, terrain: null, city: null, status: 'queued', error: null, builds: { raw: 0, terrain: 0, city: 0 } }]));
  }

  setWorld(world) {
    this.world = world;
    for (const slot of world.slots) this.chunks.get(slot.chunkId).slot = slot;
    return this.dirty();
  }

  setCityId(chunkId, cityId) {
    const chunk = this.chunks.get(chunkId);
    const slot = { ...chunk.slot, cityId, cityMode: cityModeOf(cityId) };
    this.world = { ...this.world, slots: this.world.slots.map(item => (item.chunkId === chunkId ? slot : item)) };
    chunk.slot = slot;
    return this.dirty();
  }

  // Raw layers for every slot, then the world harmonisation, then each chunk's target terrain key.
  prepare() {
    const ran = { raw: [], harmony: false, harmonyMs: 0 };
    for (const chunk of this.chunks.values()) {
      if (!chunk.raw || chunk.raw.key !== rawKeyOf(this.world, chunk.slot)) { chunk.raw = generateRawLayer(this.world, chunk.slot); chunk.builds.raw += 1; ran.raw.push(chunk.slot.chunkId); }
    }
    const mode = this.world.terrainMode;
    const harmonyKey = [mode, this.world.transitionWidth, ...[...this.chunks.values()].map(c => c.raw.key).sort()].join('#');
    if (!this.harmony || this.harmony.key !== harmonyKey) {
      const started = now();
      let report = null;
      let outputs;
      if (mode === 'raw') {
        outputs = new Map([...this.chunks.values()].map(c => [c.slot.chunkId, { height: c.raw.chunk.height, waterSurface: c.raw.chunk.waterSurface, harmony: null }]));
      } else {
        const input = [...this.chunks.values()].map(c => ({ chunkId: c.slot.chunkId, gridX: c.slot.gridX, gridY: c.slot.gridY, landform: c.slot.landform, grid: c.raw.chunk.grid, height: c.raw.chunk.height, waterSurface: c.raw.chunk.waterSurface }));
        report = harmonizeWorld(input, this.world.transitionWidth);
        outputs = new Map([...report.chunks].map(([id, out]) => [id, { height: out.height, waterSurface: out.waterSurface, harmony: out }]));
      }
      this.harmony = { key: harmonyKey, mode, report, outputs, ms: now() - started };
      ran.harmony = true;
      ran.harmonyMs = this.harmony.ms;
    }
    for (const chunk of this.chunks.values()) {
      const out = this.harmony.outputs.get(chunk.slot.chunkId);
      chunk.target = [mode, this.world.transitionWidth, chunk.slot.worldOrigin.x, chunk.slot.worldOrigin.z, sum(out.height), sum(out.waterSurface)].join('|');
    }
    return ran;
  }

  // Which layers each chunk must rebuild.
  dirty() {
    this.lastPrepare = this.prepare();
    return [...this.chunks.values()].map(chunk => {
      const terrain = !chunk.terrain || chunk.terrain.key !== chunk.target;
      const city = terrain || !chunk.city || chunk.city.key !== `${chunk.target}|${chunk.slot.cityId}`;
      return { chunkId: chunk.slot.chunkId, terrain, city };
    }).filter(item => item.terrain || item.city);
  }

  // Rebuild only invalidated layers of one chunk (call dirty() / prepare() first). Returns which layers ran.
  build(chunkId) {
    const chunk = this.chunks.get(chunkId);
    const ran = { terrain: false, city: false };
    try {
      if (!chunk.terrain || chunk.terrain.key !== chunk.target) {
        chunk.status = 'terrain';
        chunk.terrain = generateTerrainLayer(this.world, chunk.slot, chunk.raw, this.harmony.outputs.get(chunkId), chunk.target);
        chunk.city = null;
        chunk.builds.terrain += 1;
        ran.terrain = true;
      }
      if (!chunk.city || chunk.city.key !== `${chunk.target}|${chunk.slot.cityId}`) {
        chunk.status = 'city';
        chunk.city = generateCityLayer(this.world, chunk.slot, chunk.terrain);
        chunk.builds.city += 1;
        ran.city = true;
      }
      chunk.status = chunk.city.empty ? 'ready (terrain only)' : 'ready';
      chunk.error = null;
    } catch (error) {
      chunk.status = 'error';
      chunk.error = error.message;
    }
    return ran;
  }

  // Raw-vs-harmonised comparison of one chunk (heights and water mask).
  difference(chunkId) {
    const { raw, terrain } = this.chunks.get(chunkId);
    const h0 = raw.chunk.height; const h1 = terrain.fields.height;
    const { segments, columns, spacing } = terrain.fields.grid; const W = this.world.transitionWidth;
    let changed = 0; let maxDelta = 0; let sumDelta = 0; let outsideBand = 0;
    for (let k = 0; k < h0.length; k += 1) {
      const d = Math.abs(h1[k] - h0[k]);
      if (d > 1e-6) {
        changed += 1; sumDelta += d;
        const row = Math.floor(k / columns); const col = k % columns;
        if (Math.min(col, segments - col, row, segments - row) * spacing >= W) outsideBand += 1;
      }
      maxDelta = Math.max(maxDelta, d);
    }
    let wetRaw = 0; let wetNow = 0; let wetChanged = 0;
    for (let k = 0; k < h0.length; k += 1) {
      const a = Number.isFinite(raw.chunk.waterSurface[k]) && h0[k] < raw.chunk.waterSurface[k] ? 1 : 0;
      const b = terrain.fields.waterMask[k];
      wetRaw += a; wetNow += b; if (a !== b) wetChanged += 1;
    }
    return { chunkId, changedCells: changed, changedOutsideBand: outsideBand, changedShare: +(changed / h0.length).toFixed(4), maxDelta: +maxDelta.toFixed(2), meanDeltaChanged: changed ? +(sumDelta / changed).toFixed(2) : 0, wetRaw, wetNow, wetChanged };
  }

  // Compact, comparable record of one chunk (signatures of every layer).
  summary(chunkId) {
    const { slot, raw, terrain, city, status, error, builds } = this.chunks.get(chunkId);
    const selected = city && !city.empty ? city.cityMatch.selectedDNA : null;
    return {
      chunkId, gridX: slot.gridX, gridY: slot.gridY, worldOrigin: slot.worldOrigin, landform: slot.landform, terrainSeed: slot.terrainSeed,
      cityId: slot.cityId, cityMode: slot.cityMode, resolvedDNA: selected?.id ?? null, resolvedLabel: selected?.label ?? null, autoTopId: selected?.autoTopId ?? null,
      terrainMode: this.world.terrainMode, transitionWidth: this.world.transitionWidth,
      status, error, builds,
      grid: terrain ? { originX: terrain.fields.grid.originX, originZ: terrain.fields.grid.originZ, size: terrain.fields.grid.size } : null,
      signatures: {
        raw: raw ? sum(raw.chunk.height) : null,
        height: terrain?.fields.stats.heightSignature ?? null, water: terrain?.fields.stats.waterSignature ?? null,
        network: city?.network?.signature ?? null, blocks: city?.blocks?.signature ?? null, parcels: city?.parcels?.signature ?? null, buildings: city?.buildings?.signature ?? null,
      },
      counts: city && !city.empty ? { roadKm: +(city.network.stats.roadLength / 1000).toFixed(2), ports: city.network.edgePorts.length, tunnels: city.network.stats.tunnels, blocks: city.blocks.stats.blocks, parcels: city.parcels.stats.parcels, buildings: city.buildings.stats.buildings, meanHeight: +city.buildings.stats.meanHeight.toFixed(1) } : null,
      ms: { raw: raw ? Math.round(raw.ms) : null, terrain: terrain ? Math.round(terrain.ms) : null, city: city ? Math.round(city.ms) : null, stages: city ? Object.fromEntries(Object.entries(city.stageMs).map(([k, v]) => [k, Math.round(v)])) : null },
    };
  }
}
