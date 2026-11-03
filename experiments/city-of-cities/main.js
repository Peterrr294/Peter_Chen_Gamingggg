import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChunkView } from '../seed-terrain/ChunkView.js';
import { NetworkView } from '../seed-terrain/NetworkView.js';
import { BuildingView } from '../seed-terrain/BuildingView.js';
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { GrowthView } from '../growing-world/GrowthView.js';
import { WorldContext } from './WorldContext.js';
import { CHUNK_SIZE, CITY_IDS, DEFAULT_PARAMS, PARAMS, cityLabel, normaliseParams } from './originConfig.js';
import { OriginView, textSprite } from './OriginView.js';
import { WorldGrowthController } from './WorldGrowthController.js';
import { GROWTH_DNA, GROWTH_PARAMS, GROWTH_RULES } from './growthDNA.js';
import { GrowthOverlay } from './GrowthOverlay.js';
import { TerritoryModel } from './TerritoryModel.js';
import { TerritoryView } from './TerritoryView.js';
import { MorphologicalGrowth, verifyConnections } from './MorphologicalGrowth.js';
import { MorphView } from './MorphView.js';
import { UrbanEncounter } from './UrbanEncounter.js';
import { EncounterView } from './EncounterView.js';
import { cityRoadReach } from './RoadGrowthFrontAdapter.js';
import { RampView } from './RampView.js';
import { EmergentEncounterView } from './EmergentEncounterView.js';
import { GRADE_PROFILES } from './RoadRampPlanner.js';
import { ENCOUNTER_FIXTURES, createFixtureWorld, runFixtureSteps } from './encounterFixture.js';

// A City of Cities — G01 Multi-Origin Initialization + G02 Procedural Urban Growth. Six city origins placed by the
// world seed and an origin suitability evaluation; each chunk (core or growth) runs the unchanged single-chunk chain.
// G02: WorldGrowthController adds at most one chunk per step from the cities' growth frontiers.
// G03a: TerritoryModel (analysis layer) follows every growth event: spatial states, territories, boundaries,
// ecological constraints, city relationships; TerritoryView draws them as switchable layers.
// G02b: MorphologicalGrowth grows one selected city road-first from its real road ports (grid continuation, inherited
// entries, inherited height centre, recorded cross-chunk connections); MorphView shows fronts / joins / metrics.
// G03b: ?fixture=compatible|incompatible|barrier loads a TEST-ONLY Chicago × Fez world (cores placed by hand) and runs
// its growth steps through UrbanEncounter (detection, boundary context, negotiation); EncounterView draws the result.
// G02c-01: ?growthMode=road (or the folder "Road-driven growth") makes the scheduler take its candidates from real road fronts.
// G02c-02: &grade=conservative|baseline|permissive adds the ramp plan (vertical alignment) to road-driven growth.
// G03c-01: &emergent=1 lets the scheduler detect natural encounters after every commit (road mode only).
// G03c-02: &intercity=1 lets a newcomer chunk take other cities' road ends on a shared edge into its ramp plan.
// URL: ?worldSeed=… &candidates=1 &debug=1 &frontier=1 &focus=<cityId> &start=0 &steps=N (grow N after the origins)
const query = new URLSearchParams(location.search);
const STORAGE_KEY = 'procedural-mini-world/a-city-of-cities/world-state';

const canvas = document.querySelector('#worldCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x081014);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 5, 200000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xcde7ef, 0x17231d, 2.2));
const sun = new THREE.DirectionalLight(0xffefd2, 3);
sun.position.set(-2000, 3200, 1600);
scene.add(sun);

const paramsFromQuery = Object.fromEntries([...Object.keys(PARAMS), ...Object.keys(GROWTH_PARAMS)].filter(k => query.has(k)).map(k => [k, Number(query.get(k))]));
const ui = { ...normaliseParams({ ...DEFAULT_PARAMS, ...paramsFromQuery }), ...Object.fromEntries(Object.entries(GROWTH_PARAMS).map(([k, p]) => [k, paramsFromQuery[k] ?? p.initial])), steps: 10, growthMode: query.get('growthMode') === 'road' ? 'road' : 'chunk', gradeProfile: GRADE_PROFILES[query.get('grade')] ? query.get('grade') : 'none', rampAccepted: false, rampRejected: false, rampSeam: false, rampLabels: false, emergent: query.get('emergent') === '1', interCity: query.get('intercity') === '1', encBoundary: false, encPorts: false, encLabels: false, growthFrontier: false, history: false, morphCity: query.get('morphCity') ?? 'manhattanGrid', morphFronts: false, inheritedRoads: false, morphology: false, connectivity: false, chunkBorders: true, encounterZones: query.get('encounters') === '1', candidateConnections: false, interfaces: false, encounterConnectivity: false, morphDifference: false, fixture: query.get('fixture') ?? 'compatible', territory: query.get('territory') === '1', boundaries: query.get('boundaries') === '1', constraints: query.get('constraints') === '1', relationships: query.get('relationships') === '1', city: query.get('focus') ?? 'manhattanGrid', candidates: query.get('candidates') === '1', debug: query.get('debug') === '1', frontier: query.get('frontier') === '1', ownership: true, seams: false, visible: Object.fromEntries(CITY_IDS.map(id => [id, true])) };
function controllerOptions(extra = {}) { return { growthMode: ui.growthMode, ...(ui.growthMode === 'road' && GRADE_PROFILES[ui.gradeProfile] ? { gradeProfile: ui.gradeProfile } : {}), ...(ui.growthMode === 'road' && ui.emergent ? { encounters: true } : {}), ...(ui.growthMode === 'road' && ui.interCity && GRADE_PROFILES[ui.gradeProfile] ? { interCity: true } : {}), ...extra }; }
let world = new WorldContext(ui);
let growth = new WorldGrowthController(world, controllerOptions());
const growthOverlay = new GrowthOverlay(scene);
const rampView = new RampView(scene); // G02c-02
const emergentView = new EmergentEncounterView(scene); // G03c-01
const territoryView = new TerritoryView(scene);
let territory = null; // G03a TerritoryModel
let morph = new MorphologicalGrowth(world); // G02b
const morphView = new MorphView(scene);
const encounterView = new EncounterView(scene); // G03b
let encounter = new UrbanEncounter(world, morph);
const chunkEdges = new Map(); // chunkId → network edges (ids + points) of G02b growth chunks (inherited-road overlay)
const chunkTop = new Map(); // chunkId → max terrain height (overlay heights)
function newTerritory() { territory = new TerritoryModel(world); territory.refresh(growth); }
const growthView = new GrowthView(scene); // ownership frames + frontier outlines (render only, reused)
growthView.setVisible({ ownership: true, frontier: ui.frontier, seams: false });
const originView = new OriginView(scene);
const views = new Map(); // chunkId → { chunk, network, buildings, label }
const state = { busy: false, error: null, timing: null, builds: new Map(), mismatches: [], selected: ui.city, selectedChunk: null, cancel: false, growthTiming: [] };
const $ = id => document.querySelector(id);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

const disposeRoot = root => { root.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); root.removeFromParent(); };
function clearScene() {
  for (const v of views.values()) { disposeRoot(v.chunk.root); disposeRoot(v.network.root); disposeRoot(v.buildings.root); disposeRoot(v.label); }
  views.clear(); rampView.clear(); emergentView.clear(); growthView.clear(); originView.clear(); growthOverlay.clear(); territoryView.clear(); chunkTop.clear(); morphView.clear(); chunkEdges.clear(); encounterView.clear();
}
function removeChunkView(chunkId) {
  const v = views.get(chunkId);
  if (!v) return;
  disposeRoot(v.chunk.root); disposeRoot(v.network.root); disposeRoot(v.buildings.root); disposeRoot(v.label);
  views.delete(chunkId); growthView.removeOwnership(chunkId); chunkTop.delete(chunkId);
}

function renderChunk(chunk, layers) {
  const { terrain, city } = layers;
  const v = { chunk: new ChunkView(scene), network: new NetworkView(scene), buildings: new BuildingView(scene), label: null };
  v.chunk.update(terrain.fields, terrain.config, 'classes', terrain.analysis, null, null);
  v.chunk.terrain.userData.cityId = chunk.cityId;
  v.chunk.terrain.userData.chunkId = chunk.chunkId;
  v.network.update(city.network, createSampler(terrain.fields).height);
  v.network.markers.visible = false; // port / portal points are screen-sized; unreadable at world scale
  v.buildings.update(city.buildings);
  if (chunk.generationParameters.growthContext) chunkEdges.set(chunk.chunkId, city.network.edges.map(e => ({ id: e.id, points: e.points, ramp: e.ramp ?? null })));
  v.label = textSprite([`${cityLabel(chunk.cityId)} · ${chunk.chunkId}${chunk.role === 'growth' ? ` · step ${chunk.growthStep}` : ' · core'}`, `${chunk.terrainType} · terrain seed ${chunk.terrainSeed} · gen ${chunk.generation}`]);
  v.label.position.set(chunk.worldOrigin.x, terrain.fields.stats.maxHeight + 160, chunk.worldOrigin.z);
  scene.add(v.label);
  views.set(chunk.chunkId, v);
  chunkTop.set(chunk.chunkId, terrain.fields.stats.maxHeight);
  growthView.addOwnership({ chunkId: chunk.chunkId, cityId: chunk.cityId, worldOrigin: chunk.worldOrigin, parentChunkId: chunk.parentChunkId }, terrain.fields.stats);
  state.builds.set(chunk.chunkId, (state.builds.get(chunk.chunkId) ?? 0) + 1);
  applyVisibility();
}

function applyVisibility() {
  for (const [chunkId, v] of views) {
    const on = ui.visible[world.chunks.get(chunkId).cityId];
    v.chunk.root.visible = on; v.network.root.visible = on; v.buildings.root.visible = on; v.label.visible = on && ui.chunkBorders;
  }
  originView.setVisible(ui);
  growthView.setVisible({ ownership: ui.ownership && ui.chunkBorders, frontier: ui.frontier, seams: false });
  growthOverlay.setVisible(ui);
  morphView.setVisible(ui);
  rampView.setVisible(ui);
  emergentView.setVisible(ui);
  encounterView.setVisible(ui);
  territoryView.setVisible(ui);
}

function refreshOverlays() {
  originView.updateCandidates(world.placement, world.cities, state.selected);
  originView.updateDebug(world.cities, world.chunks);
  const cells = new Map();
  for (const id of world.cities.keys()) for (const f of world.frontierOf(id)) {
    const key = `${f.gx},${f.gy}`;
    if (!cells.has(key)) cells.set(key, { gx: f.gx, gy: f.gy, cities: [] });
    cells.get(key).cities.push(id);
  }
  growthView.updateFrontier([...cells.values()]);
  if (growth.lastFrontier === null && world.cities.size === 6 && [...world.chunks.values()].every(c => c.outputs)) growth.lastFrontier = growth.evaluate(world.growth.step + 1); // preview of the next step
  growthOverlay.updateFrontier(territory?.derived?.frontier ?? growth.lastFrontier); // G03a: frontier after the last step
  territoryView.update(territory?.derived ?? null, id => chunkTop.get(id));
  if ((world.cities.size === 6 || world.fixture) && [...world.chunks.values()].every(c => c.outputs)) { // G03b: also the 2-city fixture
    const events = world.growth.history.filter(e => e.mode === 'g02b-road-first');
    const cities = [...new Set(events.map(e => e.cityId))];
    const connectivity = Object.fromEntries(cities.map(id => [id, { ...morph.connectivity(id), coreChunkId: world.cities.get(id).originChunkId }]));
    state.morphConnectivity = connectivity;
    morphView.update({ fronts: !ui.morphFronts ? [] : ui.morphCity === 'all' ? CITY_IDS.flatMap(id => morph.fronts(id)) : morph.fronts(ui.morphCity), events, connectivity }, id => world.chunks.get(id), id => chunkTop.get(id), id => chunkEdges.get(id));
  }
  if (world.fixture && world.chunks.size && [...world.chunks.values()].every(c => c.outputs)) {
    const encounters = encounter.detect();
    state.encounters = encounters;
    const paths = Object.fromEntries(encounters.filter(e => e.crossCityConnections.length).map(e => [e.encounterId, encounter.path(e.cityA, e.cityB)]));
    state.encounterPaths = paths;
    encounterView.update({ encounters, decisions: world.growth.encounterDecisions ?? [], paths }, id => world.chunks.get(id), id => chunkTop.get(id), id => chunkEdges.get(id));
  }
  rampView.update(world.growth.history.filter(e => e.ramps), id => world.chunks.get(id), id => chunkEdges.get(id));
  emergentView.update(world.growth.encounters ?? [], id => world.chunks.get(id), id => chunkTop.get(id));
  growthOverlay.updateHistory(world.growth.history, id => world.chunks.get(id));
  applyVisibility();
}

function fitOverview(mode = 'top') {
  resize();
  const cells = [...world.chunks.values()].map(c => c.worldCoordinate);
  const b = cells.length ? { minX: Math.min(...cells.map(c => c.gx)) - 1, maxX: Math.max(...cells.map(c => c.gx)) + 1, minY: Math.min(...cells.map(c => c.gy)) - 1, maxY: Math.max(...cells.map(c => c.gy)) + 1 } : { minX: -3, maxX: 3, minY: -3, maxY: 3 };
  const cx = ((b.minX + b.maxX) / 2) * CHUNK_SIZE; const cz = ((b.minY + b.maxY) / 2) * CHUNK_SIZE;
  const ex = (b.maxX - b.minX + 1) * CHUNK_SIZE; const ez = (b.maxY - b.minY + 1) * CHUNK_SIZE;
  const fit = (Math.max(ez, ex / camera.aspect) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
  controls.target.set(cx, 0, cz);
  if (mode === 'top') camera.position.set(cx, fit, cz + 1); else camera.position.set(cx + fit * 0.3, fit * 0.7, cz + fit * 0.75);
  camera.far = fit * 6; camera.updateProjectionMatrix(); controls.update();
}

// Camera over every probed site of the selected city (origin suitability view).
function fitCandidates(cityId = state.selected) {
  resize();
  const sites = world.placement?.candidates?.[cityId]?.probed ?? [];
  if (!sites.length) return;
  const b = { minX: Math.min(...sites.map(s => s.gx)), maxX: Math.max(...sites.map(s => s.gx)), minY: Math.min(...sites.map(s => s.gy)), maxY: Math.max(...sites.map(s => s.gy)) };
  const cx = ((b.minX + b.maxX) / 2) * CHUNK_SIZE; const cz = ((b.minY + b.maxY) / 2) * CHUNK_SIZE;
  const ex = (b.maxX - b.minX + 1.2) * CHUNK_SIZE; const ez = (b.maxY - b.minY + 1.2) * CHUNK_SIZE;
  const fit = (Math.max(ez, ex / camera.aspect) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
  controls.target.set(cx, 0, cz); camera.position.set(cx, fit, cz + 1); camera.far = fit * 6; camera.updateProjectionMatrix(); controls.update();
}

function focusCity(cityId = state.selected) {
  const o = world.cities.get(cityId);
  if (!o) return;
  const { x, z } = o.worldPosition;
  controls.target.set(x, 20, z); camera.position.set(x + 520, 760, z + 980); camera.far = 30000; camera.updateProjectionMatrix(); controls.update();
}

// ---------- Tasks (serial; the page yields a frame after every probe and every chunk) ----------
let queue = Promise.resolve();
function run(label, task) {
  queue = queue.then(async () => {
    state.busy = true; state.error = null; window.__originLab.ready = false;
    $('#statusText').textContent = label;
    await nextFrame();
    try { await task(); } catch (error) { console.error(error); state.error = error.message; $('#statusText').textContent = `ERROR: ${error.message}`; }
    refreshOverlays();
    renderPanel();
    state.busy = false;
    if (!state.error) $('#statusText').textContent = world.growth.stalled ? `STALLED AT STEP ${world.growth.stalled.step} · ${world.chunks.size} CHUNKS` : `READY · ${world.cities.size} CITIES · ${world.chunks.size} CHUNKS · GROWTH STEP ${world.growth.step}`;
    window.__originLab.ready = true;
  });
  return queue;
}

async function buildChunks(compare) {
  const timing = state.timing;
  const order = [...world.chunks.values()].sort((a, b) => a.growthStep - b.growthStep || a.chunkId.localeCompare(b.chunkId)).map(c => c.chunkId);
  for (const chunkId of order) {
    $('#statusText').textContent = `GENERATING ${chunkId} · ${cityLabel(world.chunks.get(chunkId).cityId).toUpperCase()}`;
    await nextFrame();
    const t0 = performance.now();
    const { chunk, layers } = world.generateChunk(chunkId);
    const t1 = performance.now();
    renderChunk(chunk, layers);
    if (compare && JSON.stringify(chunk.expectedSignatures) !== JSON.stringify(chunk.outputs.signatures)) state.mismatches.push({ chunkId, expected: chunk.expectedSignatures, now: chunk.outputs.signatures });
    timing.chunks.push({ chunkId, cityId: chunk.cityId, dataMs: Math.round(t1 - t0), renderMs: Math.round(performance.now() - t1), stages: chunk.outputs.ms });
    if (timing.firstRenderMs === null) { await nextFrame(); timing.firstRenderMs = Math.round(performance.now() - timing.started); fitOverview(); }
  }
  timing.totalMs = Math.round(performance.now() - timing.started);
  timing.memoryMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
}

function generate(label = 'PLACING CITY ORIGINS') {
  return run(label, async () => {
    clearScene(); state.builds.clear(); state.mismatches = [];
    world = new WorldContext(ui);
    growth = new WorldGrowthController(world, controllerOptions()); state.growthTiming = []; state.selectedChunk = null;
    morph = new MorphologicalGrowth(world); state.morphFailure = null; state.morphRestore = null; encounter = new UrbanEncounter(world, morph);
    state.timing = { started: performance.now(), placementMs: 0, probes: 0, chunks: [], firstRenderMs: null, totalMs: 0, memoryMB: null };
    const it = world.initialiseSteps();
    for (let r = it.next(); !r.done; r = it.next()) { $('#statusText').textContent = `EVALUATING ORIGIN SITES · ${cityLabel(r.value.cityId).toUpperCase()} ${r.value.probed} / ${r.value.of}`; await nextFrame(); }
    growth = new WorldGrowthController(world, controllerOptions()); // placement clears the growth state, including its mode
    state.timing.placementMs = Math.round(performance.now() - state.timing.started); state.timing.probes = world.stats.probes;
    fitOverview();
    await buildChunks(false);
    growth.initialEncounters?.(); // G03c-01: cores now exist
    if (!world.placement.failures.length) newTerritory();
    fitOverview();
  });
}
const reset = () => run('RESET', async () => { clearScene(); world = new WorldContext(ui); growth = new WorldGrowthController(world); state.timing = null; state.builds.clear(); state.growthTiming = []; });

// ---------- G02 growth (one chunk per step; the same single-step logic for one or many steps) ----------
function growSteps(n) {
  const count = Math.min(Math.max(1, Math.round(n)), GROWTH_RULES.maxStepsPerRun);
  return run(`GROWING ${count} STEP(S)`, async () => {
    state.cancel = false;
    for (let i = 0; i < count && !state.cancel; i += 1) {
      $('#statusText').textContent = `GROWING STEP ${world.growth.step + 1} (${i + 1} / ${count}) · ${world.chunks.size} CHUNKS`;
      await nextFrame();
      const t0 = performance.now();
      const r = growth.step();
      if (r.stalled) break;
      territory.applyEvent(r.event); territory.refresh(growth); // G03a: incremental ownership, derived analysis
      const t1 = performance.now();
      renderChunk(r.chunk, r.layers);
      state.selectedChunk = r.chunk.chunkId;
      refreshOverlays();
      if (ui.autoFit !== false) fitOverview();
      state.growthTiming.push({ step: r.event.step, chunkId: r.event.newChunkId, cityId: r.event.cityId, evaluateMs: r.event.ms.evaluate, generateMs: r.event.ms.generate, renderMs: Math.round(performance.now() - t1), totalMs: Math.round(performance.now() - t0), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null });
      renderPanel();
      await nextFrame();
    }
  });
}
// ---------- G02b road-first morphological growth of one city ----------
const growMorph = (cityId = ui.morphCity) => run(`G02B ROAD-FIRST GROWTH · ${cityLabel(cityId).toUpperCase()}`, async () => {
  await nextFrame();
  const r = morph.grow(cityId);
  if (r.failure) { state.morphFailure = r.failure; return; }
  state.morphFailure = null;
  territory?.applyEvent(r.event); territory?.refresh(growth);
  renderChunk(r.chunk, r.layers);
  state.selectedChunk = r.chunk.chunkId;
});
// ---------- G03b encounter fixture (TEST ONLY: Chicago × Fez cores placed by hand) ----------
// upTo: number of fixture growth steps to run (default all); continuing a world skips the steps already in its history.
const runFixture = (name = ui.fixture, upTo = Infinity, fresh = true) => run(`G03B FIXTURE · ${name.toUpperCase()}`, async () => {
  if (fresh) {
    clearScene(); state.builds.clear(); state.mismatches = [];
    world = createFixtureWorld(name);
    growth = new WorldGrowthController(world); state.growthTiming = []; state.selectedChunk = null; territory = null; state.morphRestore = null; state.territoryRestore = null;
    state.timing = { started: performance.now(), placementMs: 0, probes: 0, chunks: [], firstRenderMs: null, totalMs: 0, memoryMB: null };
    ui.fixture = name; ui.worldSeed = world.worldSeed;
  }
  morph = new MorphologicalGrowth(world); encounter = new UrbanEncounter(world, morph);
  const it = runFixtureSteps(world, name, upTo);
  for (let r = it.next(); !r.done; r = it.next()) {
    const v = r.value;
    if (v.kind === 'core') renderChunk(v.chunk, v.layers);
    else if (!v.result.failure) { renderChunk(v.result.chunk, v.result.layers); state.selectedChunk = v.result.chunk.chunkId; }
    $('#statusText').textContent = `G03B FIXTURE · ${name.toUpperCase()} · ${world.chunks.size} CHUNKS · STEP ${world.growth.step}`;
    await nextFrame();
  }
  fitOverview();
});
const resetToOrigins = () => run('RESET TO ORIGINS', async () => {
  for (const c of [...world.chunks.values()]) if (c.role === 'growth') removeChunkView(c.chunkId);
  growth.resetToOrigins(); state.growthTiming = []; state.selectedChunk = null;
  newTerritory();
  fitOverview();
});
function load(saved) {
  return run('LOADING WORLD STATE', async () => {
    clearScene(); state.builds.clear(); state.mismatches = [];
    world = WorldContext.restore(saved);
    growth = new WorldGrowthController(world); state.growthTiming = []; state.selectedChunk = null; // a saved road-driven world continues in that mode
    ui.growthMode = growth.growthMode; ui.gradeProfile = world.growth.gradeProfile ?? 'none';
    morph = new MorphologicalGrowth(world); state.morphFailure = null; encounter = new UrbanEncounter(world, morph);
    world.fixture = [...world.cities.values()][0]?.placementReason?.fixture?.split(':')[1] ?? null; // G03b test fixture
    Object.assign(ui, world.params, world.growthParams);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    state.timing = { started: performance.now(), placementMs: 0, probes: 0, chunks: [], firstRenderMs: null, totalMs: 0, memoryMB: null };
    await buildChunks(true);
    // G02b: every recorded cross-chunk connection is recomputed from the regenerated chunks.
    const checks = verifyConnections(world); state.morphRestore = checks.length ? (checks.every(c => c.same) ? `${checks.length} growth event(s): connections reproduced` : 'CONNECTIONS DIFFER') : null;
    // G03a: replay the history, re-probe the saved evaluated cells, and require the saved analysis to be reproduced.
    if (saved.territory) { territory = TerritoryModel.restore(world, growth, saved.territory); state.territoryRestore = 'exact (saved analysis reproduced)'; }
    else if (world.cities.size === 6) { newTerritory(); state.territoryRestore = 'rebuilt from history (no saved analysis)'; }
    else { territory = null; state.territoryRestore = 'not applicable (fixture world)'; }
    fitOverview();
  });
}
const stateWithTerritory = () => ({ ...world.serialise(), ...(territory?.derived ? { territory: territory.snapshot() } : {}) });
const saveLocal = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(stateWithTerritory())); $('#saveState').textContent = `saved: seed ${world.worldSeed}, ${world.chunks.size} chunks, growth step ${world.growth.step} (browser storage)`; };
const loadLocal = () => { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) { $('#saveState').textContent = 'nothing saved'; return queue; } return load(JSON.parse(raw)); };

// ---------- UI ----------
const gui = new GUI({ title: 'A City of Cities (G01 + G02)', container: $('#gui') });
gui.add(ui, 'worldSeed', PARAMS.worldSeed.min, PARAMS.worldSeed.max, 1).name('World seed');
gui.add({ f: () => generate() }, 'f').name('Generate six origins');
gui.add({ f: () => generate('REGENERATING (SAME SEED)') }, 'f').name('Regenerate');
gui.add({ f: reset }, 'f').name('Reset');
const grow = gui.addFolder('Growth (G02)');
grow.add({ f: () => growSteps(1) }, 'f').name('Grow one step');
grow.add(ui, 'steps', 1, GROWTH_RULES.maxStepsPerRun, 1).name('Steps (max 30)');
grow.add({ f: () => growSteps(ui.steps) }, 'f').name('Grow multiple steps');
grow.add({ f: () => { state.cancel = true; } }, 'f').name('Stop after current step');
grow.add({ f: resetToOrigins }, 'f').name('Reset to origins');
grow.add(ui, 'growthFrontier').name('Show growth frontier').onChange(applyVisibility);
grow.add(ui, 'ownership').name('Show city territory').onChange(applyVisibility);
grow.add(ui, 'history').name('Show growth history').onChange(applyVisibility);
const mg = gui.addFolder('Morphological growth (G02b)');
mg.add(ui, 'morphCity', { 'All cities': 'all', ...Object.fromEntries(CITY_IDS.map(id => [cityLabel(id), id])) }).name('City').onChange(() => refreshOverlays());
mg.add({ f: () => growMorph() }, 'f').name('Grow selected city (road-first)');
mg.add(ui, 'morphFronts').name('Show growth fronts').onChange(() => refreshOverlays());
mg.add(ui, 'inheritedRoads').name('Show inherited roads').onChange(applyVisibility);
mg.add(ui, 'morphology').name('Show parent–child morphology').onChange(applyVisibility);
mg.add(ui, 'connectivity').name('Show road connectivity').onChange(applyVisibility);
mg.add(ui, 'chunkBorders').name('Show chunk boundaries').onChange(applyVisibility);
mg.add(ui, 'history').name('Show growth history').onChange(applyVisibility);
const rd = gui.addFolder('Road-driven growth (G02c-01)');
rd.add(ui, 'growthMode', { 'Chunk frontier (G02)': 'chunk', 'Real road fronts (G02c)': 'road' }).name('Scheduler candidates (apply on Generate)');
rd.add(ui, 'gradeProfile', { 'No ramp plan (G02c-01: 3 m rule)': 'none', 'Conservative 4 %': 'conservative', 'Baseline 6 %': 'baseline', 'Permissive 8 %': 'permissive' }).name('Ramp grade (apply on Generate)');
rd.add({ f: () => growSteps(1) }, 'f').name('Grow one scheduled step');
rd.add(ui, 'rampAccepted').name('Show accepted ramps').onChange(applyVisibility);
rd.add(ui, 'rampRejected').name('Show unconnected road ends').onChange(applyVisibility);
rd.add(ui, 'rampSeam').name('Show terrain seam conflicts').onChange(applyVisibility);
rd.add(ui, 'rampLabels').name('Show ramp numbers').onChange(applyVisibility);
const em = gui.addFolder('Natural encounters (G03c-01)');
em.add(ui, 'emergent').name('Detect encounters (apply on Generate)');
em.add(ui, 'interCity').name('Inter-city connections, G03c-02 (apply on Generate)');
em.add(ui, 'encBoundary').name('Show encounter boundaries').onChange(applyVisibility);
em.add(ui, 'encPorts').name('Show proposals per road end').onChange(applyVisibility);
em.add(ui, 'encLabels').name('Show encounter states').onChange(applyVisibility);
rd.add(ui, 'morphFronts').name('Show road growth fronts').onChange(() => refreshOverlays());
rd.add(ui, 'growthFrontier').name('Show accepted / rejected candidates').onChange(applyVisibility);
rd.add(ui, 'inheritedRoads').name('Show generated (continued) roads').onChange(applyVisibility);
rd.add(ui, 'history').name('Show parent–child relationship').onChange(applyVisibility);
const enc = gui.addFolder('Urban encounter (G03b, test fixture)');
enc.add(ui, 'fixture', Object.fromEntries(Object.entries(ENCOUNTER_FIXTURES).map(([k, f]) => [f.title, k]))).name('Scenario');
enc.add({ f: () => runFixture(ui.fixture) }, 'f').name('Run Chicago × Fez scenario');
enc.add({ f: () => runFixture(ui.fixture, 1) }, 'f').name('Run first step only');
enc.add({ f: () => runFixture(world.fixture ?? ui.fixture, Infinity, false) }, 'f').name('Continue scenario');
enc.add(ui, 'encounterZones').name('Show encounter zones').onChange(applyVisibility);
enc.add(ui, 'candidateConnections').name('Show candidate connections').onChange(applyVisibility);
enc.add(ui, 'interfaces').name('Show accepted / rejected interfaces').onChange(applyVisibility);
enc.add(ui, 'encounterConnectivity').name('Show road connectivity').onChange(applyVisibility);
enc.add(ui, 'morphDifference').name('Show morphological difference').onChange(applyVisibility);
enc.add(ui, 'chunkBorders').name('Show chunk boundaries').onChange(applyVisibility);
const terr = gui.addFolder('Territory (G03a)');
terr.add(ui, 'territory').name('Show city territories').onChange(applyVisibility);
terr.add(ui, 'boundaries').name('Show territory boundaries').onChange(applyVisibility);
terr.add(ui, 'constraints').name('Show ecological constraints').onChange(applyVisibility);
terr.add(ui, 'growthFrontier').name('Show growth frontiers').onChange(applyVisibility);
terr.add(ui, 'relationships').name('Show city relationships').onChange(applyVisibility);
const growthRules = grow.addFolder('Growth weights (apply on Generate)');
for (const key of Object.keys(GROWTH_PARAMS)) growthRules.add(ui, key, GROWTH_PARAMS[key].min, GROWTH_PARAMS[key].max, GROWTH_PARAMS[key].step).name(key);
growthRules.close();
gui.add({ f: saveLocal }, 'f').name('Save world state');
gui.add({ f: loadLocal }, 'f').name('Load world state');
gui.add({ f: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(stateWithTerritory(), null, 2)], { type: 'application/json' })); a.download = `city-of-cities-${world.worldSeed}-step${world.growth.step}.json`; a.click(); } }, 'f').name('Export state (JSON)');
const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
fileInput.addEventListener('change', async () => { const file = fileInput.files[0]; if (file) load(JSON.parse(await file.text())); fileInput.value = ''; });
gui.add({ f: () => fileInput.click() }, 'f').name('Import state (JSON)');
gui.add(ui, 'city', Object.fromEntries(CITY_IDS.map(id => [cityLabel(id), id]))).name('Selected city').onChange(id => { state.selected = id; refreshOverlays(); renderPanel(); });
gui.add({ f: () => focusCity() }, 'f').name('Focus selected city');
gui.add({ f: () => fitOverview('top') }, 'f').name('Overview (top)');
gui.add({ f: () => fitOverview('axo') }, 'f').name('Overview (oblique)');
gui.add(ui, 'candidates').name('Show origin suitability (selected city)').onChange(applyVisibility);
gui.add({ f: () => fitCandidates() }, 'f').name('View selected city sites');
gui.add(ui, 'debug').name('Show ID / coordinate debug').onChange(applyVisibility);
gui.add(ui, 'frontier').name('Show potential growth directions').onChange(applyVisibility);
const vis = gui.addFolder('City visibility (no regeneration)');
for (const id of CITY_IDS) vis.add(ui.visible, id).name(cityLabel(id)).onChange(applyVisibility);
vis.close();
const rules = gui.addFolder('Placement rules (apply on Generate)');
for (const key of Object.keys(PARAMS).filter(k => k !== 'worldSeed')) rules.add(ui, key, PARAMS[key].min, PARAMS[key].max, PARAMS[key].step).name(key);
rules.close();

function renderPanel() {
  const t = state.timing;
  $('#worldInfo').textContent = world.cities.size ? `seed ${world.worldSeed} · ${world.cities.size} origins · ${world.chunks.size} chunks · growth step ${world.growth.step}, max generation ${world.growth.generation}${world.growth.stalled ? ' · STALLED' : ''} · min distance ${world.params.minOriginDistance}, search radius ${world.params.searchRadius}, k ${world.params.selectionSharpness}${world.placement?.failures?.length ? ` · FAILURES: ${world.placement.failures.map(f => `${f.cityId}: ${f.reason}`).join('; ')}` : ''}` : 'no world (Generate world origins)';
  $('#orderInfo').textContent = world.placement ? `claim order (fewest qualified sites first, ties by seeded hash): ${world.placement.order.map(cityLabel).join(' → ')}` : '—';
  const o = world.cities.get(state.selected);
  const c = o ? world.chunks.get(o.originChunkId) : null;
  $('#cityInfo').textContent = o ? `${o.cityId} · origin ${o.originChunkId} · cell (${o.worldCoordinate.gx}, ${o.worldCoordinate.gy}) · world (${o.worldPosition.x}, ${o.worldPosition.z}) m · citySeed ${o.citySeed} · ${o.generationStatus} · generation ${o.growthGeneration}` : '—';
  $('#placementInfo').textContent = o ? `${o.placementReason.text} · ${o.placementReason.screened} screened, ${o.placementReason.probed} probed, ${o.placementReason.rejected} rejected · ${o.placementReason.hypothesis}` : '—';
  $('#chunkInfo').textContent = c ? `terrain seed ${c.terrainSeed} · ${c.terrainType} · variation ${c.generationParameters.variation} · urbanSeed ${c.generationParameters.urbanSeed} · ${c.generationParameters.idMode} · ${c.generationParameters.terrainMode}${c.outputs ? ` · ${c.outputs.counts.roadKm} km roads, ${c.outputs.counts.blocks} blocks, ${c.outputs.counts.parcels} parcels, ${c.outputs.counts.buildings} buildings · resolved DNA ${c.outputs.resolvedDNA} (fit ${c.outputs.fitScore})` : ''}` : '—';
  $('#dnaInfo').textContent = o ? `Morphology: ${Object.entries(o.morphologyDNA).map(([k, v]) => `${k} ${v}`).join(' · ')} | Growth (A): rate ${o.growthDNA.rate}, water ${o.growthDNA.waterDependency}, axis ${o.growthDNA.directionPreference ?? 'none'}, compactness ${o.growthDNA.compactness}` : '—';
  const f = o ? world.frontierOf(o.cityId) : [];
  void f;
  const stats = growth.cityStats();
  $('#growthInfo').innerHTML = CITY_IDS.map(id => { const s = stats[id]; const reasons = Object.entries(s.rejectionReasons).map(([k, v]) => `${k} ×${v}`).join('; '); return `<b>${cityLabel(id)}</b> (${GROWTH_DNA[id].direction}, rate ${GROWTH_DNA[id].rate}): ${s.chunks} chunks, grown ${s.grown}, ${s.eligible} eligible / ${s.rejected} rejected, best ${s.best.toFixed(3)}, idle ${s.stepsSinceLastGrowth} steps${reasons ? ` — ${reasons}` : ''}`; }).join('<br>');
  const sc = state.selectedChunk ? world.chunks.get(state.selectedChunk) : null;
  $('#growthChunkInfo').textContent = sc ? `${sc.chunkId} · ${sc.cityId} · ${sc.role} · parent ${sc.parentChunkId ?? '— (core)'} · core ${sc.coreChunkId} · generation ${sc.generation} · step ${sc.growthStep} · terrain seed ${sc.terrainSeed} (${sc.terrainType}) · ${sc.generationStatus}${sc.growthReason ? ` · ${sc.growthReason.groups ? `suitability: ${Object.entries(sc.growthReason.groups).map(([k, v]) => `${k} ${v}`).join(', ')} · ` : ''}${sc.growthReason.text}${sc.growthReason.unavailable?.length ? ` · unavailable: ${sc.growthReason.unavailable.join('; ')}` : ''}` : ''}${sc.outputs ? ` · ${sc.outputs.counts.roadKm} km roads, ${sc.outputs.counts.buildings} buildings` : ''}` : 'click a chunk';
  const d = territory?.derived;
  const tt = d?.territories.find(x => x.cityId === state.selected);
  const fmt = o => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ');
  $('#territoryInfo').textContent = tt ? `${tt.cityId}: ${tt.chunkCount} chunks (${tt.viableChunks} with buildings) · chunk coverage ${tt.territoryArea.chunkCoverageKm2} km², built footprint ${tt.territoryArea.builtFootprintKm2} km², parcels ${tt.territoryArea.parcelKm2} km², water inside ${tt.territoryArea.waterInsideKm2} km² · max generation ${tt.maxGeneration} · ${tt.activeFrontiers.length} active / ${tt.blockedFrontiers.length} blocked frontiers${tt.stopReason ? ` · STOPPED: ${tt.stopReason}` : ''} · neighbours: ${tt.neighboringCities.join(', ') || 'none'} · external boundary ${(tt.boundaryLengthM.external / 1000).toFixed(1)} km (${fmt(tt.boundaryLengthM.byType)})` : '—';
  $('#worldTerritoryInfo').textContent = d ? `step ${d.metrics.step} · ${d.metrics.totalChunks} chunks · urbanised: coverage ${d.metrics.urbanized.chunkCoverageKm2} km², built footprint ${d.metrics.urbanized.builtFootprintKm2} km² · cells: ${fmt(d.metrics.cells)} · evaluated non-urban ${d.metrics.evaluatedNonUrbanKm2} km² · ecological ${d.metrics.ecologicalConstraintKm2} km² · inter-city shared edges ${d.metrics.interCityAdjacencies.sharedEdges} (${d.metrics.interCityAdjacencies.cityPairs} pairs, ${d.metrics.interCityAdjacencies.cornerContactPairs} corner contacts)${state.territoryRestore ? ` · load: ${state.territoryRestore}` : ''}` : '—';
  $('#relationInfo').innerHTML = d ? d.relationships.filter(r => r.relation === 'directAdjacency' || r.cornerContact || r.nearest.gapCells <= 3).map(r => `${cityLabel(r.cities[0])}–${cityLabel(r.cities[1])}: <b>${r.relation}</b>${r.cornerContact ? ' (corner contact)' : ''}, ${(r.nearest.centreDistanceM / 1000).toFixed(1)} km, gap ${r.nearest.gapCells} · barrier: ${r.environmentalBarrier} · connection: ${r.verifiedConnection}`).join('<br>') || 'no pair within 3 cells' : '—';
  const me = world.growth.history.filter(e => e.mode === 'g02b-road-first').at(-1);
  const mc = state.morphConnectivity?.[me?.cityId];
  $('#morphInfo').textContent = state.morphFailure ? `FAILED (${state.morphFailure.cityId}, step ${state.morphFailure.step}): ${state.morphFailure.reason} — ${state.morphFailure.fronts.map(f => `${f.growthFrontId.split(':').slice(1).join(' ')}: ${f.reason}`).join('; ')}` : me ? `${me.growthEventId}: ${me.sourceGrowthFrontId} → ${me.targetChunkId} · ${me.connections.length} roads joined (max position error ${Math.max(0, ...me.connections.map(c => c.positionErrorM))} m, max height step ${Math.max(0, ...me.connections.map(c => Math.abs(c.elevationStepM)))} m) · ${me.localAdaptations.unmatchedEntries.length} unmatched entries · ${me.generatedBlockIds.length} blocks, ${me.generatedParcelIds.length} / ${me.parcelsTotal} parcels on inherited roads · rejected: ${me.rejectedConstraints.map(r => r.growthFrontId.split(':').slice(1).join(' ')).join(', ') || 'none'}${mc ? ` · road graph: ${mc.components} component(s), ${Math.round(mc.mainComponentShare * 100)} % connected to the core` : ''}${state.morphRestore ? ` · load: ${state.morphRestore}` : ''}` : 'no G02b growth yet';
  const re = world.growth.history.filter(e => e.scheduler === 'g02c-01').at(-1);
  const attempts = world.growth.roadAttempts ?? [];
  const ramps = world.growth.history.flatMap(e => e.ramps ?? []);
  const rampText = world.growth.gradeProfile ? ` · ramps (${world.growth.gradeProfile}): ${ramps.filter(r => r.status === 'accepted').length} accepted, ${ramps.filter(r => r.status === 'flush').length} flush, ${ramps.filter(r => !['accepted', 'flush'].includes(r.status)).length} unconnected` : '';
  $('#roadInfo').textContent = growth.growthMode !== 'road' ? 'chunk frontier (G02); choose real road fronts and Generate' : rampText + ' · ' + (re ? `${re.growthReason.text} · ${re.connections.length} parent + ${re.neighbourConnections.length} neighbour joins, ${re.localAdaptations.unmatchedEntries.length} unmatched · ${attempts.length} failed attempt(s) so far${world.growth.stalled ? ` · STALLED: ${world.growth.stalled.reason}` : ''}` : `no road-driven step yet${world.growth.stalled ? ` · STALLED: ${world.growth.stalled.reason}` : ''}`);
  const segs = world.growth.encounters ?? [];
  $('#emergentInfo').textContent = world.growth.encounters ? (segs.map(s => `${s.encounterId} (${s.origin === 'placement' ? 'near at placement' : `emerged step ${s.firstStep}`}): ${Object.entries(s.states).filter(([, v]) => v).map(([k]) => k).join(' + ')} · ${s.relationshipStatus} · ${s.validationStatus}`).join(' | ') || 'no encounter yet') : 'detection off (Natural encounters folder, then Generate)';
  const encs = world.fixture ? state.encounters ?? [] : [];
  $('#encounterInfo').textContent = world.fixture ? `TEST FIXTURE ${world.fixture} (cores placed by hand) · ` + (encs.map(e => `${e.encounterId}: ${e.currentRelationship} · states ${Object.entries(e.states).filter(([, v]) => v).map(([k]) => k).join(', ')} · ${e.validationStatus} · ${e.decisionReason}`).join(' | ') || 'no encounter (cities more than 3 cells apart)') + ` · decisions: ${(world.growth.encounterDecisions ?? []).map(d => `${d.newcomer}→${d.targetCell.gx},${d.targetCell.gy}: ${d.outcome} (${d.acceptedInterfaces.length} accepted / ${d.rejectedInterfaces.length} rejected)`).join('; ') || 'none'}` : 'no fixture loaded (Urban encounter folder)';
  const last = state.growthTiming.at(-1);
  $('#growthTimeInfo').textContent = state.growthTiming.length ? `${state.growthTiming.length} steps · last step ${last.totalMs} ms (evaluate ${last.evaluateMs}, generate ${last.generateMs}, render ${last.renderMs}) · heap ${last.heapMB ?? 'n/a'} MB` : '—';
  $('#timeInfo').textContent = t ? `placement ${t.placementMs} ms (${t.probes} terrain probes) · first city rendered ${t.firstRenderMs ?? '—'} ms · six chunks ${t.chunks.reduce((s, x) => s + x.dataMs, 0)} ms data + ${t.chunks.reduce((s, x) => s + x.renderMs, 0)} ms render · total ${t.totalMs} ms · heap ${t.memoryMB ?? 'n/a'} MB` : '—';
}

// Click a city to inspect it.
const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([...views.values()].map(v => v.chunk.terrain), false)[0];
  if (hit) { state.selected = hit.object.userData.cityId; state.selectedChunk = hit.object.userData.chunkId; ui.city = state.selected; gui.controllersRecursive().forEach(x => x.updateDisplay()); refreshOverlays(); renderPanel(); }
});

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
renderer.setAnimationLoop(() => { resize(); controls.update(); renderer.render(scene, camera); });

// Lab hooks for the verifier (scripts/verify-city-of-cities.mjs).
window.__originLab = {
  ready: false,
  state: () => world.serialise(),
  origins: () => [...world.cities.values()],
  chunks: () => [...world.chunks.values()],
  timing: () => state.timing,
  builds: () => Object.fromEntries(state.builds),
  mismatches: () => state.mismatches,
  error: () => state.error,
  generate: seed => { if (seed) ui.worldSeed = seed; return generate(); },
  regenerate: () => generate('REGENERATING (SAME SEED)'),
  reset, saveLocal, loadLocal, load,
  setLayers: layers => { Object.assign(ui, layers); applyVisibility(); },
  setVisible: (cityId, on) => { ui.visible[cityId] = on; applyVisibility(); },
  select: cityId => { state.selected = cityId; ui.city = cityId; refreshOverlays(); renderPanel(); },
  fitCandidates: cityId => fitCandidates(cityId),
  overview: mode => fitOverview(mode),
  focus: cityId => focusCity(cityId),
  sceneChunkCount: () => views.size,
  fitRegion: (gx0, gy0, gx1, gy1) => { resize(); const cx = ((gx0 + gx1) / 2) * CHUNK_SIZE; const cz = ((gy0 + gy1) / 2) * CHUNK_SIZE; const ex = (gx1 - gx0 + 1) * CHUNK_SIZE; const ez = (gy1 - gy0 + 1) * CHUNK_SIZE; const fit = (Math.max(ez, ex / camera.aspect) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05; controls.target.set(cx, 0, cz); camera.position.set(cx, fit, cz + 1); camera.far = fit * 6; camera.updateProjectionMatrix(); controls.update(); },
  setAutoFit: on => { ui.autoFit = on; },
  // G02
  growSteps, resetToOrigins,
  // G02c-01
  roadCities: cities => { growth = new WorldGrowthController(world, controllerOptions({ growthMode: 'road', cities })); },
  roadReplay: replay => { growth = new WorldGrowthController(world, controllerOptions({ growthMode: 'road', replay })); },
  rampEvents: () => world.growth.history.filter(e => e.ramps),
  emergentEncounters: () => world.growth.encounters ?? [],
  interCityConnections: () => world.growth.interCityConnections ?? [],
  roadReach: cityId => cityRoadReach(world, cityId),
  morphGrow: cityId => growMorph(cityId),
  morphFronts: cityId => morph.fronts(cityId),
  morphConnectivity: cityId => morph.connectivity(cityId),
  morphFailure: () => state.morphFailure ?? null,
  morphRestore: () => state.morphRestore ?? null,
  // G03b
  fixture: (name, upTo = Infinity) => runFixture(name, upTo),
  continueFixture: () => runFixture(world.fixture, Infinity, false),
  encounters: () => state.encounters ?? [],
  encounterDecisions: () => world.growth.encounterDecisions ?? [],
  encounterPaths: () => state.encounterPaths ?? {},
  verifyConnections: () => verifyConnections(world),
  territorySnapshot: () => territory?.snapshot() ?? null,
  territoryRestore: () => state.territoryRestore ?? null,
  focusPoint: (x, z, d) => { controls.target.set(x, 20, z); camera.position.set(x + d * 0.55, d * 0.8, z + d * 0.75); camera.far = 60000; camera.updateProjectionMatrix(); controls.update(); },
  history: () => world.growth.history,
  cityStats: () => growth.cityStats(),
  frontier: () => growth.lastFrontier,
  growthTiming: () => state.growthTiming,
  selectChunk: id => { state.selectedChunk = id; renderPanel(); },
  focusChunk: id => { const c = world.chunks.get(id); controls.target.set(c.worldOrigin.x, 20, c.worldOrigin.z); camera.position.set(c.worldOrigin.x + 520, 760, c.worldOrigin.z + 980); camera.far = 30000; camera.updateProjectionMatrix(); controls.update(); },
  memoryMB: () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null),
};

fitOverview();
renderPanel();
if (query.has('fixture')) runFixture(query.get('fixture'), query.has('upTo') ? Number(query.get('upTo')) : Infinity);
else if (query.get('start') === '0') { $('#statusText').textContent = 'READY · NO WORLD'; window.__originLab.ready = true; } else {
  generate();
  if (Number(query.get('steps')) > 0) growSteps(Number(query.get('steps')));
}
