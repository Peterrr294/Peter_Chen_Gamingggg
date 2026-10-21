// World State checkpoint (pure data). A versioned JSON wrapper around the existing saved form (serialiseWorld /
// restoreWorld): the world is reproduced from seeds + configuration, never from stored meshes. The wrapper adds the
// 3 × 3 layout, the rule versions and parameters of every world-level stage, and per-chunk signatures so a reload can
// prove that it regenerated the same world.
import { CHUNK, LANDFORMS } from '../seed-terrain/config.js';
import { COORDINATOR_RULES } from './TerrainCoordinator.js';
import { COORDINATION_RULES } from './WorldTerrain.js';
import { HARMONY_RULES } from './TerrainHarmonizer.js';
import { ROAD_SEAM_RULES } from './RoadSeam.js';
import { SEAM_CLASS_RULES } from './SeamClassifier.js';
import { SEAM_RULES } from './SeamCheck.js';
import { restoreWorld, serialiseWorld } from './worldConfig.js';

export const CHECKPOINT_KIND = 'procedural-mini-world/world-checkpoint';
export const CHECKPOINT_VERSION = 1;

// Generation rules the world depends on (the version labels name the log entries that define them).
export const RULE_VERSIONS = Object.freeze({
  chunk: { version: 'T1 (02.3)', size: CHUNK.size, segments: CHUNK.segments },
  landforms: { version: 'T1 (02.4)', parameters: LANDFORMS },
  terrain: {
    coordinated: { version: '06.3a-R2 + 06.3c corner pin', parameters: COORDINATOR_RULES },
    macroRamp: { version: '06.3a-R', parameters: COORDINATION_RULES },
    harmonized: { version: '06.3a', parameters: HARMONY_RULES },
    raw: { version: '06.2' },
  },
  roads: { version: '06.3b', parameters: ROAD_SEAM_RULES },
  seamCheck: { version: '06.2 / 06.3a', parameters: SEAM_RULES },
  seamClasses: { version: '06.3c', parameters: SEAM_CLASS_RULES },
});

// summaries: WorldGrid.summary() of every slot; seamClasses: classifier output (optional).
export function createCheckpoint(world, summaries, seamClasses = null, note = '') {
  const bySlot = new Map(summaries.map(s => [s.chunkId, s]));
  return {
    kind: CHECKPOINT_KIND, checkpointVersion: CHECKPOINT_VERSION, createdAt: new Date().toISOString(), note,
    world: serialiseWorld(world),
    layout: world.slots.map(slot => ({
      chunkId: slot.chunkId, gridX: slot.gridX, gridY: slot.gridY, worldOrigin: slot.worldOrigin, landform: slot.landform,
      terrainSeed: slot.terrainSeed, cityId: slot.cityId, cityMode: slot.cityMode, resolvedDNA: bySlot.get(slot.chunkId)?.resolvedDNA ?? null,
    })),
    rules: { activeTerrainMode: world.terrainMode, activeRoadMode: world.roadMode, ...RULE_VERSIONS },
    expected: {
      signatures: Object.fromEntries(summaries.map(s => [s.chunkId, s.signatures])),
      seamClasses: seamClasses ? Object.fromEntries(seamClasses.map(c => [c.id, c.overall])) : null,
    },
  };
}

// Returns the world configuration to load (seeds re-derived and checked by restoreWorld).
export function readCheckpoint(data) {
  if (data?.kind !== CHECKPOINT_KIND) throw new Error('Not a World State checkpoint');
  if (data.checkpointVersion !== CHECKPOINT_VERSION) throw new Error(`Unsupported checkpoint version ${data.checkpointVersion}`);
  return restoreWorld(data.world);
}

// Compares a regenerated world with the checkpoint's expected signatures and seam classes.
export function compareCheckpoint(data, summaries, seamClasses = null) {
  const mismatches = [];
  for (const s of summaries) {
    const expected = data.expected.signatures[s.chunkId];
    for (const [key, value] of Object.entries(expected ?? {})) if (s.signatures[key] !== value) mismatches.push({ chunkId: s.chunkId, key, expected: value, actual: s.signatures[key] });
  }
  if (data.expected.seamClasses && seamClasses) for (const c of seamClasses) if (data.expected.seamClasses[c.id] !== c.overall) mismatches.push({ edge: c.id, expected: data.expected.seamClasses[c.id], actual: c.overall });
  return { reproduced: mismatches.length === 0, mismatches };
}
