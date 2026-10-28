import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChunkView } from '../seed-terrain/ChunkView.js';
import { NetworkView } from '../seed-terrain/NetworkView.js';
import { BuildingView } from '../seed-terrain/BuildingView.js';
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { CITY_DNA } from '../seed-terrain/cityMatchRules.js';
import { generateUrbanLayer } from '../world-grid/WorldGrid.js';
import { WorldGrowthController, networkOf, terrainOf } from './WorldGrowthController.js';
import { CHUNK_SIZE, CITY_GROWTH, CITY_ORDER, DEFAULT_PARAMS, PARAMS, cellOf, normaliseParams } from './growthConfig.js';
import { GrowthView } from './GrowthView.js';

// G01 Multi-Origin Procedural World Growth: six city cores, then one chunk per step from the growth frontier.
// Each chunk runs the unchanged single-chunk chain (terrain → City Match → network → blocks → parcels → buildings,
// 07.1a spatial ids). Overlays (ownership, frontier, seams) never replace the generated content.
// URL: ?worldSeed=…&steps=N (grow N steps after the cores) &target=N (grow to N chunks) &frontier=1 &seams=1
//      &ownership=0 &camera=top|axo &start=0 (no automatic cores) + any growth parameter (coreMinDistance, jitter, …)
const query = new URLSearchParams(location.search);
const STORAGE_KEY = 'procedural-mini-world/growing-world/v1';

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
const ui = { ...normaliseParams({ ...DEFAULT_PARAMS, ...paramsFromQuery }), steps: 5, target: Number(query.get('target')) || 24, ownership: query.get('ownership') !== '0', frontier: query.get('frontier') === '1', seams: query.get('seams') === '1', autoFit: true, view: query.get('camera') === 'top' ? 'top' : 'axo' };
let ctrl = new WorldGrowthController(ui);
const growthView = new GrowthView(scene);
const views = new Map(); // chunkId → { chunk, network, buildings, label }
const content = new Map(); // chunkId → compact record of the rendered content (signatures, counts, ms)
const state = { busy: false, cancel: false, selected: null, lastStep: null, totalMs: 0, steps: [], restoreMismatches: [] };
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const $ = id => document.querySelector(id);
const cityName = id => CITY_DNA[id].label.split(' — ')[0];

const textSprite = text => {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,16,20,0.78)'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#f4f1ea'; g.font = '600 30px system-ui, sans-serif'; g.fillText(text[0], 16, 40);
  g.fillStyle = '#9fd3c7'; g.font = '24px system-ui, sans-serif'; g.fillText(text[1], 16, 78);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.set(400, 75, 1);
  return sprite;
};

const disposeRoot = root => { root.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); root.removeFromParent(); };
function clearViews() {
  for (const v of views.values()) { disposeRoot(v.chunk.root); disposeRoot(v.network.root); disposeRoot(v.buildings.root); if (v.label) disposeRoot(v.label); }
  views.clear(); content.clear(); growthView.clear();
}

// Full content of one chunk from its cell + City ID (the same chain as 06.2 / 07.1a). Fields are released after
// rendering; only the meshes and a compact content record stay.
async function buildContent(result) {
  const { record } = result;
  const started = performance.now();
  let { transient } = result;
  if (!transient) { // restore path: regenerate from the cell (deterministic) and check against the saved record
    const cell = cellOf(ctrl.worldSeed, record.worldGridCoordinate.gx, record.worldGridCoordinate.gy);
    const terrain = terrainOf(cell);
    transient = { cell, terrain, net: networkOf(cell, record.cityId, terrain) };
    const now = { height: terrain.fields.stats.heightSignature, water: terrain.fields.stats.waterSignature, network: transient.net.network.signature };
    if (JSON.stringify(now) !== JSON.stringify(record.signatures)) state.restoreMismatches.push({ chunkId: record.chunkId, saved: record.signatures, now });
  }
  const { terrain, net } = transient;
  ctrl.setStatus(record.chunkId, 'city');
  const city = generateUrbanLayer(terrain, net, net.network, null, { worldSeed: ctrl.worldSeed });
  const dataMs = performance.now() - started;
  const t1 = performance.now();
  const v = { chunk: new ChunkView(scene), network: new NetworkView(scene), buildings: new BuildingView(scene), label: null };
  v.chunk.update(terrain.fields, terrain.config, 'classes', terrain.analysis, null, null);
  v.chunk.terrain.userData.chunkId = record.chunkId;
  v.network.update(city.network, createSampler(terrain.fields).height);
  v.network.markers.visible = false; // port / portal points are screen-sized (unreadable at world scale); ports are reported per shared edge
  v.buildings.update(city.buildings);
  v.label = textSprite([`${record.chunkId} · ${record.landform}`, `${cityName(record.cityId)} · #${record.generationIndex} · seed ${record.terrainSeed}`]);
  v.label.position.set(record.worldOrigin.x, terrain.fields.stats.maxHeight + 160, record.worldOrigin.z);
  scene.add(v.label);
  views.set(record.chunkId, v);
  growthView.addOwnership(record, terrain.fields.stats);
  ctrl.setStatus(record.chunkId, 'ready');
  content.set(record.chunkId, {
    chunkId: record.chunkId, cityId: record.cityId, resolvedDNA: city.cityMatch.selectedDNA.id,
    signatures: { height: terrain.fields.stats.heightSignature, network: city.network.signature, blocks: city.blocks.signature, parcels: city.parcels.signature, buildings: city.buildings.signature },
    counts: { roadKm: +(city.network.stats.roadLength / 1000).toFixed(2), blocks: city.blocks.stats.blocks, parcels: city.parcels.stats.parcels, buildings: city.buildings.stats.buildings },
    ms: { data: Math.round(dataMs), render: Math.round(performance.now() - t1) },
  });
  return content.get(record.chunkId);
}

function refreshOverlays() {
  const cells = new Map();
  for (const cityId of CITY_ORDER) for (const c of ctrl.frontier(cityId)) {
    if (!cells.has(c.key)) cells.set(c.key, { gx: c.gx, gy: c.gy, cities: [] });
    cells.get(c.key).cities.push(cityId);
  }
  state.frontier = [...cells.values()];
  growthView.updateFrontier(state.frontier);
  growthView.updateSeams([...ctrl.edges.values()], id => ctrl.byId(id));
  growthView.setVisible(ui);
}

function fitCamera(mode = ui.view) {
  ui.view = mode;
  resize(); // the aspect must be current before the fit
  const b = ctrl.summary().bounds ?? { minX: -2, maxX: 2, minY: -2, maxY: 2 };
  const cx = ((b.minX + b.maxX) / 2) * CHUNK_SIZE; const cz = ((b.minY + b.maxY) / 2) * CHUNK_SIZE;
  const ex = (b.maxX - b.minX + 1) * CHUNK_SIZE; const ez = (b.maxY - b.minY + 1) * CHUNK_SIZE;
  const extent = Math.max(ex, ez);
  // Distance at which the whole bounding box fits the vertical field of view and the canvas aspect.
  const fit = (Math.max(ez, ex / camera.aspect) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.08;
  controls.target.set(cx, 0, cz);
  if (mode === 'top') camera.position.set(cx, fit, cz + 1);
  else camera.position.set(cx + fit * 0.35, fit * 0.7, cz + fit * 0.75);
  camera.far = extent * 6; camera.updateProjectionMatrix();
  controls.update();
}

// ---------- Serial task queue (one task at a time; the UI stays responsive between chunks) ----------
let queue = Promise.resolve();
function run(label, task) {
  queue = queue.then(async () => {
    state.busy = true; state.cancel = false; window.__growthLab.ready = false;
    $('#statusText').textContent = label;
    await nextFrame();
    try { await task(); } catch (error) { console.error(error); $('#statusText').textContent = `ERROR: ${error.message}`; state.error = error.message; }
    refreshOverlays();
    if (ui.autoFit) fitCamera();
    state.busy = false;
    renderPanel();
    if (!state.error) $('#statusText').textContent = `READY · ${ctrl.chunks.size} CHUNKS · STEP ${ctrl.step}`;
    window.__growthLab.ready = true;
  });
  return queue;
}

async function placeAndRender(result, label) {
  const t0 = performance.now();
  const c = await buildContent(result);
  // placement (terrain + network, controller) + content (urban layer + render, page)
  const placementMs = ctrl.history.at(-1).ms;
  state.lastStep = { chunkId: result.record.chunkId, label, placementMs, contentMs: c.ms.data + c.ms.render, totalMs: Math.round(performance.now() - t0) + placementMs };
  state.steps.push(state.lastStep);
  state.totalMs += state.lastStep.totalMs;
  state.selected = result.record.chunkId;
  if (ui.autoFit) fitCamera();
  renderPanel();
  await nextFrame();
}

function generateCores() {
  return run('GENERATING SIX CITY CORES', async () => {
    clearViews();
    ctrl = new WorldGrowthController(ui);
    state.steps = []; state.totalMs = 0; state.restoreMismatches = []; state.error = null;
    let i = 0;
    for (const result of ctrl.coreSteps()) {
      i += 1;
      $('#statusText').textContent = `CORE ${i} / 6 · ${cityName(result.record.cityId).toUpperCase()}`;
      await placeAndRender(result, 'core');
    }
  });
}

async function growLoop(more, label) {
  if (!ctrl.cores.length) throw new Error('Generate the six city cores first');
  let i = 0;
  while (more(i) && !state.cancel) {
    $('#statusText').textContent = `${label(i)} · ${ctrl.chunks.size} CHUNKS`;
    await nextFrame();
    const result = ctrl.growStep();
    if (result.stalled) { $('#statusText').textContent = 'STALLED: no legal frontier cell'; break; }
    await placeAndRender(result, 'growth');
    i += 1;
  }
}
const growOne = () => run('GROWING ONE STEP', () => growLoop(i => i < 1, () => 'GROWING 1 / 1'));
const growMany = n => run(`GROWING ${n} STEPS`, () => growLoop(i => i < n, i => `GROWING ${i + 1} / ${n}`));
const growTo = n => run(`GROWING TO ${n} CHUNKS`, () => growLoop(() => ctrl.chunks.size < n, () => `GROWING TO ${n}`));
const reset = () => run('RESET', async () => { clearViews(); ctrl = new WorldGrowthController(ui); state.steps = []; state.totalMs = 0; state.selected = null; state.error = null; });
function load(saved) {
  return run('LOADING GROWTH STATE', async () => {
    clearViews();
    ctrl = WorldGrowthController.restore(saved);
    Object.assign(ui, ctrl.params);
    gui.controllersRecursive().forEach(c => c.updateDisplay());
    state.steps = []; state.totalMs = 0; state.restoreMismatches = []; state.error = null;
    const records = [...ctrl.chunks.values()].sort((a, b) => a.generationIndex - b.generationIndex);
    for (const [i, record] of records.entries()) {
      $('#statusText').textContent = `RESTORING ${i + 1} / ${records.length} · ${record.chunkId}`;
      await nextFrame();
      await buildContent({ record });
    }
  });
}

// ---------- UI ----------
const gui = new GUI({ title: 'Growth Debug (G01)', container: $('#gui') });
gui.add(ui, 'worldSeed', PARAMS.worldSeed.min, PARAMS.worldSeed.max, 1).name('World seed');
gui.add({ f: generateCores }, 'f').name('Generate six city cores');
gui.add({ f: growOne }, 'f').name('Grow one step');
gui.add(ui, 'steps', 1, 50, 1).name('Steps');
gui.add({ f: () => growMany(ui.steps) }, 'f').name('Grow multiple steps');
gui.add(ui, 'target', 6, 200, 1).name('Target chunk count');
gui.add({ f: () => growTo(ui.target) }, 'f').name('Grow to target');
gui.add({ f: () => { state.cancel = true; } }, 'f').name('Stop after current chunk');
gui.add({ f: reset }, 'f').name('Reset world');
gui.add({ f: () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(ctrl.serialise())); $('#saveState').textContent = `saved step ${ctrl.step}, ${ctrl.chunks.size} chunks (browser storage)`; } }, 'f').name('Save growth state');
gui.add({ f: () => { const raw = localStorage.getItem(STORAGE_KEY); if (raw) load(JSON.parse(raw)); else $('#saveState').textContent = 'nothing saved'; } }, 'f').name('Load growth state');
gui.add({ f: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(ctrl.serialise())], { type: 'application/json' })); a.download = `growth-${ctrl.worldSeed}-step${ctrl.step}.json`; a.click(); } }, 'f').name('Export state (JSON)');
const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
fileInput.addEventListener('change', async () => { const file = fileInput.files[0]; if (file) load(JSON.parse(await file.text())); fileInput.value = ''; });
gui.add({ f: () => fileInput.click() }, 'f').name('Import state (JSON)');
gui.add(ui, 'frontier').name('Show growth frontier').onChange(() => growthView.setVisible(ui));
gui.add(ui, 'ownership').name('Show city ownership').onChange(() => growthView.setVisible(ui));
gui.add(ui, 'seams').name('Show seam conflicts').onChange(() => growthView.setVisible(ui));
gui.add(ui, 'autoFit').name('Auto-fit view');
gui.add({ f: () => fitCamera('top') }, 'f').name('Top view');
gui.add({ f: () => fitCamera('axo') }, 'f').name('Oblique view');
const rules = gui.addFolder('Growth rules (apply on Generate cores)');
for (const key of Object.keys(PARAMS).filter(k => k !== 'worldSeed')) rules.add(ui, key, PARAMS[key].min, PARAMS[key].max, PARAMS[key].step).name(key);
rules.close();

function renderPanel() {
  const s = ctrl.summary();
  $('#worldInfo').textContent = `seed ${s.worldSeed} · step ${s.step} · ${s.chunks} chunks${s.bounds ? ` · grid x ${s.bounds.minX}…${s.bounds.maxX}, y ${s.bounds.minY}…${s.bounds.maxY}` : ''}`;
  $('#cityInfo').innerHTML = CITY_ORDER.map(id => `<span style="color:#${CITY_GROWTH[id].color.toString(16).padStart(6, '0')}">■</span> ${cityName(id)} ${s.perCity[id]}`).join(' · ');
  $('#edgeInfo').textContent = s.edges.total ? `${s.edges.total} shared edges · same city ${s.edges.identity.sameCity ?? 0}, city boundary ${s.edges.identity.cityBoundary ?? 0} · geometry ${Object.entries(s.edges.geometry).map(([k, v]) => `${k} ${v}`).join(', ')} · water ${Object.entries(s.edges.hydrology).map(([k, v]) => `${k} ${v}`).join(', ')} · unpaired ports ${s.edges.unpairedPorts}` : '—';
  const r = state.selected ? ctrl.byId(state.selected) : null;
  $('#chunkInfo').textContent = r ? `${r.chunkId} · ${cityName(r.cityId)} (origin ${cityName(r.originCityId)}, core ${r.coreChunkId}) · parent ${r.parentChunkId ?? '— (core)'} · #${r.generationIndex} step ${r.growthStep} · ${r.landform}, seed ${r.terrainSeed}, variation ${r.variation} · fit ${r.suitability.fitScore}${r.suitability.conflicts.length ? ` · conflicts ${r.suitability.conflicts.join(', ')}` : ''} · ${r.generationStatus}` : '—';
  $('#reasonInfo').textContent = r ? r.growthReason.text : '—';
  const c = r ? content.get(r.chunkId) : null;
  $('#contentInfo').textContent = c ? `${c.counts.roadKm} km roads · ${c.counts.blocks} blocks · ${c.counts.parcels} parcels · ${c.counts.buildings} buildings · data ${c.ms.data} ms, render ${c.ms.render} ms` : '—';
  const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB heap` : 'heap n/a';
  $('#timeInfo').textContent = `last chunk ${state.lastStep?.totalMs ?? 0} ms · total ${(state.totalMs / 1000).toFixed(1)} s · ${mem} · probes ${ctrl.stats.probes}`;
  $('#issueInfo').innerHTML = ctrl.issues.slice(-6).map(i => `<li>${i.type === 'suitability' ? `${i.chunkId} ${cityName(i.cityId)} on ${i.landform}: fit ${i.fitScore}${i.conflicts.length ? `, ${i.conflicts.join(', ')}` : ''} (${i.core ? 'core' : 'inherited'}, kept)` : `${i.type}: ${i.reason}`}</li>`).join('') || '<li>none</li>';
}

// Click a chunk to inspect it.
const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([...views.values()].map(v => v.chunk.terrain), false)[0];
  if (hit) { state.selected = hit.object.userData.chunkId; renderPanel(); }
});

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
}
renderer.setAnimationLoop(() => { resize(); controls.update(); renderer.render(scene, camera); });

// Lab hooks for the verifier (scripts/verify-growing-world.mjs).
window.__growthLab = {
  ready: false,
  summary: () => ctrl.summary(),
  records: () => ctrl.serialise().chunks,
  edges: () => [...ctrl.edges.values()],
  issues: () => ctrl.issues,
  content: () => [...content.values()],
  serialise: () => ctrl.serialise(),
  steps: () => state.steps,
  restoreMismatches: () => state.restoreMismatches,
  frontier: () => state.frontier ?? [],
  memoryMB: () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null),
  error: () => state.error ?? null,
  generateCores, growOne, growMany, growTo, reset, load,
  setLayers: layers => { Object.assign(ui, layers); growthView.setVisible(ui); gui.controllersRecursive().forEach(c => c.updateDisplay()); },
  camera: mode => fitCamera(mode),
  focus: (x, z, d) => { ui.autoFit = false; controls.target.set(x, 0, z); camera.position.set(x + d * 0.5, d * 0.65, z + d * 0.8); controls.update(); },
};

fitCamera();
renderPanel();
if (query.get('start') === '0') { $('#statusText').textContent = 'READY · NO WORLD'; window.__growthLab.ready = true; } else {
  generateCores();
  const steps = Number(query.get('steps'));
  if (steps > 0) growMany(steps);
  else if (query.has('target')) growTo(ui.target);
}
