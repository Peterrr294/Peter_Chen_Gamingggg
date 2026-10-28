// A City of Cities — G01 Multi-Origin Initialization: configuration (pure data).
// Every weight, threshold and profile value below is a DESIGN HYPOTHESIS (A), not calibrated against real-city data.
import { hashParts } from '../flavor-clash-prototype/world/SeededRandom.js';
import { CHUNK } from '../seed-terrain/config.js';
import { CITY_DNA } from '../seed-terrain/cityMatchRules.js';
import { RULES as MORPHOLOGY_RULES } from '../world-grid/CityInfluence.js';
import { DNA_STRATEGY } from '../seed-terrain/networkStrategies.js';
import { CITY_GROWTH } from '../growing-world/growthConfig.js';

export const SCHEMA_VERSION = 2; // v1 (G01: cores only) is still readable; v2 adds growth chunks, history, growth parameters
export const STATE_KIND = 'a-city-of-cities/world-state';
export const CHUNK_SIZE = CHUNK.size; // frozen 1024 m computation unit

// The six City IDs (existing City DNAs). Alphabetical order is only a stable tie-break, never a priority.
export const CITY_IDS = Object.freeze(['amsterdamCanalRing', 'chicagoGrid', 'fezOrganicCore', 'lisbonHillCore', 'manhattanGrid', 'veniceWaterNetwork']);

// Public parameters (4), each with a spatial meaning.
export const PARAMS = Object.freeze({
  worldSeed: { initial: 6201, min: 1, max: 99999, step: 1, meaning: 'Reproducible variation of the landform field, city seeds and candidate sites' },
  minOriginDistance: { initial: 3, min: 2, max: 8, step: 1, meaning: 'Minimum Chebyshev distance between two city origins, in chunks (1 chunk = 1024 m)' },
  searchRadius: { initial: 6, min: 3, max: 16, step: 1, meaning: 'Radius (chunks) around the world origin in which each city samples candidate sites' },
  selectionSharpness: { initial: 4, min: 1, max: 12, step: 1, meaning: 'Exponent k of the weighted choice (weight = score^k): high = nearly always the best site, low = more variety' },
});
export const DEFAULT_PARAMS = Object.freeze(Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.initial])));
export function normaliseParams(input = {}) {
  return Object.fromEntries(Object.entries(PARAMS).map(([key, p]) => {
    const v = Number(input[key] ?? p.initial);
    return [key, Number.isFinite(v) ? Math.round(Math.min(p.max, Math.max(p.min, v))) : p.initial];
  }));
}

// Internal rule constants (not public).
export const PLACEMENT = Object.freeze({
  screenAttempts: 40, // cheap sites per city (landform field only)
  probedPerCity: 8, // best screened sites that get a real terrain probe (terrain + analysis, no roads / buildings)
  minBuildable: 0.05, // reject: less buildable land than this share of the chunk
  minScore: 0.25, // reject: weighted suitability below this
  waterRequiredMin: 0.02, // reject (water-required cities): water share below this
  // G01 fix (2026-10-28, placement v2):
  // Reject (water-required cities): share of the cell that is buildable land within 32 m of water. Calibrated on the
  // measured distribution of 46 wet cells (seeds 6201–6203): coast 0.010–0.027, river valley ≈ 0.04 (A, not real-city data).
  waterfrontMin: 0.005,
  expansionStep: 2, // chunks added to the search radius per expansion round (only for a city without a legal site)
  maxExpansions: 2, // at most this many expansion rounds (radius ≤ searchRadius + 4); then an explicit failure
});
export const PLACEMENT_VERSION = 2; // 1 = G01 as committed (69b3a1f); 2 = water-aware screen, waterfront check, bounded expansion, atomic failure

// Origin suitability profiles (A). Terms are 0–1; weights are relative.
//   slope       — 'flat': share of low-slope land; 'moderate': mix of low and medium slope (hill cities)
//   water       — 'required' (reject without water) | 'preferred' | 'neutral' | 'avoid'
//   terrainType — compatibility per landform (0 = reject); taken from the Growth DNA landform preference
export const ORIGIN_PROFILES = Object.freeze({
  veniceWaterNetwork: { slope: 'flat', water: 'required', weights: { slope: 1, buildable: 1, water: 3, terrainType: 2, dnaFit: 2 }, note: 'usable shore and water first' },
  manhattanGrid: { slope: 'flat', water: 'neutral', weights: { slope: 3, buildable: 3, water: 0.5, terrainType: 2, dnaFit: 2 }, note: 'flat, continuous land for a regular grid' },
  fezOrganicCore: { slope: 'moderate', water: 'avoid', weights: { slope: 1, buildable: 2, water: 1, terrainType: 2, dnaFit: 2 }, note: 'tolerates complex, organic sites' },
  amsterdamCanalRing: { slope: 'flat', water: 'required', weights: { slope: 2, buildable: 1, water: 2.5, terrainType: 2, dnaFit: 2 }, note: 'water system on flat land' },
  lisbonHillCore: { slope: 'moderate', water: 'preferred', weights: { slope: 2.5, buildable: 1, water: 1, terrainType: 2, dnaFit: 2 }, note: 'uses moderately sloped land near water' },
  chicagoGrid: { slope: 'flat', water: 'neutral', weights: { slope: 3, buildable: 3, water: 0.5, terrainType: 2, dnaFit: 1.5 }, note: 'flat, extensible land for an orthogonal grid' },
});

// City colours for labels / ownership (same palette as the G01 growth prototype).
export const CITY_COLOR = Object.freeze(Object.fromEntries(CITY_IDS.map(id => [id, CITY_GROWTH[id].color])));
export const cityLabel = id => CITY_DNA[id].label.split(' — ')[0];

// Seed hierarchy: worldSeed → citySeed → chunk urbanSeed. Hashes of stable identifiers only (no call order).
export const citySeedOf = (worldSeed, cityId) => 1 + (hashParts('a-city-of-cities', 'city-seed', worldSeed, cityId) % 999999);
export const urbanSeedOf = (citySeed, chunkId) => 1 + (hashParts('a-city-of-cities', 'chunk-urban-seed', citySeed, chunkId) % 999999);
export const chunkIdOf = (gx, gy) => `c_${gx}_${gy}`;

// Morphology DNA: read from the existing rule tables (07.1 RULES), never redefined here.
export function morphologyOf(cityId) {
  const out = { strategy: DNA_STRATEGY[cityId] };
  for (const rule of MORPHOLOGY_RULES) out[rule.id] = rule.value ? rule.value(cityId) : 'measured on the generated network';
  return out;
}

// Growth DNA (basic): the five fields implemented in the growth prototype + the three proposed fields (null).
export function growthOf(cityId) {
  const g = CITY_GROWTH[cityId];
  return { status: 'hypothesis (A), not used for growth in G01', rate: g.rate, terrainSuitability: { ...g.landform }, waterDependency: g.water, directionPreference: g.axis, compactness: g.compact, infrastructureDependency: null, branchingTendency: null, barrierResponse: null };
}
