export const DEFAULT_ICELAND_CONFIG = Object.freeze({
  seed: 'ICELAND-01',
  mapWidth: 34,
  mapDepth: 26,
  resolution: 96,
  heightScale: 7.5,
  largeNoiseScale: 11,
  detailNoiseScale: 3.2,
  ridgeStrength: 0.68,
  coastFalloff: 0.22,
  waterLevel: 0.55,
  wireframe: false,
});

export function createDefaultConfig() {
  return { ...DEFAULT_ICELAND_CONFIG };
}
