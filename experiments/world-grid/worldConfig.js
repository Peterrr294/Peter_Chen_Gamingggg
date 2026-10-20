// 06.2 World Grid configuration (pure data). Three separate concepts:
//   chunk      — fixed 1024 m computation unit at a fixed grid coordinate (CHUNK, frozen)
//   cityId     — the user's city identity choice for one slot (null = empty, 'auto', or a CITY_DNA key)
//   influence  — a future cross-chunk spatial field; NOT implemented here (no city expansion / blending)
import { hashParts } from '../flavor-clash-prototype/world/SeededRandom.js';
import { CHUNK, DEFAULT_SELECTION, LANDFORMS, snapTransitionWidth } from '../seed-terrain/config.js';
import { CITY_DNA } from '../seed-terrain/cityMatchRules.js';

export const WORLD = Object.freeze({
  columns: 3, // gridX ∈ {-1, 0, 1}
  rows: 3, // gridY ∈ {-1, 0, 1}; gridY runs along world +z
  chunkSize: CHUNK.size,
  defaultWorldSeed: 6201,
  configVersion: 1,
});

// Explicit local parameters per slot (landform is part of the terrain identity; cityId is not).
// Layout: mountains to the north (−z), plains + river in the middle, coast to the south (+z).
export const DEFAULT_LAYOUT = Object.freeze([
  { gridX: -1, gridY: -1, landform: 'mountain', cityId: null },
  { gridX: 0, gridY: -1, landform: 'mountain', cityId: 'auto' },
  { gridX: 1, gridY: -1, landform: 'riverValley', cityId: 'fezOrganicCore' },
  { gridX: -1, gridY: 0, landform: 'plain', cityId: 'chicagoGrid' },
  { gridX: 0, gridY: 0, landform: 'plain', cityId: 'manhattanGrid' },
  { gridX: 1, gridY: 0, landform: 'riverValley', cityId: 'auto' },
  { gridX: -1, gridY: 1, landform: 'coast', cityId: 'amsterdamCanalRing' },
  { gridX: 0, gridY: 1, landform: 'coast', cityId: 'auto' },
  { gridX: 1, gridY: 1, landform: 'coast', cityId: 'lisbonHillCore' },
]);

export const chunkIdOf = (gridX, gridY) => `chunk_${gridX}_${gridY}`;
export const worldOriginOf = (gridX, gridY) => ({ x: gridX * WORLD.chunkSize, z: gridY * WORLD.chunkSize });

// Terrain seed from worldSeed + fixed grid coordinate + explicit local parameter (landform).
// Slot order never enters the hash, so re-ordering or editing one slot leaves every other seed unchanged.
export function terrainSeedOf(worldSeed, gridX, gridY, landform) {
  return 1 + (hashParts('world-grid-terrain', worldSeed, gridX, gridY, landform) % 9999);
}

export const cityModeOf = cityId => (cityId === null ? 'empty' : cityId === 'auto' ? 'auto' : 'manual');

// Normalised, serialisable world configuration. Unknown city ids / landforms are rejected, not guessed.
export function createWorldConfig(input = {}) {
  const worldSeed = Math.max(1, Math.round(Number(input.worldSeed ?? WORLD.defaultWorldSeed))) || WORLD.defaultWorldSeed;
  const transitionWidth = snapTransitionWidth(input.transitionWidth ?? DEFAULT_SELECTION.transitionWidth);
  const variation = Math.min(1, Math.max(0, Number(input.variation ?? DEFAULT_SELECTION.variation)));
  // 06.3a: 'harmonized' (shared edges joined, default) or 'raw' (independent chunks, the 06.2 behaviour).
  const terrainMode = input.terrainMode === 'raw' ? 'raw' : 'harmonized';
  const given = new Map((input.slots ?? []).map(slot => [chunkIdOf(slot.gridX, slot.gridY), slot]));
  const slots = DEFAULT_LAYOUT.map(base => {
    const slot = { ...base, ...(given.get(chunkIdOf(base.gridX, base.gridY)) ?? {}) };
    if (!LANDFORMS[slot.landform]) throw new Error(`Unknown landform ${slot.landform} at ${chunkIdOf(slot.gridX, slot.gridY)}`);
    if (!(slot.cityId === null || slot.cityId === 'auto' || CITY_DNA[slot.cityId])) throw new Error(`Unknown cityId ${slot.cityId} at ${chunkIdOf(slot.gridX, slot.gridY)}`);
    return {
      chunkId: chunkIdOf(base.gridX, base.gridY),
      gridX: base.gridX,
      gridY: base.gridY,
      worldOrigin: worldOriginOf(base.gridX, base.gridY),
      landform: slot.landform,
      terrainSeed: terrainSeedOf(worldSeed, base.gridX, base.gridY, slot.landform),
      cityId: slot.cityId,
      cityMode: cityModeOf(slot.cityId),
    };
  });
  return { version: WORLD.configVersion, worldSeed, transitionWidth, variation, terrainMode, chunkSize: WORLD.chunkSize, slots };
}

// Minimal saved form: only user choices; seeds and origins are re-derived (and checked on restore).
export function serialiseWorld(config) {
  return {
    version: config.version, worldSeed: config.worldSeed, transitionWidth: config.transitionWidth, variation: config.variation, terrainMode: config.terrainMode,
    slots: config.slots.map(({ gridX, gridY, landform, cityId, terrainSeed }) => ({ gridX, gridY, landform, cityId, terrainSeed })),
  };
}

export function restoreWorld(saved) {
  if (saved?.version !== WORLD.configVersion) throw new Error(`Unsupported world config version ${saved?.version}`);
  const config = createWorldConfig(saved);
  for (const slot of saved.slots) {
    const now = config.slots.find(item => item.gridX === slot.gridX && item.gridY === slot.gridY);
    if (slot.terrainSeed !== undefined && slot.terrainSeed !== now.terrainSeed) throw new Error(`Seed mismatch at ${now.chunkId}: saved ${slot.terrainSeed}, derived ${now.terrainSeed}`);
  }
  return config;
}
