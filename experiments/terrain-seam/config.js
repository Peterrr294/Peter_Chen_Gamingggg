import { cloneRegionPresets } from '../flavor-clash-prototype/config/regionPresets.js';
import { regionSeed } from '../flavor-clash-prototype/world/SeededRandom.js';

export const TERRAIN_SEAM_WORLD_SEED = 'TERRAIN-SEAM-01';

export const DEFAULT_TRANSITION = Object.freeze({
  axis: 'x',
  coordinate: 0,
  transitionWidth: 6,
  boundaryIrregularity: 1.1,
  boundarySeed: 731927,
  boundaryNoiseScale: 14,
  noiseOffset: 19.75,
});

function profileConfig(config) {
  const { seam, ...copy } = config;
  return copy;
}

export function createSeamRegionConfigs(overrides = {}) {
  const presets = cloneRegionPresets();
  const common = {
    width: 54,
    depth: 54,
    terrainResolution: 120,
    centerZ: 0,
  };
  const venice = {
    ...presets.venice,
    ...common,
    label: 'Venice Zone',
    centerX: -27,
    heightProfile: 'venice',
    waterGeometry: 'venice-canals',
    terrainFeatures: {
      mainCanalWidth: overrides.veniceMainCanalWidth ?? 0.72,
      secondaryCanalWidth: overrides.veniceSecondaryCanalWidth ?? 0.44,
      branchCanalWidth: overrides.veniceBranchCanalWidth ?? 0.3,
      canalVariationSeed: 731927,
      canalExtension: { minX: -54 },
    },
    waterBankWidth: 0.08,
    enableTerrainClassification: true,
    enableBuildingScatter: true,
    buildingSeed: overrides.veniceBuildingSeed ?? 2101,
    buildingDensity: overrides.veniceBuildingDensity ?? 0.35,
    buildingCountLimit: 720,
    buildingMinSpacing: 1.3,
    buildingBuildabilityThreshold: 0.02,
    buildingMaxSlope: 0.85,
    buildingGridSpacing: overrides.veniceBuildingGridSpacing ?? 1.6,
    preserveBuildingGridSpacing: true,
    buildingBounds: { minX: -54, maxX: 0, minZ: -27, maxZ: 27 },
    buildingBoundsMargins: { minX: 0.05, maxX: 0, minZ: 0.6, maxZ: 0.6 },
    urbanMaxPlacements: 72,
    urbanWaterfrontDistance: 3.2,
    urbanQuayClearance: 0.16,
    urbanReferenceLongSide: 2.914,
  };
  const japan = {
    ...presets.tokyo,
    ...common,
    label: 'Japan Zone',
    centerX: 27,
    heightProfile: 'tokyo',
    waterLevel: 0.2,
    terrainFeatures: { streamWidth: 0.8, streamDepth: 0.11 },
    waterBankWidth: 0.08,
    seedOffset: 902,
    terrainColor: '#8f806a',
    roadColor: '#40382f',
    accentColor: '#d6a45f',
    enableTerrainClassification: true,
    enableBuildingScatter: true,
    buildingSeed: overrides.japanBuildingSeed ?? 2202,
    buildingDensity: overrides.japanBuildingDensity ?? 0.45,
    buildingCountLimit: 48,
    buildingMinSpacing: 1.3,
    buildingBuildabilityThreshold: 0.5,
    buildingMaxSlope: 0.85,
    buildingGridSpacing: overrides.japanBuildingGridSpacing ?? 1.5,
    buildingBounds: { minX: 0, maxX: 18, minZ: -9, maxZ: 9 },
    referenceAnchor: { x: 9, z: 0 },
  };
  const seam = {
    ...DEFAULT_TRANSITION,
    transitionWidth: overrides.transitionWidth ?? DEFAULT_TRANSITION.transitionWidth,
    boundaryIrregularity: overrides.boundaryIrregularity ?? DEFAULT_TRANSITION.boundaryIrregularity,
    profiles: {
      left: {
        heightProfile: venice.heightProfile,
        seed: regionSeed(TERRAIN_SEAM_WORLD_SEED, 'venice', venice.seedOffset),
        config: profileConfig(venice),
      },
      right: {
        heightProfile: japan.heightProfile,
        seed: regionSeed(TERRAIN_SEAM_WORLD_SEED, 'japan', japan.seedOffset),
        config: profileConfig(japan),
      },
    },
  };
  venice.seam = seam;
  japan.seam = seam;
  const reservedTransition = seam.transitionWidth / 2 + seam.boundaryIrregularity + 0.25;
  venice.buildingTransitionMargin = reservedTransition;
  venice.buildingBoundsMargins.maxX = reservedTransition;
  japan.buildingTransitionMargin = reservedTransition;
  return { venice, japan };
}
