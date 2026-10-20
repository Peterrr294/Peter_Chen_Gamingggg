// Terrain-first T1: frozen chunk specification. Not exposed as sliders.
export const CHUNK = Object.freeze({
  size: 1024, // metres per side
  segments: 256, // 257 × 257 height samples, 4 m spacing
  originX: 0, // world-space centre; neighbours will use multiples of size
  originZ: 0,
  shoreFreeboard: 1, // metres above the local water surface before ground is buildable
  maxBuildableSlope: 10, // degrees
});

// Transition zone inside the chunk; it never enlarges the chunk.
export const TRANSITION = Object.freeze({ min: 32, max: 256, step: 16, initial: 128 });

// Landform rules (metres). Seed only varies layout and noise within a rule.
export const LANDFORMS = Object.freeze({
  plain: { label: 'Plain', baseHeight: 20, relief: 7 },
  riverValley: {
    label: 'River valley', baseHeight: 30, relief: 70, riverGradient: 0.002,
    channelWidth: 32, channelDepth: 3, bankWidth: 18, bankHeight: 1.6, valleyHalfWidth: 230, meanderAmplitude: 150,
  },
  coast: {
    label: 'Coast', seaLevel: 0, relief: 45, beachGradient: 0.012, shelfGradient: 0.03, shelfDepth: 24, shorelineNoise: 90,
  },
  mountain: { label: 'Mountain', baseHeight: 120, relief: 300 },
});

export const DEFAULT_SELECTION = Object.freeze({ landform: 'plain', seed: 1101, variation: 0.5, transitionWidth: TRANSITION.initial });
export const TEST_SEEDS = Object.freeze([1101, 2202, 3303]);

export function snapTransitionWidth(value) {
  const snapped = Math.round(Number(value) / TRANSITION.step) * TRANSITION.step;
  return Math.min(TRANSITION.max, Math.max(TRANSITION.min, Number.isFinite(snapped) ? snapped : TRANSITION.initial));
}

// Resolves the UI selection into one flat, serialisable generator config.
export function createSeedTerrainConfig(selection = {}) {
  const merged = { ...DEFAULT_SELECTION, ...selection };
  const landform = LANDFORMS[merged.landform] ? merged.landform : DEFAULT_SELECTION.landform;
  return {
    ...LANDFORMS[landform],
    landform,
    seed: Math.min(9999, Math.max(1, Math.round(merged.seed))),
    variation: Math.min(1, Math.max(0, Number(merged.variation))),
    transitionWidth: snapTransitionWidth(merged.transitionWidth),
    chunk: CHUNK,
    shoreFreeboard: CHUNK.shoreFreeboard,
    maxBuildableSlope: CHUNK.maxBuildableSlope,
  };
}
