// A City of Cities — G02 Procedural Urban Growth: growth configuration (pure data).
// Every weight, threshold and profile value is a DESIGN HYPOTHESIS (A), not calibrated against urban-history data.

// Public growth parameters (5), each with a spatial meaning. Together with the 4 G01 parameters: 9 public parameters.
export const GROWTH_PARAMS = Object.freeze({
  wTerrain: { initial: 3, min: 0, max: 5, step: 0.5, meaning: 'Weight of terrain: slope, buildable share, terrain type compatibility' },
  wWater: { initial: 1.5, min: 0, max: 5, step: 0.5, meaning: 'Weight of water: coverage, distance to water, read by the city water mode' },
  wInfra: { initial: 2, min: 0, max: 5, step: 0.5, meaning: 'Weight of infrastructure: road / canal ports toward the cell, buildable boundary on the joining side' },
  wUrban: { initial: 2, min: 0, max: 5, step: 0.5, meaning: 'Weight of urban growth: direction preference, compactness / branching, DNA fit' },
  jitter: { initial: 0.08, min: 0, max: 0.3, step: 0.01, meaning: 'Amplitude of the seeded score perturbation of each candidate (0 = rule-driven only)' },
});
export const DEFAULT_GROWTH_PARAMS = Object.freeze(Object.fromEntries(Object.entries(GROWTH_PARAMS).map(([k, p]) => [k, p.initial])));
export function normaliseGrowthParams(input = {}) {
  return Object.fromEntries(Object.entries(GROWTH_PARAMS).map(([key, p]) => {
    const v = Number(input[key] ?? p.initial);
    return [key, Number.isFinite(v) ? +Math.min(p.max, Math.max(p.min, v)).toFixed(3) : p.initial];
  }));
}

// Internal rule constants (not public).
export const GROWTH_RULES = Object.freeze({
  maxStepsPerRun: 30, // safety cap of "Grow multiple steps"
  minBuildable: 0.05, // reject: less buildable land than this share of the cell
  minScore: 0.2, // reject: suitability below this
  waterRequiredMin: 0.02, // reject (water-required growth): water share below this
  selectionSharpness: 4, // candidate weight = score^k (same rule as the G01 origin choice)
  cityJitter: 0.1, // seeded ± share on a city's bid
  seamContinuous: 2, seamStep: 30, // m: shared-edge height classes for conflict records
  portTolerance: 48, // m: two ports on a shared edge pair if this close
});

// Growth DNA per city (A). Fields:
//   rate          relative growth pressure in the scheduler bid
//   slope         'flat' | 'moderate' (hill-tolerant)
//   water         'required' (reject a cell without water) | 'seek' (score rises with water, no penalty without) |
//                 'neutral' | 'avoid'
//   direction     'roadAxis' (main-road ports toward the cell) | 'waterfront' (water in / around the cell) |
//                 'contour' (moderate slope with an accessible joining edge) | 'edgeBranch' (cells touching one
//                 city chunk only, i.e. branches off the edge) | 'infrastructure' (all ports + water) | 'none'
//   compactness   0–1 preference for cells with several same-city neighbours (1 = fill in)
//   infraDependency 0–1 multiplier of the infrastructure group (1 = growth needs roads)
//   barrier       'stopAtSlope' (reject mean land slope above 12°) | 'tolerateSlope'
// Terrain type compatibility comes from the G01 Growth DNA (CITY_GROWTH.landform).
export const GROWTH_DNA = Object.freeze({
  veniceWaterNetwork: { rate: 0.8, slope: 'flat', water: 'required', direction: 'waterfront', compactness: 0.6, infraDependency: 0.5, barrier: 'stopAtSlope', hypothesis: 'grows along usable shore and water; needs real water in the cell' },
  manhattanGrid: { rate: 1.0, slope: 'flat', water: 'neutral', direction: 'roadAxis', compactness: 0.4, infraDependency: 1, barrier: 'stopAtSlope', hypothesis: 'extends along existing main-road ports, keeps flat land for the orthogonal grid' },
  fezOrganicCore: { rate: 0.7, slope: 'moderate', water: 'avoid', direction: 'edgeBranch', compactness: 0.8, infraDependency: 0.6, barrier: 'tolerateSlope', hypothesis: 'compact, organic; branches off the existing urban edge' },
  amsterdamCanalRing: { rate: 0.9, slope: 'flat', water: 'seek', direction: 'infrastructure', compactness: 0.7, infraDependency: 0.9, barrier: 'stopAtSlope', hypothesis: 'flat land with water and road / canal organisation' },
  lisbonHillCore: { rate: 0.8, slope: 'moderate', water: 'seek', direction: 'contour', compactness: 0.4, infraDependency: 0.8, barrier: 'tolerateSlope', hypothesis: 'follows slopes and ridges where an accessible edge exists' },
  chicagoGrid: { rate: 1.1, slope: 'flat', water: 'neutral', direction: 'roadAxis', compactness: 0.2, infraDependency: 1, barrier: 'stopAtSlope', hypothesis: 'keeps the transport skeleton and large regular blocks extensible' },
});

// Uniform profile (for the future Experiment C; not used by default).
export const UNIFORM_DNA = Object.freeze({ rate: 0.9, slope: 'flat', water: 'neutral', direction: 'none', compactness: 0.5, infraDependency: 0.8, barrier: 'stopAtSlope', hypothesis: 'one shared rule for all cities (Experiment C0)' });

export const DIRECTIONS = Object.freeze({ N: [0, -1, 'minZ', 'maxZ'], S: [0, 1, 'maxZ', 'minZ'], E: [1, 0, 'maxX', 'minX'], W: [-1, 0, 'minX', 'maxX'] }); // dx, dy, side of the parent toward the cell, side of the cell toward the parent
