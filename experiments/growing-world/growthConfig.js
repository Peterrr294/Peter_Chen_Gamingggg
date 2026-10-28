// G01 Multi-Origin Procedural World Growth — configuration (pure data).
// Concepts kept apart, as in 06.2:
//   chunk     — the frozen 1024 m computation unit (CHUNK), placed at an integer world grid coordinate (gx, gy)
//   landform  — city-neutral terrain identity of a grid cell, read from a world-scale field (worldSeed + position only)
//   cityId    — the City DNA that owns a chunk; inherited from the parent chunk, never fused in G01
// Every weight / profile value below is a DESIGN HYPOTHESIS, not calibrated against real-city data.
import { hashParts } from '../flavor-clash-prototype/world/SeededRandom.js';
import { CHUNK } from '../seed-terrain/config.js';
import { terrainSeedOf } from '../world-grid/worldConfig.js';

export const GROWTH_VERSION = 1;
export const CHUNK_SIZE = CHUNK.size;

// The six City DNAs that own a core, in fixed scheduling / placement order (order is part of the rules).
export const CITY_ORDER = Object.freeze(['veniceWaterNetwork', 'manhattanGrid', 'fezOrganicCore', 'amsterdamCanalRing', 'lisbonHillCore', 'chicagoGrid']);

// Public parameters (≤ 10), each with a spatial meaning.
export const PARAMS = Object.freeze({
  worldSeed: { initial: 6201, min: 1, max: 99999, step: 1, meaning: 'Reproducible variation of the landform field, core sites and growth tie-breaks' },
  coreMinDistance: { initial: 3, min: 2, max: 8, step: 1, meaning: 'Minimum spacing between two city cores, in chunks (1 chunk = 1024 m), Chebyshev distance' },
  coreSpread: { initial: 5, min: 3, max: 14, step: 1, meaning: 'Radius (chunks) of the area in which core sites are sampled; widened automatically if six cores do not fit' },
  jitter: { initial: 0.12, min: 0, max: 0.5, step: 0.01, meaning: 'Amplitude of the seeded perturbation added to a candidate score (0 = purely rule-driven)' },
  wTerrain: { initial: 3, min: 0, max: 5, step: 0.5, meaning: 'Weight of the DNA terrain fit (02.6 fitScore of the candidate cell for the growing city)' },
  wSlope: { initial: 2, min: 0, max: 5, step: 0.5, meaning: 'Weight of buildable, low-slope land in the candidate cell' },
  wRoads: { initial: 2, min: 0, max: 5, step: 0.5, meaning: 'Weight of road / canal ports the parent chunk(s) already open toward the candidate edge' },
  wWater: { initial: 1, min: 0, max: 5, step: 0.5, meaning: 'Weight of the water term (affinity for water cities, penalty for land cities)' },
  wDNA: { initial: 2, min: 0, max: 5, step: 0.5, meaning: 'Weight of the City DNA growth tendency (landform preference, axis, compactness)' },
});
export const DEFAULT_PARAMS = Object.freeze(Object.fromEntries(Object.entries(PARAMS).map(([key, p]) => [key, p.initial])));

export function normaliseParams(input = {}) {
  return Object.fromEntries(Object.entries(PARAMS).map(([key, p]) => {
    const value = Number(input[key] ?? p.initial);
    const clamped = Number.isFinite(value) ? Math.min(p.max, Math.max(p.min, value)) : p.initial;
    return [key, p.step >= 1 ? Math.round(clamped) : clamped];
  }));
}

// Internal rule constants (not public parameters).
export const RULES = Object.freeze({
  coreCandidates: 10, // terrain-evaluated sites per city when placing cores
  coreAttempts: 400, // sampling attempts per city before the spread is widened
  minBuildable: 0.03, // a cell with less buildable land than this share is not a growth candidate (pure water / cliff)
  contestMargin: 0.05, // a rival claims a contested cell first if its score is higher by more than this
  weakFit: 0.35, // a chunk whose DNA fitScore (02.6) is below this is recorded as a suitability issue
  variationRange: [0.35, 0.65], // per-chunk parameter mutation of the landform variation (seeded by position)
  seamContinuous: 2, // m, max |Δh| along a shared edge to call it continuous
  seamStep: 30, // m, above this a shared edge is a cliff
  portTolerance: 48, // m, two ports on a shared edge pair if they are this close
});

// City DNA growth tendencies (design hypotheses, see the log entry G01).
//   rate          — relative share of growth turns (fair scheduler: lowest chunks / rate grows next)
//   landform      — preference per landform (0–1)
//   water         — +1 seeks water, −1 avoids it
//   axis          — preferred growth axis: 'x', 'y' (grid y = world +z) or null
//   compact       — 0–1, preference for cells with many same-city neighbours
export const CITY_GROWTH = Object.freeze({
  veniceWaterNetwork: { rate: 0.8, landform: { coast: 1, riverValley: 0.6, plain: 0.3, mountain: 0 }, water: 1, axis: null, compact: 0.6, color: 0x2fc4b2 },
  manhattanGrid: { rate: 1, landform: { plain: 1, coast: 0.7, riverValley: 0.6, mountain: 0.05 }, water: -0.3, axis: 'y', compact: 0.2, color: 0x4f8cff },
  fezOrganicCore: { rate: 0.7, landform: { riverValley: 1, plain: 0.6, mountain: 0.4, coast: 0.2 }, water: -0.5, axis: null, compact: 1, color: 0xf2a541 },
  amsterdamCanalRing: { rate: 0.9, landform: { coast: 0.9, plain: 0.9, riverValley: 0.8, mountain: 0 }, water: 0.6, axis: null, compact: 0.7, color: 0xff6fb5 },
  lisbonHillCore: { rate: 0.8, landform: { mountain: 0.8, coast: 1, riverValley: 0.6, plain: 0.3 }, water: 0.2, axis: null, compact: 0.4, color: 0x5fd35f },
  chicagoGrid: { rate: 1.2, landform: { plain: 1, coast: 0.8, riverValley: 0.7, mountain: 0 }, water: -0.2, axis: 'x', compact: 0.1, color: 0xa77bff },
});

export const cellKey = (gx, gy) => `${gx},${gy}`;
export const chunkIdOf = (gx, gy) => `g_${gx}_${gy}`;
export const worldOriginOf = (gx, gy) => ({ x: gx * CHUNK_SIZE, z: gy * CHUNK_SIZE });
// Keyed random in [0, 1), no call order. FNV-1a (hashParts) barely moves its high bits when only the last characters
// change (neighbouring cells), so a murmur3 fmix32 finaliser spreads them before scaling.
export function unit(...parts) {
  let h = hashParts('g01', ...parts);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// World-scale macro landform field: value noise on a 5-chunk lattice, from worldSeed + cell only. It never depends
// on growth order or on the city that grows there (terrain first).
const LATTICE = 5;
const smooth = t => t * t * (3 - 2 * t);
function valueNoise(worldSeed, channel, gx, gy) {
  const fx = gx / LATTICE; const fy = gy / LATTICE;
  const x0 = Math.floor(fx); const y0 = Math.floor(fy);
  const tx = smooth(fx - x0); const ty = smooth(fy - y0);
  const v = (x, y) => unit('lattice', worldSeed, channel, x, y);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
  return a + (b - a) * ty;
}

export function landformAt(worldSeed, gx, gy) {
  const elevation = 0.7 * valueNoise(worldSeed, 'elevation', gx, gy) + 0.3 * unit('cell-elevation', worldSeed, gx, gy);
  const wetness = 0.75 * valueNoise(worldSeed, 'wetness', gx, gy) + 0.25 * unit('cell-wetness', worldSeed, gx, gy);
  if (elevation > 0.66) return 'mountain';
  if (wetness > 0.6) return 'coast';
  if (wetness > 0.46) return 'riverValley';
  return 'plain';
}

// Cell identity: landform, terrain seed (06.2 formula, position-keyed) and the per-chunk variation mutation.
export function cellOf(worldSeed, gx, gy) {
  const landform = landformAt(worldSeed, gx, gy);
  const [lo, hi] = RULES.variationRange;
  return {
    gx, gy, chunkId: chunkIdOf(gx, gy), worldOrigin: worldOriginOf(gx, gy), landform,
    terrainSeed: terrainSeedOf(worldSeed, gx, gy, landform),
    variation: +(lo + (hi - lo) * unit('variation', worldSeed, gx, gy)).toFixed(3),
  };
}
