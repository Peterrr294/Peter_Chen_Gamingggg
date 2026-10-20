export const MANHATTAN_TERRAIN_DEFAULTS = Object.freeze({
  seed: 'MANHATTAN-1101',
  mapWidth: 44,
  mapDepth: 72,
  resolution: 112,
  waterLevel: 0,
  baseElevation: 0.78,
  relief: 0.24,
  largeNoiseScale: 18,
  detailNoiseScale: 5.5,
  coastTransition: 2.4,
  shoreSetback: 2.8,
  maxBuildableSlope: 8,
});

export const MANHATTAN_TEST_SEEDS = Object.freeze([
  'MANHATTAN-1101',
  'MANHATTAN-2202',
  'MANHATTAN-3303',
]);

export function createManhattanConfig(overrides = {}) {
  return { ...MANHATTAN_TERRAIN_DEFAULTS, ...overrides };
}
