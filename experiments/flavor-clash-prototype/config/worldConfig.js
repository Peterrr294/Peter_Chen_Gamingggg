export const defaultWorldConfig = {
  worldSeed: 'FLAVOR-CLASH-01',
  mapWidth: 52,
  mapDepth: 52,
  regionGap: 4,
  centralPlazaRadius: 4.5,
  terrainResolution: 40,
  quality: 'Standard',
  autoRegenerate: false,
  showRegionBounds: false,
  showRoadConnections: false,
  showWfcGrid: false,
  showScatterCandidates: false,
  showRejectedScatter: false,
  showBuildabilityHeatmap: false,
  showWaterMask: false,
  mode: 'Showcase',
};

export const qualitySettings = {
  Draft: { resolutionScale: 0.65, scatterScale: 0.55 },
  Standard: { resolutionScale: 1, scatterScale: 1 },
  High: { resolutionScale: 1.35, scatterScale: 1.35 },
};

export function cloneWorldConfig() {
  return JSON.parse(JSON.stringify(defaultWorldConfig));
}
