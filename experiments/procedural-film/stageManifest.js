// WEB-01 Stage Manifest: what the film shows, in what order, and how far each stage is actually verified (pure data).
// Status words follow the compass: Verified means the task verifier passes; nothing here is Accepted yet.
export const STAGES = Object.freeze([
  { id: 'terrain', title: 'Terrain', duration: 7, line: 'A city-neutral height field rises. Low ground settles first, ridges last.', status: 'Verified', task: '02.4' },
  { id: 'analysis', title: 'Terrain Analysis', duration: 6, line: 'The site is read before any city exists: slope and water decide what is buildable.', status: 'Verified', task: '02.5' },
  { id: 'roads', title: 'Road Network', duration: 11, line: 'Streets grow along their own graph edges, main roads before secondary ones.', status: 'Verified', task: '03.1, 03.3' },
  { id: 'blocks', title: 'Urban Blocks', duration: 7, line: 'A block appears once the roads around it are complete.', status: 'Verified', task: '04.1, 04.1b' },
  { id: 'parcels', title: 'Parcels', duration: 8, line: 'Each block divides into lots that front a road.', status: 'Verified', task: '04.2' },
  { id: 'buildings', title: 'Buildings', duration: 13, line: 'Volumes extrude from real footprints. Taller buildings take longer to rise.', status: 'Verified', task: '05.1' },
  // Part II: a separate recorded run at world scale, see sceneManifest.js. Durations follow the recorded events: 30 growth steps × 1.3 s + the last reveal.
  { id: 'origins', title: 'Six Urban Origins', duration: 8, line: 'Six cities, placed by terrain suitability in one recorded world.', status: 'Verified', task: 'G01, G01-FIX', chapter: 2 },
  { id: 'growth', title: 'Procedural Urban Growth', duration: 44, line: 'One new chunk per recorded step, from its parent\'s frontier. World size and borders are outcomes.', status: 'Verified data · Prototype form', task: 'G02, G02-V', chapter: 2 },
  { id: 'encounter', title: 'Urban Encounter', duration: 18, line: 'A controlled experiment: Chicago and Fez are placed by hand so that they meet.', status: 'Controlled Experiment', task: 'G03b', chapter: 2 },
]);
export const CHAPTERS = Object.freeze([
  { id: 'part-1', title: 'Part I · How a city is generated' },
  { id: 'part-2', title: 'Part II · How cities form a world' },
]);
// WEB-01d Guided Tour: six chapters over the same timeline. A chapter is only a range of t, so the tour and free exploration share one loaded scene.
export const TOUR = Object.freeze([
  { title: 'The Landscape', line: 'Everything starts from land, generated before any city exists.', from: 'terrain', to: 'terrain', status: 'Verified' },
  { title: 'The Urban Rules', line: 'The site is read, then the rules of one city lay streets on it.', from: 'analysis', to: 'roads', status: 'Verified' },
  { title: 'The Generated City', line: 'Roads enclose blocks, blocks divide into parcels, parcels carry buildings.', from: 'blocks', to: 'buildings', status: 'Verified' },
  { title: 'Six Urban Identities', line: 'Six rule sets, placed by terrain in one recorded world.', from: 'origins', to: 'origins', status: 'Verified · recorded' },
  { title: 'Procedural Growth', line: 'Map size and city borders result from 30 recorded growth steps. Chunks do not yet continue each other\'s streets here.', from: 'growth', to: 'growth', status: 'Prototype · recorded' },
  { title: 'A City of Cities', line: 'Cities do not yet meet on their own. This controlled experiment tests what happens when they do.', from: 'encounter', to: 'encounter', status: 'Controlled Experiment · natural encounters Planned' },
]);
export const PART_ONE_LAST = 5; // index of the last stage of Part I
export const PART_ONE_END = STAGES.slice(0, PART_ONE_LAST + 1).reduce((sum, stage) => sum + stage.duration, 0);

export const DURATION = STAGES.reduce((sum, stage) => sum + stage.duration, 0);
export const STAGE_START = STAGES.reduce((list, stage, i) => { list.push(i ? list[i - 1] + STAGES[i - 1].duration : 0); return list; }, []);
export const stageAt = t => { let k = 0; for (let i = 0; i < STAGES.length; i += 1) if (t >= STAGE_START[i]) k = i; return k; };
export const stageEnd = k => STAGE_START[k] + STAGES[k].duration - 0.001;
export const stageProgress = (t, k) => Math.min(1, Math.max(0, (t - STAGE_START[k]) / STAGES[k].duration));

// One verified configuration per city: the terrain each DNA scored best on in the 06.1 verifier
// (experiments/seed-terrain/evidence/city-dna-comparison.json, `suitable`; 72 / 72 runs ok). There is no free seed input:
// scripts/verify-procedural-film.mjs checks the film's signatures against the same evidence.
export const FILM_CITIES = Object.freeze({
  manhattanGrid: { name: 'Manhattan', landform: 'plain', seed: 1101 },
  veniceWaterNetwork: { name: 'Venice', landform: 'coast', seed: 1101 },
  fezOrganicCore: { name: 'Fez', landform: 'coast', seed: 1101 },
  amsterdamCanalRing: { name: 'Amsterdam', landform: 'coast', seed: 1101 },
  lisbonHillCore: { name: 'Lisbon', landform: 'coast', seed: 2202 },
  chicagoGrid: { name: 'Chicago', landform: 'plain', seed: 1101 },
});
export const DEFAULT_CITY = 'lisbonHillCore'; // hills, water and organic streets show the terrain-first chain most clearly
