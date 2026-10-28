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

// A City of Cities — G01 Multi-Origin Initialization. Six city origins placed by the world seed and an origin
// suitability evaluation; each core chunk runs the unchanged single-chunk chain. No growth: no chunk other than the
// six cores is ever created. URL: ?worldSeed=… &candidates=1 &debug=1 &frontier=1 &focus=<cityId> &start=0
const query = new URLSearchParams(location.search);
const STORAGE_KEY = 'procedural-mini-world/a-city-of-cities/g01/v1';

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

const paramsFromQuery = Object.fromEntries(Object.keys(PARAMS).filter(k => query.has(k)).map(k => [k, Number(query.get(k))]));
const ui = { ...normaliseParams({ ...DEFAULT_PARAMS, ...paramsFromQuery }), city: query.get('focus') ?? 'manhattanGrid', candidates: query.get('candidates') === '1', debug: query.get('debug') === '1', frontier: query.get('frontier') === '1', ownership: true, seams: false, visible: Object.fromEntries(CITY_IDS.map(id => [id, true])) };
let world = new WorldContext(ui);
const growthView = new GrowthView(scene); // ownership frames + frontier outlines (render only, reused)
growthView.setVisible({ ownership: true, frontier: ui.frontier, seams: false });
const originView = new OriginView(scene);
const views = new Map(); // chunkId → { chunk, network, buildings, label }
const state = { busy: false, error: null, timing: null, builds: new Map(), mismatches: [], selected: ui.city };
const $ = id => document.querySelector(id);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

const disposeRoot = root => { root.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); root.removeFromParent(); };
function clearScene() {
  for (const v of views.values()) { disposeRoot(v.chunk.root); disposeRoot(v.network.root); disposeRoot(v.buildings.root); disposeRoot(v.label); }
  views.clear(); growthView.clear(); originView.clear();
}

function renderChunk(chunk, layers) {
  const { terrain, city } = layers;
  const v = { chunk: new ChunkView(scene), network: new NetworkView(scene), buildings: new BuildingView(scene), label: null };
  v.chunk.update(terrain.fields, terrain.config, 'classes', terrain.analysis, null, null);
  v.chunk.terrain.userData.cityId = chunk.cityId;
  v.network.update(city.network, createSampler(terrain.fields).height);
  v.network.markers.visible = false; // port / portal points are screen-sized; unreadable at world scale
  v.buildings.update(city.buildings);
  v.label = textSprite([`${cityLabel(chunk.cityId)} · ${chunk.chunkId}`, `${chunk.terrainType} · terrain seed ${chunk.terrainSeed}`]);
  v.label.position.set(chunk.worldOrigin.x, terrain.fields.stats.maxHeight + 160, chunk.worldOrigin.z);
  scene.add(v.label);
  views.set(chunk.chunkId, v);
  growthView.addOwnership({ chunkId: chunk.chunkId, cityId: chunk.cityId, worldOrigin: chunk.worldOrigin, parentChunkId: null }, terrain.fields.stats);
  state.builds.set(chunk.chunkId, (state.builds.get(chunk.chunkId) ?? 0) + 1);
  applyVisibility();
}

function applyVisibility() {
  for (const [chunkId, v] of views) {
    const on = ui.visible[world.chunks.get(chunkId).cityId];
    v.chunk.root.visible = on; v.network.root.visible = on; v.buildings.root.visible = on; v.label.visible = on;
  }
  originView.setVisible(ui);
  growthView.setVisible({ ownership: ui.ownership, frontier: ui.frontier, seams: false });
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
    if (!state.error) $('#statusText').textContent = `READY · ${world.cities.size} CITY ORIGINS · GENERATION 0`;
    window.__originLab.ready = true;
  });
  return queue;
}

async function buildChunks(compare) {
  const timing = state.timing;
  for (const chunkId of [...world.chunks.keys()].sort()) {
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
    state.timing = { started: performance.now(), placementMs: 0, probes: 0, chunks: [], firstRenderMs: null, totalMs: 0, memoryMB: null };
    const it = world.initialiseSteps();
    for (let r = it.next(); !r.done; r = it.next()) { $('#statusText').textContent = `EVALUATING ORIGIN SITES · ${cityLabel(r.value.cityId).toUpperCase()} ${r.value.probed} / ${r.value.of}`; await nextFrame(); }
    state.timing.placementMs = Math.round(performance.now() - state.timing.started); state.timing.probes = world.stats.probes;
    fitOverview();
    await buildChunks(false);
    fitOverview();
  });
}
const reset = () => run('RESET', async () => { clearScene(); world = new WorldContext(ui); state.timing = null; state.builds.clear(); });
function load(saved) {
  return run('LOADING WORLD STATE', async () => {
    clearScene(); state.builds.clear(); state.mismatches = [];
    world = WorldContext.restore(saved);
    Object.assign(ui, world.params);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    state.timing = { started: performance.now(), placementMs: 0, probes: 0, chunks: [], firstRenderMs: null, totalMs: 0, memoryMB: null };
    await buildChunks(true);
    fitOverview();
  });
}
const saveLocal = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(world.serialise())); $('#saveState').textContent = `saved: seed ${world.worldSeed}, ${world.cities.size} origins (browser storage)`; };
const loadLocal = () => { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) { $('#saveState').textContent = 'nothing saved'; return queue; } return load(JSON.parse(raw)); };

// ---------- UI ----------
const gui = new GUI({ title: 'City Origins (G01)', container: $('#gui') });
gui.add(ui, 'worldSeed', PARAMS.worldSeed.min, PARAMS.worldSeed.max, 1).name('World seed');
gui.add({ f: () => generate() }, 'f').name('Generate world origins');
gui.add({ f: () => generate('REGENERATING (SAME SEED)') }, 'f').name('Regenerate');
gui.add({ f: reset }, 'f').name('Reset');
gui.add({ f: saveLocal }, 'f').name('Save world state');
gui.add({ f: loadLocal }, 'f').name('Load world state');
gui.add({ f: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(world.serialise(), null, 2)], { type: 'application/json' })); a.download = `city-of-cities-${world.worldSeed}-g01.json`; a.click(); } }, 'f').name('Export state (JSON)');
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
gui.add(ui, 'ownership').name('Show city frames').onChange(applyVisibility);
const vis = gui.addFolder('City visibility (no regeneration)');
for (const id of CITY_IDS) vis.add(ui.visible, id).name(cityLabel(id)).onChange(applyVisibility);
vis.close();
const rules = gui.addFolder('Placement rules (apply on Generate)');
for (const key of Object.keys(PARAMS).filter(k => k !== 'worldSeed')) rules.add(ui, key, PARAMS[key].min, PARAMS[key].max, PARAMS[key].step).name(key);
rules.close();

function renderPanel() {
  const t = state.timing;
  $('#worldInfo').textContent = world.cities.size ? `seed ${world.worldSeed} · ${world.cities.size} origins · ${world.chunks.size} chunks (cores only) · growth generation ${world.growth.generation} · min distance ${world.params.minOriginDistance}, search radius ${world.params.searchRadius}, k ${world.params.selectionSharpness}${world.placement?.failures?.length ? ` · FAILURES: ${world.placement.failures.map(f => `${f.cityId}: ${f.reason}`).join('; ')}` : ''}` : 'no world (Generate world origins)';
  $('#orderInfo').textContent = world.placement ? `claim order (fewest qualified sites first, ties by seeded hash): ${world.placement.order.map(cityLabel).join(' → ')}` : '—';
  const o = world.cities.get(state.selected);
  const c = o ? world.chunks.get(o.originChunkId) : null;
  $('#cityInfo').textContent = o ? `${o.cityId} · origin ${o.originChunkId} · cell (${o.worldCoordinate.gx}, ${o.worldCoordinate.gy}) · world (${o.worldPosition.x}, ${o.worldPosition.z}) m · citySeed ${o.citySeed} · ${o.generationStatus} · generation ${o.growthGeneration}` : '—';
  $('#placementInfo').textContent = o ? `${o.placementReason.text} · ${o.placementReason.screened} screened, ${o.placementReason.probed} probed, ${o.placementReason.rejected} rejected · ${o.placementReason.hypothesis}` : '—';
  $('#chunkInfo').textContent = c ? `terrain seed ${c.terrainSeed} · ${c.terrainType} · variation ${c.generationParameters.variation} · urbanSeed ${c.generationParameters.urbanSeed} · ${c.generationParameters.idMode} · ${c.generationParameters.terrainMode}${c.outputs ? ` · ${c.outputs.counts.roadKm} km roads, ${c.outputs.counts.blocks} blocks, ${c.outputs.counts.parcels} parcels, ${c.outputs.counts.buildings} buildings · resolved DNA ${c.outputs.resolvedDNA} (fit ${c.outputs.fitScore})` : ''}` : '—';
  $('#dnaInfo').textContent = o ? `Morphology: ${Object.entries(o.morphologyDNA).map(([k, v]) => `${k} ${v}`).join(' · ')} | Growth (A): rate ${o.growthDNA.rate}, water ${o.growthDNA.waterDependency}, axis ${o.growthDNA.directionPreference ?? 'none'}, compactness ${o.growthDNA.compactness}` : '—';
  const f = o ? world.frontierOf(o.cityId) : [];
  $('#growthInfo').textContent = o ? `not implemented (G02). Potential directions: ${f.map(x => `${x.direction} ${x.landform} (${x.compatibility})`).join(' · ')} · dependencies: placement may affect ${world.dependenciesOf(o.cityId).placementMayAffect.map(cityLabel).join(', ') || 'none'}` : '—';
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
  if (hit) { state.selected = hit.object.userData.cityId; ui.city = state.selected; gui.controllersRecursive().forEach(x => x.updateDisplay()); refreshOverlays(); renderPanel(); }
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
};

fitOverview();
renderPanel();
if (query.get('start') === '0') { $('#statusText').textContent = 'READY · NO WORLD'; window.__originLab.ready = true; } else generate();
