const common = {
  enabled: true,
  visible: true,
  width: 18,
  depth: 18,
  terrainResolution: 40,
  roadDensity: 0.48,
  wfcRetryLimit: 8,
  mainRoadWidth: 0.85,
  routeCurvature: 0.35,
  scatterDensity: 0.55,
  scatterMinDistance: 1.35,
  maxScatterSlope: 0.72,
};

export const defaultRegionPresets = {
  iceland: {
    ...common,
    label: 'Iceland', seedOffset: 101, centerX: -15, centerZ: -15,
    heightScale: 4.4, noiseScale: 7.2, noiseStrength: 0.9, waterLevel: 0.45,
    roadDensity: 0.32, scatterDensity: 0.32, scatterMinDistance: 1.8,
    terrainColor: '#dce8eb', roadColor: '#50606a', accentColor: '#8fc7d7',
  },
  tokyo: {
    ...common,
    label: 'Tokyo', seedOffset: 202, centerX: 15, centerZ: -15,
    heightScale: 1.6, noiseScale: 9.5, noiseStrength: 0.35, waterLevel: -1,
    roadDensity: 0.7, scatterDensity: 0.78, scatterMinDistance: 1.05,
    terrainColor: '#8d9096', roadColor: '#272a30', accentColor: '#f05b72',
    buildingSeed: 1202, buildingDensity: 0.7, buildingCountLimit: 72,
    buildingMinSpacing: 1.25, buildingBuildabilityThreshold: 0.55, buildingTransitionMargin: 1.5,
  },
  venice: {
    ...common,
    label: 'Venice', seedOffset: 303, centerX: -15, centerZ: 15,
    heightScale: 1.25, noiseScale: 8, noiseStrength: 0.28, waterLevel: 0.25,
    roadDensity: 0.62, mainRoadWidth: 0.7, scatterDensity: 0.68, scatterMinDistance: 1.1,
    terrainColor: '#b89a73', roadColor: '#d9c8aa', accentColor: '#35a4b8',
    buildingSeed: 1303, buildingDensity: 0.62, buildingCountLimit: 64,
    buildingMinSpacing: 1.3, buildingBuildabilityThreshold: 0.02, buildingTransitionMargin: 1.5,
  },
  hawaii: {
    ...common,
    label: 'Hawaii', seedOffset: 404, centerX: 15, centerZ: 15,
    heightScale: 6.2, noiseScale: 6, noiseStrength: 0.75, waterLevel: 0.32,
    roadDensity: 0.42, routeCurvature: 0.55, scatterDensity: 0.62, scatterMinDistance: 1.45,
    terrainColor: '#47794c', roadColor: '#6e5947', accentColor: '#e8672d',
  },
};

export function cloneRegionPresets() {
  return JSON.parse(JSON.stringify(defaultRegionPresets));
}
