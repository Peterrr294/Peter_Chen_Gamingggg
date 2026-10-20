export const DEFAULT_ROAD_DOCUMENT = Object.freeze({
  schemaVersion: 1,
  region: 'iceland',
  roads: [
    {
      id: 'iceland-main-study',
      type: 'regional',
      width: 1.2,
      controlPoints: [
        { x: 0.16, z: 0.68 },
        { x: 0.34, z: 0.58 },
        { x: 0.53, z: 0.48 },
        { x: 0.71, z: 0.36 },
        { x: 0.84, z: 0.29 },
      ],
    },
  ],
});

export const DEFAULT_ROAD_OPTIONS = Object.freeze({
  sampleSpacing: 0.55,
  maxRoadSlope: 28,
  waterSafetyDistance: 0.3,
  previewHeight: 0.12,
  showRoadDebug: true,
});

export function createRoadDocument() {
  return JSON.parse(JSON.stringify(DEFAULT_ROAD_DOCUMENT));
}

export function createRoadOptions() {
  return { ...DEFAULT_ROAD_OPTIONS };
}

export function validateRoadDocument(document, surfaceQuery) {
  const errors = [];
  const seenIds = new Set();
  const roads = [];
  for (const [roadIndex, road] of (document.roads ?? []).entries()) {
    const roadErrors = [];
    if (!road.id || seenIds.has(road.id)) roadErrors.push({ code: 'duplicate-id', message: `Road ID must be present and unique: ${road.id || `(index ${roadIndex})`}` });
    seenIds.add(road.id);
    if (!road.type || typeof road.type !== 'string') roadErrors.push({ code: 'invalid-type', message: `${road.id}: type must be a string.` });
    if (!(road.width > 0)) roadErrors.push({ code: 'invalid-width', message: `${road.id}: width must be greater than zero.` });
    if (!Array.isArray(road.controlPoints) || road.controlPoints.length < 2) roadErrors.push({ code: 'insufficient-points', message: `${road.id}: at least two control points are required.` });
    (road.controlPoints ?? []).forEach((point, pointIndex) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.z) || point.x < 0 || point.x > 1 || point.z < 0 || point.z > 1) {
        roadErrors.push({ code: 'out-of-bounds', pointIndex, message: `${road.id}: control point ${pointIndex} must stay within 0–1.` });
      }
    });
    const samples = roadErrors.some(error => error.code === 'insufficient-points') ? [] : surfaceQuery.samplePath(road.controlPoints);
    if (samples.some(sample => !sample.inBounds)) roadErrors.push({ code: 'out-of-bounds', message: `${road.id}: sampled path leaves the terrain.` });
    if (samples.some(sample => sample.underwater || !sample.safeAboveWater)) roadErrors.push({ code: 'water', message: `${road.id}: sampled path enters water or its safety margin.` });
    if (samples.some(sample => sample.slope > surfaceQuery.options.maxRoadSlope)) roadErrors.push({ code: 'slope', message: `${road.id}: sampled path exceeds the maximum road slope.` });
    errors.push(...roadErrors);
    roads.push({ road, samples, valid: roadErrors.length === 0, errors: roadErrors });
  }
  return { valid: errors.length === 0, errors, roads };
}

export function exportableRoadDocument(document, terrain, options) {
  return {
    schemaVersion: 1,
    region: document.region,
    terrainReference: {
      seed: terrain.config.seed,
      signature: terrain.lastResult.signature,
      mapWidth: terrain.surfaceData.width,
      mapDepth: terrain.surfaceData.depth,
    },
    validationSettings: {
      sampleSpacing: options.sampleSpacing,
      maxRoadSlope: options.maxRoadSlope,
      waterSafetyDistance: options.waterSafetyDistance,
    },
    roads: document.roads.map(road => ({
      id: road.id,
      type: road.type,
      width: road.width,
      controlPoints: road.controlPoints.map(point => ({ x: point.x, z: point.z })),
    })),
  };
}
