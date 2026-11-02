// WEB-01c Scene Manifest: the source of truth for what each scene of the film really is. The Inspector shows it as DATA SOURCE / VALIDATION STATUS.
// Scenes of different seeds and coordinates are never presented as one continuous simulation.
export const SOURCE_TYPE = Object.freeze({
  live: 'Live Generated Scene',
  replay: 'Recorded Simulation / Snapshot Replay',
  experiment: 'Verified Experiment',
  caseStudy: 'Controlled Experiment',
  planned: 'Planned Feature',
});
const CHAIN = 'experiments/seed-terrain/ (run in a Worker on this page)';
const PART_I = {
  chapterId: 'part-1', sourceType: SOURCE_TYPE.live, worldSeed: null, chunkId: null, sourceFile: CHAIN, availableSnapshots: 'none needed: generated when the page opens', availableGrowthEvents: 0,
  knownLimitations: ['The reveal order is derived from the data, not logged by the generators.', 'City DNA values are uncalibrated design assumptions.'],
};
const WORLD_FILE = 'experiments/procedural-film/world/world-6201-step30.json';
const CASE_FILE = 'experiments/procedural-film/world/encounter-case.json';

export const SCENES = Object.freeze([
  { ...PART_I, sceneId: 'terrain', stageId: 'terrain', validationStatus: 'Verified (task 02.4), not yet accepted', availableMetrics: 'height, slope, water, buildable' },
  { ...PART_I, sceneId: 'analysis', stageId: 'analysis', validationStatus: 'Verified (task 02.5), not yet accepted', availableMetrics: 'suitability, regions, direction' },
  { ...PART_I, sceneId: 'roads', stageId: 'roads', validationStatus: 'Verified (tasks 03.1, 03.3), not yet accepted', availableMetrics: 'graph, density, connectivity' },
  { ...PART_I, sceneId: 'blocks', stageId: 'blocks', validationStatus: 'Verified (tasks 04.1, 04.1b), not yet accepted', availableMetrics: 'count, area, enclosure, status' },
  { ...PART_I, sceneId: 'parcels', stageId: 'parcels', validationStatus: 'Verified (task 04.2), not yet accepted', availableMetrics: 'count, frontage, depth, area' },
  { ...PART_I, sceneId: 'buildings', stageId: 'buildings', validationStatus: 'Verified (task 05.1), not yet accepted', availableMetrics: 'count, height, coverage' },
  {
    sceneId: 'origins', chapterId: 'part-2', stageId: 'origins', sourceType: SOURCE_TYPE.replay, worldSeed: 6201, chunkId: 'six origin chunks', sourceFile: WORLD_FILE,
    validationStatus: 'Verified (G01, G01-FIX): every chunk equals its saved signatures. Not yet accepted.', availableSnapshots: '6 core chunks, growth step 0', availableGrowthEvents: 0, availableMetrics: 'origin suitability and its terms, placement order, chunk outputs',
    knownLimitations: ['A different run from Part I: world seed 6201, other terrain.', 'Terrain is shown at 16 m resolution; buildings and roads keep their real geometry.', 'Suitability weights are design hypotheses.'],
  },
  {
    sceneId: 'growth', chapterId: 'part-2', stageId: 'growth', sourceType: SOURCE_TYPE.replay, worldSeed: 6201, chunkId: 'one new chunk per step', sourceFile: WORLD_FILE,
    validationStatus: 'Verified (G02-V) on three seeds as data. Morphological quality is Prototype. Not yet accepted.', availableSnapshots: '36 chunks, growth steps 0 to 30', availableGrowthEvents: 30, availableMetrics: 'step, parent, new chunk, score, bids, seam conflicts, outputs',
    knownLimitations: ['The record holds one event per chunk. Roads appearing inside a chunk is a presentation of its final geometry, not a recorded event.', 'G02 generates each chunk independently: no road is inherited or joined, and terrain steps at chunk edges are real.', 'City size is nearly fixed by the scheduler.', 'Road-first continuity (G02b) is a separate experiment, not part of this run.'],
  },
  {
    sceneId: 'encounter', chapterId: 'part-2', stageId: 'encounter', sourceType: SOURCE_TYPE.caseStudy, worldSeed: 6201, chunkId: 'hand-placed test row', sourceFile: CASE_FILE,
    validationStatus: 'Verified experiment on a test fixture (G03b). Not a result of the world above. Not yet accepted.', availableSnapshots: '3 scenarios', availableGrowthEvents: 'fixture steps only', availableMetrics: 'encounter states, road interface, decisions, validation',
    knownLimitations: ['Chicago and Fez are placed by hand so that they meet. Cities do not yet meet this way in the grown world.', 'Same world seed, but other coordinates than the replay above.', 'The connector in the incompatible scenario is a plan and is not generated.'],
  },
]);
export const sceneOf = stageId => SCENES.find(scene => scene.stageId === stageId);

// Schedule of Part II as a pure function of the data: when each chunk starts to appear.
export const REVEAL_SECONDS = 2.4;
export const GROWTH_STEP_SECONDS = 1.3;
export const CASE_SECONDS = 6;
export const CASE_ORDER = ['compatible', 'incompatible', 'barrier'];

// When each world chunk starts to appear: origins in their real claim order, growth in its recorded steps.
export function chunkStarts(info, originStart, originEnd, growthStart) {
  const order = new Map(info.cities.map(city => [city.origin, city.reason.order ?? 0]));
  const span = Math.max(1, originEnd - originStart - REVEAL_SECONDS);
  const rank = [...order.values()].sort((a, b) => a - b);
  return new Map(info.chunks.map(chunk => [chunk.id, chunk.role === 'core'
    ? originStart + (rank.indexOf(order.get(chunk.id)) / Math.max(1, rank.length - 1)) * span
    : growthStart + (chunk.step - 1) * GROWTH_STEP_SECONDS]));
}

// Viewing levels of Part II. All three show the same recorded data; they differ in what the viewer can do.
export const LEVELS = Object.freeze({
  live: { label: 'Live 3D', note: 'Full geometry. Select chunks, debug layers, free camera.' },
  light: { label: 'Lightweight Replay', note: 'Same data: roofs instead of full volumes, 32 m terrain, centreline roads, no parcel lines. Select chunks, some layers, free camera.' },
  film: { label: 'Recorded Film', note: 'A video of the Live 3D render. Timeline and speeds work. No selection, layers or free camera.' },
});
// Measured frames per second that move Auto down one level. They are starting values, chosen so that motion stays readable.
export const AUTO_THRESHOLDS = Object.freeze({ partOneToLight: 24, liveToLight: 20, lightToFilm: 12, windowSeconds: 2.5 });
