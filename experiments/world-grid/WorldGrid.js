// 06.2 / 06.3a World Grid runtime (pure data, no rendering). Layers per chunk, each cached by key:
//   raw      — the unchanged single-chunk landform generation, placed at worldOrigin (key: landform, seed, variation, origin)
//   harmony  — world-level, from all raw chunks + transitionWidth: 'coordinated' (06.3a-R2, TerrainCoordinator: world
//              datum + band-only seam correction, default), 'macroRamp' (06.3a-R, WorldTerrain: macro ramps) or
//              'harmonized' (06.3a, TerrainHarmonizer: edge-local joins);
//              deterministic, order-independent, independent of City ID. terrainMode 'raw' skips it (06.2 behaviour).
//   terrain  — fields + terrainAnalysis derived from the harmonised (or raw) height / water level (key: their checksums)
//   network  — City Match → Network, the unchanged single-chunk generator (key: terrain key + cityId)
//   roadSeam — world-level (06.3b, RoadSeam): joins the chunk networks across harmonised shared edges; key = every
//              network signature + harmony + transition width + road mode. Only chunks with a join get a new graph.
//   city     — Block → Parcel → Building on the stitched network (key: network key + stitched network signature),
//              so a chunk whose roads changed at a seam never keeps blocks / parcels / buildings of its old roads.
//   fusion   — 07.1 (CityInfluence, optional): one source chunk's DNA invades one neighbouring target chunk. The
//              target gets an invader network on its own terrain (cached by terrain key + invader DNA) and a fused
//              network (key: base network + invader + strength + radius); its city layer uses the mixed rule set.
//              Strength 0 (or no influence) = no fusion layer, every key as before.
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
import { coordinateWorld } from './WorldTerrain.js';
import { coordinateTerrain } from './TerrainCoordinator.js';
import { stitchRoads } from './RoadSeam.js';
import { fuseNetwork, influenceField, mixedRules } from './CityInfluence.js';

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

export function generateNetworkLayer(world, slot, terrain) {
  if (slot.cityId === null) return { key: `${terrain.key}|null`, empty: true, ms: 0, stageMs: {} };
  const t0 = now();
  const { config, fields, analysis } = terrain;
  const cityMatch = matchCity(analysis, { override: slot.cityId === 'auto' ? null : slot.cityId });
  const t1 = now();
  const network = generateNetwork(fields, analysis, cityMatch, config, { loops: true });
  const t2 = now();
  return { key: `${terrain.key}|${slot.cityId}`, empty: false, cityMatch, network, ms: t2 - t0, stageMs: { match: t1 - t0, network: t2 - t1 } };
}

// Blocks / parcels / buildings on the given (stitched or own) network; `fusion` (07.1) supplies the mixed rules,
// `identity` (07.1a, { worldSeed } or null) switches blocks / parcels / buildings to spatial ids and local streams.
export const cityKeyOf = (net, network, fusion, identity) => `${net.key}|${network.signature}${fusion ? `|${fusion.key}` : ''}${identity ? `|ids:spatial:${identity.worldSeed}` : ''}`;
export function generateUrbanLayer(terrain, net, network, fusion = null, identity = null) {
  if (net.empty) return { key: `${net.key}|empty`, empty: true, ms: 0, stageMs: {} };
  const t0 = now();
  const { config, fields, analysis } = terrain;
  const id = identity ? { identity } : {};
  const blocks = generateBlocks(fields, analysis, network, net.cityMatch, config, id);
  const t1 = now();
  const parcels = generateParcels(blocks, fields, network, net.cityMatch, config, { ...fusion?.rules.parcel, ...id });
  const t2 = now();
  const buildings = generateBuildings(parcels, fields, net.cityMatch, config, { ...fusion?.rules.building, ...id });
  const t3 = now();
  return {
    key: cityKeyOf(net, network, fusion, identity), empty: false, fusionKey: fusion?.key ?? null, identity: identity ? 'spatial' : 'legacy', cityMatch: net.cityMatch, network, rawNetwork: net.network, blocks, parcels, buildings,
    ms: net.ms + (t3 - t0), stageMs: { ...net.stageMs, blocks: t1 - t0, parcels: t2 - t1, buildings: t3 - t2 },
  };
}

// Single-chunk chain without a world seam (as 06.2 / 06.3a).
export function generateCityLayer(world, slot, terrain) {
  const net = generateNetworkLayer(world, slot, terrain);
  return net.empty ? net : generateUrbanLayer(terrain, net, net.network);
}

export class WorldGrid {
  constructor(world) {
    this.world = world;
    this.harmony = null; // { key, report, outputs, ms }
    this.roadSeam = null; // { key, report, ms }
    this.influence = null; // 07.1 { source, target, strength, radius } (chunk ids; strength 0-1, radius m)
    this.invaders = new Map(); // 07.1 cache: `${terrain key}|${dna}` -> invader network on that terrain
    this.idMode = 'legacy'; // 07.1a: 'legacy' (order-based ids, default, checkpoint signatures) | 'spatial'
    this.chunks = new Map(world.slots.map(slot => [slot.chunkId, { slot, raw: null, target: null, terrain: null, net: null, city: null, status: 'queued', error: null, builds: { raw: 0, terrain: 0, network: 0, city: 0 } }]));
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
    const harmonyKey = [mode, this.world.transitionWidth, mode === 'coordinated' || mode === 'macroRamp' ? this.world.worldSeed : '', ...[...this.chunks.values()].map(c => c.raw.key).sort()].join('#');
    if (!this.harmony || this.harmony.key !== harmonyKey) {
      const started = now();
      let report = null;
      let outputs;
      if (mode === 'raw') {
        outputs = new Map([...this.chunks.values()].map(c => [c.slot.chunkId, { height: c.raw.chunk.height, waterSurface: c.raw.chunk.waterSurface, harmony: null }]));
      } else {
        const input = [...this.chunks.values()].map(c => ({ chunkId: c.slot.chunkId, gridX: c.slot.gridX, gridY: c.slot.gridY, landform: c.slot.landform, grid: c.raw.chunk.grid, height: c.raw.chunk.height, waterSurface: c.raw.chunk.waterSurface }));
        report = mode === 'coordinated' ? coordinateTerrain(input, this.world.transitionWidth, this.world.worldSeed, this.world.variation)
          : mode === 'macroRamp' ? coordinateWorld(input, this.world.transitionWidth, this.world.worldSeed, this.world.variation) : harmonizeWorld(input, this.world.transitionWidth);
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

  // Which chunks must rebuild their terrain or network layer (the city layer follows from stitch()).
  dirty() {
    this.lastPrepare = this.prepare();
    return [...this.chunks.values()].map(chunk => {
      const terrain = !chunk.terrain || chunk.terrain.key !== chunk.target;
      const network = terrain || !chunk.net || chunk.net.key !== `${chunk.target}|${chunk.slot.cityId}`;
      return { chunkId: chunk.slot.chunkId, terrain, network };
    }).filter(item => item.terrain || item.network);
  }

  // Rebuild the terrain and network layers of one chunk if invalidated (call dirty() first). Returns which ran.
  buildNetwork(chunkId) {
    const chunk = this.chunks.get(chunkId);
    const ran = { terrain: false, network: false };
    try {
      if (!chunk.terrain || chunk.terrain.key !== chunk.target) {
        chunk.status = 'terrain';
        chunk.terrain = generateTerrainLayer(this.world, chunk.slot, chunk.raw, this.harmony.outputs.get(chunkId), chunk.target);
        chunk.net = null; chunk.city = null;
        chunk.builds.terrain += 1;
        ran.terrain = true;
      }
      if (!chunk.net || chunk.net.key !== `${chunk.target}|${chunk.slot.cityId}`) {
        chunk.status = 'network';
        chunk.net = generateNetworkLayer(this.world, chunk.slot, chunk.terrain);
        chunk.builds.network += 1;
        ran.network = true;
      }
      chunk.error = null;
    } catch (error) {
      chunk.status = 'error';
      chunk.error = error.message;
    }
    return ran;
  }

  setInfluence(influence) { this.influence = influence; }
  setIdMode(mode) { this.idMode = mode === 'spatial' ? 'spatial' : 'legacy'; }
  identity() { return this.idMode === 'spatial' ? { worldSeed: this.world.worldSeed } : null; }

  // 07.1 weight field w(x, z) of an influence { source, target, strength, radius } (seam guard = transition width).
  influenceWeight(inf) {
    const src = this.chunks.get(inf.source); const tgt = this.chunks.get(inf.target);
    return influenceField({ sourceOrigin: src.slot.worldOrigin, targetOrigin: tgt && inf.target !== inf.source ? tgt.slot.worldOrigin : null, chunkSize: this.world.chunkSize, strength: inf.strength, radius: inf.radius, guardWidth: this.world.transitionWidth });
  }

  // 07.1 status of the current influence: active only with strength > 0, two different neighbouring chunks and a
  // city on both. Returns { active, reason, source, target, sourceDNA, baseDNA, weightAt }.
  influenceState() {
    const inf = this.influence;
    if (!inf || !(inf.strength > 0)) return { active: false, reason: 'strength 0 (no influence)' };
    const src = this.chunks.get(inf.source); const tgt = this.chunks.get(inf.target);
    if (!src || !tgt || inf.source === inf.target) return { active: false, reason: 'source and target must be two chunks' };
    if (Math.max(Math.abs(src.slot.gridX - tgt.slot.gridX), Math.abs(src.slot.gridY - tgt.slot.gridY)) !== 1) return { active: false, reason: 'target is not a neighbour of the source' };
    if (!src.net || src.net.empty || !tgt.net || tgt.net.empty) return { active: false, reason: 'source and target both need a city (empty slots are not invaded)' };
    const weightAt = this.influenceWeight(inf);
    return { active: true, reason: null, source: inf.source, target: inf.target, sourceDNA: src.net.cityMatch.selectedDNA.id, baseDNA: tgt.net.cityMatch.selectedDNA.id, strength: inf.strength, radius: inf.radius, weightAt };
  }

  // 07.1 fusion layer of the target chunk (call after buildNetwork, before stitch). Other chunks: fusion = null.
  fuse() {
    const st = this.influenceState();
    const ran = { fused: false, invader: false, ms: 0, target: st.active ? st.target : null };
    for (const c of this.chunks.values()) if (!st.active || c.slot.chunkId !== st.target) c.fusion = null;
    if (!st.active) return ran;
    const c = this.chunks.get(st.target);
    const key = [st.source, st.sourceDNA, c.net.key, st.strength, st.radius, this.world.transitionWidth].join('|');
    if (c.fusion?.key === key) return ran;
    const started = now();
    const invaderKey = `${c.terrain.key}|${st.sourceDNA}`;
    if (!this.invaders.has(invaderKey)) {
      const { config, fields, analysis } = c.terrain;
      this.invaders.clear(); // one invader network at a time (memory)
      this.invaders.set(invaderKey, generateNetwork(fields, analysis, matchCity(analysis, { override: st.sourceDNA }), config, { loops: true }));
      ran.invader = true;
    }
    const invader = this.invaders.get(invaderKey);
    const fused = fuseNetwork({ base: c.net.network, invader, fields: c.terrain.fields, weightAt: st.weightAt, transitionWidth: this.world.transitionWidth, sourceDNA: st.sourceDNA, strength: st.strength, radius: st.radius });
    c.fusion = { key, ...st, invader, network: fused.graph, stats: fused.stats, unchanged: fused.unchanged, rules: mixedRules(st.baseDNA, st.sourceDNA, st.weightAt), ms: now() - started };
    ran.fused = true; ran.ms = c.fusion.ms;
    return ran;
  }

  // 06.3b world road seam (cached by key). Returns the chunks whose city layer is now stale.
  stitch() {
    const usable = [...this.chunks.values()].filter(c => c.terrain && c.net && c.status !== 'error');
    const own = c => (c.net.empty ? null : c.fusion?.network ?? c.net.network); // 07.1: the target uses its fused network
    const key = [this.world.roadMode, this.world.transitionWidth, this.harmony.key, ...usable.map(c => `${c.slot.chunkId}:${c.net.key}:${own(c)?.signature ?? 'empty'}`)].join('#');
    const ran = !this.roadSeam || this.roadSeam.key !== key;
    if (ran) {
      const input = usable.map(c => ({ chunkId: c.slot.chunkId, gridX: c.slot.gridX, gridY: c.slot.gridY, fields: c.terrain.fields, network: own(c) }));
      const report = stitchRoads(input, this.harmony.report, this.world.transitionWidth, this.world.roadMode);
      this.roadSeam = { key, report, ms: report.ms };
    }
    const stale = usable.filter(c => {
      const network = this.roadSeam.report.networks.get(c.slot.chunkId);
      const cityKey = c.net.empty ? `${c.net.key}|empty` : cityKeyOf(c.net, network, c.fusion, this.identity());
      if (c.city && c.city.key === cityKey && !c.city.empty) c.city.network = network; // same signature = same graph; keep one current object
      return !c.city || c.city.key !== cityKey;
    }).map(c => c.slot.chunkId);
    return { ran, ms: ran ? this.roadSeam.ms : 0, stale };
  }

  // Blocks / parcels / buildings of one chunk on its stitched network (call stitch() first).
  buildCity(chunkId) {
    const chunk = this.chunks.get(chunkId);
    try {
      chunk.status = 'city';
      chunk.city = generateUrbanLayer(chunk.terrain, chunk.net, chunk.net.empty ? null : this.roadSeam.report.networks.get(chunkId), chunk.fusion, this.identity());
      // 07.1a: last city built without fusion = stability baseline of this chunk (same id mode only).
      if (!chunk.fusion && !chunk.city.empty) chunk.baseCity = chunk.city;
      chunk.builds.city += 1;
      chunk.status = chunk.city.empty ? 'ready (terrain only)' : 'ready';
      chunk.error = null;
    } catch (error) {
      chunk.status = 'error';
      chunk.error = error.message;
    }
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
      terrainMode: this.world.terrainMode, roadMode: this.world.roadMode, transitionWidth: this.world.transitionWidth,
      status, error, builds,
      grid: terrain ? { originX: terrain.fields.grid.originX, originZ: terrain.fields.grid.originZ, size: terrain.fields.grid.size } : null,
      signatures: {
        raw: raw ? sum(raw.chunk.height) : null,
        height: terrain?.fields.stats.heightSignature ?? null, water: terrain?.fields.stats.waterSignature ?? null,
        network: city?.network?.signature ?? null, rawNetwork: city?.rawNetwork?.signature ?? null, blocks: city?.blocks?.signature ?? null, parcels: city?.parcels?.signature ?? null, buildings: city?.buildings?.signature ?? null,
      },
      counts: city && !city.empty ? { roadKm: +(city.network.stats.roadLength / 1000).toFixed(2), ports: city.network.edgePorts.length, tunnels: city.network.stats.tunnels, blocks: city.blocks.stats.blocks, parcels: city.parcels.stats.parcels, buildings: city.buildings.stats.buildings, meanHeight: +city.buildings.stats.meanHeight.toFixed(1) } : null,
      ms: { raw: raw ? Math.round(raw.ms) : null, terrain: terrain ? Math.round(terrain.ms) : null, city: city ? Math.round(city.ms) : null, stages: city ? Object.fromEntries(Object.entries(city.stageMs).map(([k, v]) => [k, Math.round(v)])) : null },
    };
  }
}
