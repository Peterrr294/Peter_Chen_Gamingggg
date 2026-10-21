import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChunkView } from '../seed-terrain/ChunkView.js';
import { NetworkView } from '../seed-terrain/NetworkView.js';
import { BuildingView } from '../seed-terrain/BuildingView.js';
import { createSampler, findCrossings } from '../seed-terrain/NetworkGenerator.js';
import { CITY_DNA } from '../seed-terrain/cityMatchRules.js';
import { createWorldConfig, restoreWorld, serialiseWorld, WORLD } from './worldConfig.js';
import { WorldGrid, generateTerrainLayer } from './WorldGrid.js';
import { classifySeams, transectFeasibility } from './SeamClassifier.js';
import { compareCheckpoint, createCheckpoint, readCheckpoint } from './worldCheckpoint.js';
import defaultCheckpointUrl from './checkpoints/world-6201-checkpoint-v1.json?url';
import { matchCity } from '../seed-terrain/CityMatcher.js';
import { checkSeams } from './SeamCheck.js';
import { SeamView } from './SeamView.js';
import { chunkAnchor, stitchRoads, worldPath } from './RoadSeam.js';
import { slopeField } from './TerrainHarmonizer.js';

// 06.2 World Grid: 3 × 3 fixed chunks in one world frame, each running the unchanged single-chunk chain.
// 06.3a: shared edges harmonised (TerrainHarmonizer); ?terrain=raw shows the independent 06.2 chunks.
// 06.3a-R: macro-ramp terrain (WorldTerrain, ?terrain=macroRamp); ?terrain=harmonized shows the 06.3a edge-local joins.
// 06.3a-R2: world datum + band-only seam correction with preserved cores (TerrainCoordinator, default).
// 06.3b: road ports joined across harmonised edges (RoadSeam); ?roads=independent shows each chunk's own network.
// URL: ?worldSeed=…&transitionWidth=…&terrain=raw&roads=independent&seams=1&camera=top&focus=x,z,d&select=chunk_0_0&checkpoint=default
const query = new URLSearchParams(location.search);
const STORAGE_KEY = 'procedural-mini-world/world-grid/v1';

const canvas = document.querySelector('#worldCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x081014);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 5, 20000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xcde7ef, 0x17231d, 2.2));
const sun = new THREE.DirectionalLight(0xffefd2, 3);
sun.position.set(-2000, 3200, 1600);
scene.add(sun);

// ?focus=x,z,distance: oblique close-up of one point (seam debug captures).
const focus = (query.get('focus') ?? '').split(',').map(Number);
function setCamera(mode) {
  if (mode === 'focus') {
    const [x, z, d] = focus;
    controls.target.set(x, 40, z);
    camera.position.set(x + d * 0.55, 40 + d * 0.6, z + d * 0.75);
    controls.update();
    return;
  }
  controls.target.set(0, 0, 0);
  if (mode === 'top') camera.position.set(0, 4300, 1);
  else camera.position.set(2500, 2600, 3200); // axonometric-like oblique view of the whole 3 × 3 world
  controls.update();
}

const grid = new WorldGrid(createWorldConfig({ worldSeed: Number(query.get('worldSeed')) || undefined, transitionWidth: query.get('transitionWidth') ?? undefined, terrainMode: query.get('terrain') ?? undefined, roadMode: query.get('roads') === 'independent' ? 'independent' : 'joined' }));
const seamView = new SeamView(scene);
const views = new Map(); // chunkId → { chunk, network, buildings, label, solid }
const state = { selected: query.get('select') && grid.chunks.has(query.get('select')) ? query.get('select') : 'chunk_0_0', seams: query.get('seams') === '1', busy: false, lastBuild: null, seamReport: null, seamClasses: null, roadSeam: null };

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

function viewsOf(chunkId) {
  if (!views.has(chunkId)) views.set(chunkId, { chunk: new ChunkView(scene), network: new NetworkView(scene), buildings: new BuildingView(scene), label: null });
  return views.get(chunkId);
}

// Render one chunk from its cached layers. Terrain mesh is rebuilt only when the terrain layer ran.
function renderChunk(chunkId, ran) {
  const { slot, terrain, city } = grid.chunks.get(chunkId);
  if (!terrain) return;
  const v = viewsOf(chunkId);
  if (ran.terrain) v.chunk.update(terrain.fields, terrain.config, 'classes', terrain.analysis, null, null);
  const empty = !city || city.empty;
  if (!empty) {
    v.network.update(city.network, createSampler(terrain.fields).height);
    v.buildings.update(city.buildings);
  }
  v.network.setVisible(!empty);
  v.buildings.setVisible(!empty);
  // Tunnels (frozen 05.1b-2) are re-cut from the current network; an empty slot gets no tunnel.
  v.tunnels = v.chunk.updateTunnels(empty ? { edges: [] } : city.network, terrain.fields, empty ? null : city.buildings);
  v.tunnelIsolation = null;
  if (v.tunnels.accepted.length) {
    // Known 05.1b-2 failure combinations (open / non-manifold cut) are isolated, not repaired: the cut is removed and
    // the chunk keeps its closed solid; the tunnel edge stays in the network data and is reported.
    const solid = v.chunk.solidReport(terrain.fields);
    if (!solid.watertight || solid.eulerCharacteristic !== solid.expectedEuler) {
      v.tunnelIsolation = { accepted: v.tunnels.accepted, nonManifold: solid.nonManifoldEdges, inconsistent: solid.inconsistentEdges, euler: solid.eulerCharacteristic, expectedEuler: solid.expectedEuler, reason: 'tunnel cut left the solid open (known 05.1b-2 defect); cut removed, tunnel not rendered' };
      v.tunnels = v.chunk.updateTunnels({ edges: [] }, terrain.fields, null);
    }
  }
  if (v.label) { v.label.material.map.dispose(); v.label.material.dispose(); v.label.removeFromParent(); }
  const name = empty ? 'empty slot' : `${slot.cityMode === 'auto' ? 'auto → ' : ''}${CITY_DNA[city.cityMatch.selectedDNA.id].label.split(' — ')[0]}`;
  v.label = textSprite([`${chunkId} · ${slot.landform}`, `${name} · seed ${slot.terrainSeed}`]);
  v.label.position.set(slot.worldOrigin.x, terrain.fields.stats.maxHeight + 140, slot.worldOrigin.z);
  scene.add(v.label);
}

const outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false }));
outline.renderOrder = 10;
scene.add(outline);
function renderSelection() {
  const { slot, terrain } = grid.chunks.get(state.selected);
  const h = WORLD.chunkSize / 2 - 2;
  const y = (terrain?.fields.stats.maxHeight ?? 0) + 6;
  const { x, z } = slot.worldOrigin;
  outline.geometry.dispose();
  outline.geometry = new THREE.BufferGeometry().setFromPoints([[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, b]) => new THREE.Vector3(x + a, y, z + b)));
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
let queue = Promise.resolve();
// Build every invalidated chunk, one at a time (on demand; untouched chunks keep cache and meshes).
function rebuild() {
  queue = queue.then(async () => {
    const prepareStarted = performance.now();
    const dirty = grid.dirty();
    const prepare = { ...grid.lastPrepare, ms: Math.round(performance.now() - prepareStarted) };
    state.busy = true;
    window.__worldGridLab.ready = false;
    const records = new Map(); // chunkId → { chunkId, ran, dataMs, renderMs }
    const recordOf = chunkId => {
      if (!records.has(chunkId)) records.set(chunkId, { chunkId, ran: { terrain: false, network: false, city: false }, dataMs: 0, renderMs: 0 });
      return records.get(chunkId);
    };
    // Pass 1: terrain + own network per invalidated chunk. 06.3b road seam (world). Pass 2: city layers that the
    // seam made stale (the changed chunk and any neighbour whose stitched roads changed), then render.
    for (const { chunkId } of dirty) {
      document.querySelector('#statusText').textContent = `GENERATING ${chunkId}`;
      await nextFrame();
      const t0 = performance.now();
      Object.assign(recordOf(chunkId).ran, grid.buildNetwork(chunkId));
      recordOf(chunkId).dataMs += Math.round(performance.now() - t0);
    }
    const seam = grid.stitch();
    for (const chunkId of seam.stale) {
      document.querySelector('#statusText').textContent = `GENERATING ${chunkId} CITY`;
      await nextFrame();
      const record = recordOf(chunkId);
      const t0 = performance.now();
      grid.buildCity(chunkId);
      record.ran.city = true;
      const t1 = performance.now();
      renderChunk(chunkId, record.ran);
      record.dataMs += Math.round(t1 - t0);
      record.renderMs = Math.round(performance.now() - t1);
    }
    for (const record of records.values()) if (!record.ran.city && record.ran.terrain) renderChunk(record.chunkId, record.ran); // error path
    const perChunk = [...records.values()];
    state.roadSeam = grid.roadSeam.report;
    const seamInput = [...grid.chunks.values()].filter(c => c.terrain).map(c => ({ slot: c.slot, fields: c.terrain.fields, network: c.city && !c.city.empty ? c.city.network : null, waterType: c.terrain.harmony?.waterType ?? null }));
    state.seamReport = checkSeams(seamInput, grid.harmony.report);
    state.seamClasses = classifySeams({
      pairs: state.seamReport.pairs, corners: state.seamReport.corners, terrainEdges: grid.harmony.report?.edges ?? null, transitionWidth: grid.world.transitionWidth,
      chunks: new Map([...grid.chunks.values()].filter(c => c.terrain).map(c => { const o = grid.harmony.outputs.get(c.slot.chunkId).harmony; return [c.slot.chunkId, { fields: c.terrain.fields, landform: c.slot.landform, base: o?.base ?? null, coreWaterLost: o?.water?.coreLost ?? 0 }]; })),
    });
    seamView.update(state.seamReport, new Map(seamInput.map(c => [c.slot.chunkId, c])), grid.world.roadMode === 'joined' ? state.roadSeam : null, state.seamClasses);
    seamView.updateTerrain([...grid.chunks.values()].filter(c => c.terrain).map(c => ({ fields: c.terrain.fields, rawHeight: c.raw.chunk.height, steep: c.terrain.harmony?.steep ?? null })));
    seamView.setVisible(state.seams);
    state.lastBuild = { prepare: { raw: prepare.raw, harmony: prepare.harmony, harmonyMs: Math.round(prepare.harmonyMs), ms: prepare.ms, roadSeam: seam.ran, roadSeamMs: Math.round(seam.ms), cityStale: seam.stale }, chunks: perChunk, totalMs: Math.round(performance.now() - prepareStarted) };
    state.busy = false;
    renderSelection();
    renderPanel();
    const errors = [...grid.chunks.values()].filter(c => c.status === 'error').length;
    document.querySelector('#statusText').textContent = errors ? `${errors} CHUNK ERROR(S)` : 'READY';
    window.__worldGridLab.ready = true;
  });
  return queue;
}

// ---------- UI ----------
const cityOptions = { 'Empty slot': 'empty', 'Auto (top match)': 'auto', ...Object.fromEntries(Object.entries(CITY_DNA).map(([id, dna]) => [dna.label, id])) };
const ui = { worldSeed: grid.world.worldSeed, chunk: state.selected, city: 'auto', seams: state.seams, transitionWidth: grid.world.transitionWidth, terrainMode: grid.world.terrainMode, roadMode: grid.world.roadMode };
// World options: rebuild from the saved form so seeds are re-derived, never carried over.
function setWorldOptions(options) {
  const saved = serialiseWorld(grid.world);
  grid.setWorld(createWorldConfig({ ...saved, ...options, slots: saved.slots.map(({ terrainSeed, ...rest }) => rest) }));
  Object.assign(ui, { worldSeed: grid.world.worldSeed, transitionWidth: grid.world.transitionWidth, terrainMode: grid.world.terrainMode, roadMode: grid.world.roadMode });
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  return rebuild();
}
const gui = new GUI({ title: 'World Grid', container: document.querySelector('#gui') });
gui.add(ui, 'worldSeed', 1, 99999, 1).name('World seed').onFinishChange(value => setWorldOptions({ worldSeed: value }));
gui.add(ui, 'terrainMode', { 'World-coordinated, core kept (06.3a-R2)': 'coordinated', 'Macro ramps (06.3a-R)': 'macroRamp', 'Edge-harmonised (06.3a)': 'harmonized', 'Raw chunks (06.2)': 'raw' }).name('Terrain').onChange(value => setWorldOptions({ terrainMode: value }));
gui.add(ui, 'roadMode', { 'Joined across seams': 'joined', 'Independent (06.3a)': 'independent' }).name('Roads').onChange(value => setWorldOptions({ roadMode: value }));
gui.add(ui, 'transitionWidth', 32, 256, 16).name('Transition width (m)').onFinishChange(value => setWorldOptions({ transitionWidth: value }));
const chunkController = gui.add(ui, 'chunk', grid.world.slots.map(slot => slot.chunkId)).name('Selected chunk').onChange(select);
const cityController = gui.add(ui, 'city', cityOptions).name('City ID').onChange(value => setCity(state.selected, value === 'empty' ? null : value));
gui.add(ui, 'seams').name('Seam debug').onChange(value => { state.seams = value; seamView.setVisible(value); });
gui.add({ top: () => setCamera('top') }, 'top').name('Top view');
gui.add({ axo: () => setCamera('axo') }, 'axo').name('Oblique view');
gui.add({ save: () => saveConfig() }, 'save').name('Save city config');
gui.add({ restore: () => restoreConfig() }, 'restore').name('Restore city config');
gui.add({ exportCheckpoint: () => exportCheckpoint() }, 'exportCheckpoint').name('Export world checkpoint');
gui.add({ loadCheckpoint: () => checkpointInput.click() }, 'loadCheckpoint').name('Load world checkpoint');

function select(chunkId) {
  state.selected = chunkId;
  ui.chunk = chunkId;
  const slot = grid.chunks.get(chunkId).slot;
  ui.city = slot.cityId === null ? 'empty' : slot.cityId;
  chunkController.updateDisplay();
  cityController.updateDisplay();
  renderSelection();
  renderPanel();
}

function setCity(chunkId, cityId) {
  grid.setCityId(chunkId, cityId);
  if (chunkId === state.selected) { ui.city = cityId === null ? 'empty' : cityId; cityController.updateDisplay(); }
  return rebuild();
}

function saveConfig() {
  const saved = serialiseWorld(grid.world);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* storage unavailable: config still returned */ }
  document.querySelector('#saveState').textContent = `saved ${new Date().toLocaleTimeString()} · ${saved.slots.map(s => s.cityId ?? 'empty').join(', ')}`;
  return saved;
}

function restoreConfig(saved) {
  let data = saved;
  if (!data) { try { data = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { data = null; } }
  if (!data) { document.querySelector('#saveState').textContent = 'nothing saved'; return Promise.resolve(null); }
  grid.setWorld(restoreWorld(data));
  Object.assign(ui, { worldSeed: grid.world.worldSeed, transitionWidth: grid.world.transitionWidth, terrainMode: grid.world.terrainMode, roadMode: grid.world.roadMode });
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  select(state.selected);
  document.querySelector('#saveState').textContent = 'restored';
  return rebuild();
}

// World State checkpoint (versioned JSON, seeds + configuration; see worldCheckpoint.js).
const currentCheckpoint = note => createCheckpoint(grid.world, grid.world.slots.map(slot => grid.summary(slot.chunkId)), state.seamClasses, note);
function exportCheckpoint() {
  const data = currentCheckpoint('exported from the World Grid page');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }));
  link.download = `world-${data.world.worldSeed}-checkpoint-v${data.checkpointVersion}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  document.querySelector('#saveState').textContent = `checkpoint exported · world ${data.world.worldSeed}`;
  return data;
}
function applyCheckpoint(data) {
  grid.setWorld(readCheckpoint(data));
  Object.assign(ui, { worldSeed: grid.world.worldSeed, transitionWidth: grid.world.transitionWidth, terrainMode: grid.world.terrainMode, roadMode: grid.world.roadMode });
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  select(state.selected);
  return rebuild().then(() => {
    state.checkpointResult = compareCheckpoint(data, grid.world.slots.map(slot => grid.summary(slot.chunkId)), state.seamClasses);
    document.querySelector('#saveState').textContent = `checkpoint loaded (${data.createdAt.slice(0, 10)}) · ${state.checkpointResult.reproduced ? 'reproduced: all signatures match' : `${state.checkpointResult.mismatches.length} mismatch(es)`}`;
    return state.checkpointResult;
  });
}
const checkpointInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
checkpointInput.addEventListener('change', async () => {
  const file = checkpointInput.files?.[0];
  if (!file) return;
  try { await applyCheckpoint(JSON.parse(await file.text())); } catch (error) { document.querySelector('#saveState').textContent = `checkpoint not loaded: ${error.message}`; }
  checkpointInput.value = '';
});

// Click (not drag) on a chunk selects it.
const raycaster = new THREE.Raycaster();
let down = null;
canvas.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
canvas.addEventListener('pointerup', event => {
  if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
  const rect = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
  const meshes = [...views.entries()].map(([id, v]) => { v.chunk.terrain.userData.chunkId = id; return v.chunk.terrain; });
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (hit) select(hit.object.userData.chunkId);
});

function renderPanel() {
  const s = grid.summary(state.selected);
  const fmt = value => (value === null || value === undefined ? '—' : value);
  document.querySelector('#chunkInfo').textContent = `${s.chunkId} · grid (${s.gridX}, ${s.gridY}) · origin x ${s.worldOrigin.x} m, z ${s.worldOrigin.z} m · ${s.status}`;
  document.querySelector('#terrainInfo').textContent = `${s.landform} · terrain seed ${s.terrainSeed} (world ${grid.world.worldSeed}) · height ${fmt(s.signatures.height)} · water ${fmt(s.signatures.water)}`;
  document.querySelector('#cityInfo').textContent = `cityId ${s.cityId ?? 'null'} · ${s.cityMode}${s.resolvedLabel ? ` → ${s.resolvedLabel} (${s.resolvedDNA})` : ''}`;
  document.querySelector('#countInfo').textContent = s.counts ? `${s.counts.roadKm} km road · ${s.counts.ports} edge ports · ${s.counts.tunnels} tunnel · ${s.counts.blocks} blocks · ${s.counts.parcels} parcels · ${s.counts.buildings} buildings (mean ${s.counts.meanHeight} m)` : 'no city layers (empty slot)';
  document.querySelector('#timeInfo').textContent = `terrain ${fmt(s.ms.terrain)} ms · city ${fmt(s.ms.city)} ms${s.ms.stages ? ` (${Object.entries(s.ms.stages).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''} · builds terrain ${s.builds.terrain} / city ${s.builds.city}`;
  const pairs = (state.seamReport?.pairs ?? []).filter(p => p.a === s.chunkId || p.b === s.chunkId);
  document.querySelector('#seamInfo').innerHTML = pairs.map(p => {
    const other = p.a === s.chunkId ? `${p.sideA} → ${p.b}` : `${p.sideB} → ${p.a}`;
    const join = p.harmony ? (p.harmony.status === 'resolved' ? `joined ${p.harmony.continuity}` : `UNRESOLVED (raw step ${p.harmony.rawMaxStep} m)`) : 'raw';
    const water = p.waterInterface.status === 'discontinuous' ? `water: ${Object.entries(p.waterInterface.reasons).map(([r, n]) => `${r} ×${n}`).join('; ')}` : `water: ${p.waterInterface.status}`;
    const road = state.roadSeam?.edges.find(e => e.id === p.id)?.summary;
    const roads = grid.world.roadMode === 'joined' && road ? `roads: ${road.connected} ports connected (${road.pairs} pairs, ${road.stubs} stubs), ${road.rejected} rejected, ${road.pending} pending` : `ports ${p.ports.matched.length} paired, ${p.ports.unmatchedA.length + p.ports.unmatchedB.length} unpaired (roads independent)`;
    const k = state.seamClasses?.find(c => c.id === p.id);
    const cls = k ? `<b>${k.overall}</b> (geometry ${k.geometryStatus} · landform ${k.landformStatus} · water ${k.hydrologyStatus} · transport ${k.transportStatus}) · ` : '';
    return `<li>${other}: ${cls}${join} · Δh max ${p.height.max} m · kink max ${p.slope.kinkMaxDeg}° (median ${p.slope.kinkMedianDeg}°) · band slope max ${p.slope.bandMaxSlopeDeg}° · ${water} · ${roads}</li>`;
  }).join('');
  const b = state.lastBuild;
  const ready = [...grid.chunks.values()].filter(c => c.status.startsWith('ready')).length;
  const h = grid.harmony?.report;
  const joined = h ? `${h.edges.filter(e => e.status === 'resolved').length} / ${h.edges.length} edges joined, ${h.corners.filter(c => c.closed).length} / ${h.corners.length} corners closed` : 'raw chunks (no harmonisation)';
  const rs = state.roadSeam?.stats;
  const roadText = grid.world.roadMode === 'joined' && rs ? ` · roads: ${rs.connections} cross-chunk joins (${rs.pairs} pairs, ${rs.stubs} stubs), ports ${rs.connected} connected / ${rs.rejected} rejected / ${rs.pending} pending` : ' · roads independent';
  document.querySelector('#worldInfo').textContent = `world seed ${grid.world.worldSeed} · ${ready} / 9 chunks ready · transition ${grid.world.transitionWidth} m · ${joined}${roadText}${b ?` · last build ${b.chunks.length} chunk(s) in ${b.totalMs} ms (harmonisation ${b.prepare.harmony ? `${b.prepare.harmonyMs} ms` : 'cached'})` : ''}`;
  const iso = views.get(s.chunkId)?.tunnelIsolation;
  if (iso) document.querySelector('#countInfo').textContent += ` · tunnel isolated: ${iso.reason}`;
}

window.__worldGridLab = {
  ready: false,
  world: () => JSON.parse(JSON.stringify(grid.world)),
  serialise: () => serialiseWorld(grid.world),
  save: () => saveConfig(),
  restore: saved => restoreConfig(saved).then(() => serialiseWorld(grid.world)),
  setCity: (chunkId, cityId) => setCity(chunkId, cityId).then(() => grid.summary(chunkId)),
  select: chunkId => { select(chunkId); return { selected: state.selected, uiCity: ui.city, guiCity: document.querySelector('#gui select:last-of-type')?.selectedOptions?.[0]?.textContent ?? null, panel: document.querySelector('#cityInfo').textContent }; },
  summaries: () => grid.world.slots.map(slot => grid.summary(slot.chunkId)),
  seams: () => JSON.parse(JSON.stringify({ ...state.seamReport, pairs: state.seamReport.pairs.map(({ profile, ...rest }) => rest) })),
  lastBuild: () => state.lastBuild,
  // Rendered placement: terrain mesh bounds per chunk (world coordinates).
  bounds: () => [...views.entries()].map(([id, v]) => { v.chunk.terrain.geometry.computeBoundingBox(); const b = v.chunk.terrain.geometry.boundingBox; return { chunkId: id, min: b.min.toArray(), max: b.max.toArray() }; }),
  solid: chunkId => viewsOf(chunkId).chunk.solidReport(grid.chunks.get(chunkId).terrain.fields),
  tunnels: chunkId => { const t = views.get(chunkId)?.tunnels; return t ? { accepted: t.accepted, errors: t.errors, records: t.records } : null; },
  selectedGuiLabels: () => [...document.querySelectorAll('#gui select')].map(s => s.selectedOptions[0]?.textContent ?? null),
  // 06.3a
  setWorldOptions: options => setWorldOptions(options).then(() => window.__worldGridLab.summaries()),
  harmony: () => (grid.harmony.report ? JSON.parse(JSON.stringify({ ...grid.harmony.report, chunks: undefined, ms: grid.harmony.ms })) : null),
  difference: chunkId => grid.difference(chunkId),
  tunnelIsolation: () => [...views.entries()].filter(([, v]) => v.tunnelIsolation).map(([id, v]) => ({ chunkId: id, ...v.tunnelIsolation })),
  // Rendered data vs fields: mesh vertex = (grid x, height, grid z) exactly; water mesh only where waterMask.
  meshConsistency: chunkId => {
    const { fields } = grid.chunks.get(chunkId).terrain;
    const p = views.get(chunkId).chunk.terrain.geometry.attributes.position.array;
    const { columns, spacing, size, originX, originZ } = fields.grid;
    let maxY = 0; let maxXZ = 0;
    for (let k = 0; k < fields.height.length; k += 1) {
      maxY = Math.max(maxY, Math.abs(p[k * 3 + 1] - fields.height[k]));
      maxXZ = Math.max(maxXZ, Math.abs(p[k * 3] - (originX - size / 2 + (k % columns) * spacing)), Math.abs(p[k * 3 + 2] - (originZ - size / 2 + Math.floor(k / columns) * spacing)));
    }
    return { chunkId, maxHeightError: maxY, maxPlanError: maxXZ };
  },
  // Rendered vertex normals on both sides of a shared edge (angle between the two chunks' normals at each edge vertex).
  edgeNormals: pairId => {
    const pair = state.seamReport.pairs.find(p => p.id === pairId);
    const { segments, columns } = grid.chunks.get(pair.a).terrain.fields.grid;
    const at = (side, i) => (side === 'minX' ? i * columns : side === 'maxX' ? i * columns + segments : side === 'minZ' ? i : segments * columns + i);
    const nA = views.get(pair.a).chunk.terrain.geometry.attributes.normal.array; const nB = views.get(pair.b).chunk.terrain.geometry.attributes.normal.array;
    const angles = [];
    for (let i = 0; i <= segments; i += 1) {
      const a = at(pair.sideA, i) * 3; const b = at(pair.sideB, i) * 3;
      const dot = Math.min(1, nA[a] * nB[b] + nA[a + 1] * nB[b + 1] + nA[a + 2] * nB[b + 2]);
      angles.push(Math.acos(dot) * 180 / Math.PI);
    }
    const sorted = [...angles].sort((x, y) => x - y);
    return { pairId, maxDeg: +sorted[sorted.length - 1].toFixed(2), p95Deg: +sorted[Math.floor(0.95 * segments)].toFixed(2), medianDeg: +sorted[Math.floor(0.5 * segments)].toFixed(3) };
  },
  // Harmonisation is independent of input order: re-run on reversed / rotated raw input and compare output checksums.
  orderTest: async () => {
    const { harmonizeWorld: harmonize } = await import('./TerrainHarmonizer.js');
    const { coordinateWorld } = await import('./WorldTerrain.js');
    const { coordinateTerrain } = await import('./TerrainCoordinator.js');
    const { terrainMode: mode, worldSeed: seed, variation } = grid.world;
    const harmonizeWorld = (inp, W) => (mode === 'coordinated' ? coordinateTerrain(inp, W, seed, variation) : mode === 'macroRamp' ? coordinateWorld(inp, W, seed, variation) : harmonize(inp, W));
    const { checksum } = await import('../cellular-noise/noise.js');
    const sumOf = a => checksum(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    const input = [...grid.chunks.values()].map(c => ({ chunkId: c.slot.chunkId, gridX: c.slot.gridX, gridY: c.slot.gridY, landform: c.slot.landform, grid: c.raw.chunk.grid, height: c.raw.chunk.height, waterSurface: c.raw.chunk.waterSurface }));
    const sig = report => [...report.chunks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, o]) => `${id}:${sumOf(o.height)}:${sumOf(o.waterSurface)}`).join(',');
    const current = sig(grid.harmony.report);
    const reversed = sig(harmonizeWorld([...input].reverse(), grid.world.transitionWidth));
    const rotated = sig(harmonizeWorld([...input.slice(4), ...input.slice(0, 4)], grid.world.transitionWidth));
    return { identical: current === reversed && current === rotated, current, reversed, rotated };
  },
  // 06.3a-R terrain checks
  // Water: every sea cell at the sea level; river wet cells only where the raw chunk was wet (no spreading).
  waterAudit: () => [...grid.chunks.values()].map(c => {
    const out = grid.harmony.outputs.get(c.slot.chunkId); const { fields } = c.terrain; const raw = c.raw.chunk;
    let sea = 0; let seaLevelDev = 0; let river = 0; let riverOutsideRaw = 0;
    const type = out.harmony?.waterType;
    for (let k = 0; k < fields.height.length; k += 1) {
      if (!fields.waterMask[k]) continue;
      const rawWet = Number.isFinite(raw.waterSurface[k]) && raw.height[k] < raw.waterSurface[k];
      if (type ? type[k] === 1 : c.slot.landform === 'coast') { sea += 1; seaLevelDev = Math.max(seaLevelDev, Math.abs(fields.waterSurface[k])); }
      if (type ? type[k] === 2 : c.slot.landform === 'riverValley') { river += 1; if (!rawWet) riverOutsideRaw += 1; }
    }
    return { chunkId: c.slot.chunkId, landform: c.slot.landform, sea, seaLevelDev, river, riverOutsideRaw };
  }),
  // Road-candidate feasibility across one shared edge: share of edge positions whose straight transect through both
  // bands (depth < W on each side) stays dry and at most `maxSlope`°, with no height step at the edge.
  crossability: (pairId, maxSlope = 20) => {
    const pair = state.seamReport.pairs.find(p => p.id === pairId);
    return transectFeasibility(pair, grid.chunks.get(pair.a).terrain.fields, grid.chunks.get(pair.b).terrain.fields, grid.world.transitionWidth, maxSlope);
  },
  // World State checkpoint (M06): create from the current world, load (rebuild + signature comparison).
  checkpoint: note => currentCheckpoint(note ?? ''),
  loadCheckpoint: data => applyCheckpoint(data),
  checkpointResult: () => state.checkpointResult ?? null,
  // 06.3c seam classes (geometry / landform / hydrology / transport per shared edge).
  seamClasses: () => JSON.parse(JSON.stringify(state.seamClasses)),
  // 06.3c datum audit: terrainAnalysis + auto City Match of each chunk on its raw terrain vs on raw + the world datum
  // shift (no seam correction). Relative metrics must not change; absolute ones (elevation, heights) move by the shift.
  datumAudit: () => {
    const absolute = path => /elevation|height|(^|\.)y$|surface|level/i.test(path);
    const diff = (a, b, path = '', out = []) => {
      if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) out.push({ path, a, b }); return out; }
      if (a && b && typeof a === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, out); return out; }
      if (a !== b) out.push({ path, a, b });
      return out;
    };
    return [...grid.chunks.values()].map(c => {
      const o = grid.harmony.outputs.get(c.slot.chunkId).harmony;
      if (!o?.macro) return null;
      const raw = c.raw.chunk; const shift = o.macro.shiftExact; // exact value used by the coordinator (the report rounds it)
      const level = Float32Array.from(raw.waterSurface, v => (Number.isFinite(v) ? (c.slot.landform === 'coast' ? v : v + shift) : NaN));
      const onRaw = generateTerrainLayer(grid.world, c.slot, c.raw, { height: raw.height, waterSurface: raw.waterSurface }, 'audit-raw');
      const onBase = generateTerrainLayer(grid.world, c.slot, c.raw, { height: o.base, waterSurface: level }, 'audit-base');
      const d = diff(onRaw.analysis, onBase.analysis);
      // Field level: cells whose class flips under the pure shift (Float32 rounding at a threshold) and the slope change.
      const flips = {}; let slopeMax = 0;
      for (const key of ['waterMask', 'buildableMask']) { let n = 0; for (let k = 0; k < raw.height.length; k += 1) if (onRaw.fields[key][k] !== onBase.fields[key][k]) n += 1; flips[key] = n; }
      for (let k = 0; k < raw.height.length; k += 1) slopeMax = Math.max(slopeMax, Math.abs(onRaw.fields.slope[k] - onBase.fields.slope[k]));
      const largest = d.filter(x => !absolute(x.path) && typeof x.a === 'number').sort((p, q) => Math.abs(q.a - q.b) - Math.abs(p.a - p.b)).slice(0, 3);
      const relative = d.filter(x => !absolute(x.path));
      const top = analysis => matchCity(analysis, { override: null }).selectedDNA.id;
      const now = c.net && !c.net.empty ? c.net.cityMatch.selectedDNA : null;
      return {
        chunkId: c.slot.chunkId, landform: c.slot.landform, cityMode: c.slot.cityMode, cityId: c.slot.cityId, shift,
        relativeDiffs: relative.length, relativeExamples: relative.slice(0, 5), absoluteDiffs: d.length - relative.length,
        maxRelativeChange: Math.max(0, ...relative.filter(x => typeof x.a === 'number' && typeof x.b === 'number').map(x => Math.abs(x.a - x.b))), nonNumericRelativeDiffs: relative.filter(x => typeof x.a !== 'number' || typeof x.b !== 'number').length, nonNumericExamples: relative.filter(x => typeof x.a !== 'number' || typeof x.b !== 'number').slice(0, 6), fieldFlips: flips, slopeMaxChange: slopeMax, largestRelative: largest,
        elevationMean: [+onRaw.analysis.elevationStats.mean.toFixed(2), +onBase.analysis.elevationStats.mean.toFixed(2)],
        autoTopRaw: top(onRaw.analysis), autoTopBase: top(onBase.analysis), autoTopCoordinated: now?.autoTopId ?? null,
        resolvedDNA: now?.id ?? null, manualKept: c.slot.cityMode !== 'manual' || now?.id === c.slot.cityId,
      };
    }).filter(Boolean);
  },
  // Landform character per chunk: relief range, mean slope, wet share, untouched (raw) core share.
  landformStats: chunkId => {
    const c = grid.chunks.get(chunkId); const f = c.terrain.fields; const raw = c.raw.chunk;
    const pct = (a, q) => { const s = Float32Array.from(a).sort(); return s[Math.floor(q * (s.length - 1))]; };
    const rawSlope = slopeField(raw.height, f.grid.segments, f.grid.columns, f.grid.spacing);
    let same = 0; let wetRaw = 0;
    for (let k = 0; k < f.height.length; k += 1) { if (Math.abs(f.height[k] - raw.height[k]) < 1e-6) same += 1; if (Number.isFinite(raw.waterSurface[k]) && raw.height[k] < raw.waterSurface[k]) wetRaw += 1; }
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    return { chunkId, landform: c.slot.landform, reliefRaw: +(pct(raw.height, 0.95) - pct(raw.height, 0.05)).toFixed(1), relief: +(pct(f.height, 0.95) - pct(f.height, 0.05)).toFixed(1), meanSlopeRaw: +mean(rawSlope).toFixed(2), meanSlope: +mean(f.slope).toFixed(2), wetShareRaw: +(wetRaw / f.height.length).toFixed(4), wetShare: +mean(f.waterMask).toFixed(4), buildableShare: +mean(f.buildableMask).toFixed(4), untouchedShare: +(same / f.height.length).toFixed(4) };
  },
  // 06.3a-R2: per chunk core preservation, change statistics and water (from the coordinator output).
  coreAudit: () => [...grid.chunks.values()].map(c => { const o = grid.harmony.outputs.get(c.slot.chunkId).harmony; return o?.core ? { chunkId: c.slot.chunkId, landform: c.slot.landform, core: o.core, macro: o.macro, water: o.water, slopeChange: o.slopeChange, changedCells: o.changedCells, changedShare: +(o.changedCells / c.terrain.fields.height.length).toFixed(4), maxDelta: +o.maxDelta.toFixed(2), meanDeltaChanged: +o.meanDeltaChanged.toFixed(2) } : null; }),
  // Cross-section across a shared edge at along index i: raw, world base and coordinated heights on both sides.
  section: (pairId, i) => {
    const pair = state.seamReport.pairs.find(p => p.id === pairId); const W = grid.world.transitionWidth;
    const side = (id, s) => { const c = grid.chunks.get(id); const o = grid.harmony.outputs.get(id).harmony; const { segments, columns, spacing } = c.terrain.fields.grid; const out = [];
      for (let depth = 0; depth * spacing <= W + 96; depth += 1) { const k = s === 'minX' ? i * columns + depth : s === 'maxX' ? i * columns + (segments - depth) : s === 'minZ' ? depth * columns + i : (segments - depth) * columns + i; out.push({ d: depth * spacing, raw: c.raw.chunk.height[k], base: o?.base ? o.base[k] : c.raw.chunk.height[k], h: c.terrain.fields.height[k], wet: c.terrain.fields.waterMask[k] }); } return out; };
    return { pairId, i, W, a: side(pair.a, pair.sideA), b: side(pair.b, pair.sideB) };
  },
  memory: () => { window.gc?.(); return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null; }, // after GC when exposed (verifier)
  // 06.3b road seam
  roadSeam: () => { const r = state.roadSeam; return r ? JSON.parse(JSON.stringify({ mode: r.mode, rules: r.rules, transitionWidth: r.transitionWidth, maxPairOffset: r.maxPairOffset, edges: r.edges, connections: r.connections, ports: r.ports, stats: r.stats, signature: r.signature, ms: r.ms, worldLinks: r.world.links.length })) : null; },
  roadAudit: () => roadAudit(),
  reach: () => reach(),
  roadOrderTest: () => {
    const input = [...grid.chunks.values()].filter(c => c.net).map(c => ({ chunkId: c.slot.chunkId, gridX: c.slot.gridX, gridY: c.slot.gridY, fields: c.terrain.fields, network: c.net.empty ? null : c.net.network }));
    const reversed = stitchRoads([...input].reverse(), grid.harmony.report, grid.world.transitionWidth, grid.world.roadMode).signature;
    const rotated = stitchRoads([...input.slice(4), ...input.slice(0, 4)], grid.harmony.report, grid.world.transitionWidth, grid.world.roadMode).signature;
    return { identical: reversed === state.roadSeam.signature && rotated === state.roadSeam.signature, current: state.roadSeam.signature, reversed, rotated };
  },
  // Height sampling across a shared edge at off-grid points (bilinear sampler of each chunk).
  edgeSampling: pairId => {
    const pair = state.seamReport.pairs.find(p => p.id === pairId);
    const fa = grid.chunks.get(pair.a).terrain.fields; const fb = grid.chunks.get(pair.b).terrain.fields;
    const sa = createSampler(fa).height; const sb = createSampler(fb).height;
    let max = 0;
    for (let t = 0.13; t < 1024; t += 7.3) {
      const p = pair.profile[0]; const q = pair.profile[pair.profile.length - 1];
      const x = p.x + (q.x - p.x) * (t / 1024); const z = p.z + (q.z - p.z) * (t / 1024);
      max = Math.max(max, Math.abs(sa(x, z) - sb(x, z)));
    }
    return { pairId, maxDifference: max };
  },
};

// 06.3b checks on the current stitched world (data only; used by scripts/verify-road-seam.mjs).
const CROSS_IGNORE = (a, b) => (a.kind === 'canal') !== (b.kind === 'canal') && (a.kind === 'bridgeCandidate' || b.kind === 'bridgeCandidate'); // = NetworkGenerator.resolveCrossings
const segDist = (p, a, b) => { const dx = b.x - a.x; const dz = b.z - a.z; const l2 = dx * dx + dz * dz || 1e-12; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)); return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t); };
const insideRing = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]; const b = ring[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c; } return c; };
function roadAudit() {
  const r = state.roadSeam;
  const W = grid.world.transitionWidth;
  const tol = r.rules.elevationTolerance;
  const chunk = id => grid.chunks.get(id);
  // 1. Every connection is one node in each stitched graph at the same world point, at the same height.
  const connections = r.connections.map(c => {
    const gA = r.networks.get(c.a.chunkId); const gB = r.networks.get(c.b.chunkId);
    const nA = c.a.nodeId === null ? null : gA.nodes[c.a.nodeId]; const nB = c.b.nodeId === null ? null : gB.nodes[c.b.nodeId];
    return { id: c.id, kind: c.kind, edgeId: c.edgeId, found: Boolean(nA && nB), positionError: nA && nB ? Math.hypot(nA.x - nB.x, nA.z - nB.z) : null, elevationDiff: nA && nB ? Math.abs(nA.y - nB.y) : null, kinds: [nA?.kind, nB?.kind], degrees: [nA?.degree, nB?.degree] };
  });
  // 2. Visual-only contacts: road ports of both chunks at one point of a shared edge that are not one connection.
  const linked = new Set(r.connections.flatMap(c => [`${c.a.chunkId}/${c.a.nodeId}`, `${c.b.chunkId}/${c.b.nodeId}`]));
  const visualOnly = [];
  for (const e of r.edges) {
    const gA = r.networks.get(e.a); const gB = r.networks.get(e.b);
    if (!gA || !gB) continue;
    for (const p of gA.edgePorts.filter(q => q.side === e.sideA && q.type === 'road')) {
      for (const q of gB.edgePorts.filter(x => x.side === e.sideB && x.type === 'road')) {
        if (Math.abs(p.position - q.position) <= 0.5 && !(linked.has(`${e.a}/${p.nodeId}`) && linked.has(`${e.b}/${q.nodeId}`))) visualOnly.push({ edgeId: e.id, position: p.position });
      }
    }
  }
  // 3. Crossings without a junction: stitched vs own network, per chunk.
  const crossings = [...r.networks.entries()].filter(([, g]) => g).map(([id, g]) => ({ chunkId: id, own: findCrossings(chunk(id).net.network.edges, { ignore: CROSS_IGNORE }).length, stitched: findCrossings(g.edges, { ignore: CROSS_IGNORE }).length }));
  // 4. Connector geometry: inside the band, on land, within the DNA slope limit; grade along the connector.
  const connectors = r.connections.flatMap(c => c.connectors.map(k => {
    const { fields } = chunk(k.chunkId).terrain; const s = createSampler(fields); const g = r.networks.get(k.chunkId);
    const side = k.chunkId === c.a.chunkId ? r.edges.find(e => e.id === c.edgeId).sideA : r.edges.find(e => e.id === c.edgeId).sideB;
    const half = fields.grid.size / 2; const line = { minX: fields.grid.originX - half, maxX: fields.grid.originX + half, minZ: fields.grid.originZ - half, maxZ: fields.grid.originZ + half }[side];
    let wet = 0; let maxSlope = 0; let maxDepth = 0; let maxGrade = 0;
    for (let i = 1; i < k.points.length; i += 1) {
      const a = k.points[i - 1]; const b = k.points[i]; const L = Math.hypot(b.x - a.x, b.z - a.z); const n = Math.max(1, Math.ceil(L / 2)); let prev = null;
      for (let j = 0; j <= n; j += 1) {
        const x = a.x + (b.x - a.x) * j / n; const z = a.z + (b.z - a.z) * j / n; const idx = s.indexAt(x, z);
        wet += fields.waterMask[idx]; maxSlope = Math.max(maxSlope, fields.slope[idx]);
        maxDepth = Math.max(maxDepth, Math.abs((side.endsWith('X') ? x : z) - line));
        const h = s.height(x, z); if (prev !== null) maxGrade = Math.max(maxGrade, Math.atan(Math.abs(h - prev) / (L / n)) * 180 / Math.PI); prev = h;
      }
    }
    return { connectionId: c.id, chunkId: k.chunkId, wetSamples: wet, maxCellSlope: +maxSlope.toFixed(2), slopeLimit: g.params?.maxSlopeDeg ?? null, maxDepth: +maxDepth.toFixed(2), withinBand: maxDepth <= W + 0.01, maxGradeDeg: +maxGrade.toFixed(2) };
  }));
  // 5. Downstream freshness: city layer built on the stitched graph; buildings clear of every connector corridor.
  const cities = [...grid.chunks.values()].filter(c => c.city && !c.city.empty).map(c => {
    const id = c.slot.chunkId; const g = r.networks.get(id);
    const corridors = r.connections.flatMap(x => x.connectors.filter(k => k.chunkId === id));
    let conflicts = 0;
    for (const b of c.city.buildings.buildings) {
      const ring = b.footprint.polygon;
      const hit = corridors.some(k => {
        for (let i = 1; i < k.points.length; i += 1) {
          const a = k.points[i - 1]; const q = k.points[i];
          if (ring.some(p => segDist(p, a, q) < k.width / 2)) return true;
          for (let t = 0; t <= 1; t += 0.05) if (insideRing(ring, a.x + (q.x - a.x) * t, a.z + (q.z - a.z) * t)) return true;
        }
        return false;
      });
      if (hit) conflicts += 1;
    }
    return { chunkId: id, stitchedIsCurrent: c.city.network === g, blocksOnStitched: c.city.blocks.source.networkSignature === g.signature, changed: g !== c.net.network, corridors: corridors.length, buildingConflicts: conflicts, counts: { roadKm: +(g.stats.roadLength / 1000).toFixed(3), ports: g.edgePorts.length, blocks: c.city.blocks.stats.blocks, parcels: c.city.parcels.stats.parcels, buildings: c.city.buildings.stats.buildings } };
  });
  const unresolvedJoins = r.connections.filter(c => r.edges.find(e => e.id === c.edgeId).terrain === 'unresolved').length;
  const unexplained = r.ports.filter(p => p.status !== 'connected' && !p.reason).length;
  return {
    connections, visualOnly, crossings, connectors, cities, unresolvedJoins, unexplained,
    ok: connections.every(c => c.found && c.positionError === 0 && c.elevationDiff <= tol && c.kinds.every(k => k === 'port')) && !visualOnly.length && crossings.every(c => c.stitched <= c.own)
      && connectors.every(k => !k.wetSamples && k.maxCellSlope <= (k.slopeLimit ?? 90) && k.withinBand) && cities.every(c => c.stitchedIsCurrent && c.blocksOnStitched && !c.buildingConflicts) && !unresolvedJoins && !unexplained,
  };
}

// Cross-chunk reachability: world components + shortest road path between every city chunk pair, routed between
// the nodes nearest each chunk centre inside the largest world component the two chunks share.
function reach() {
  const r = state.roadSeam;
  const ids = [...grid.chunks.values()].filter(c => r.networks.get(c.slot.chunkId)).map(c => c.slot.chunkId);
  const shared = r.world.components.filter(c => c.chunks.length > 1).sort((a, b) => b.nodes - a.nodes || a.id - b.id);
  const paths = [];
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const component = shared.find(c => c.chunks.includes(ids[i]) && c.chunks.includes(ids[j]));
    const from = component ? chunkAnchor(r.world, ids[i], grid.chunks.get(ids[i]).slot.worldOrigin, component.id) : null;
    const to = component ? chunkAnchor(r.world, ids[j], grid.chunks.get(ids[j]).slot.worldOrigin, component.id) : null;
    const p = from && to ? worldPath(r.world, from, to) : null;
    paths.push({ from: ids[i], to: ids[j], reachable: Boolean(p), ...(p ? { fromNode: from, toNode: to, ...p } : {}) });
  }
  const anchors = Object.fromEntries(ids.map(id => [id, chunkAnchor(r.world, id, grid.chunks.get(id).slot.worldOrigin)]));
  // Every connection: route from deep inside A to deep inside B through that joint only counts if the path exists.
  const viaConnections = r.connections.map(c => {
    const p = worldPath(r.world, `${c.a.chunkId}/${c.a.nodeId}`, `${c.b.chunkId}/${c.b.nodeId}`);
    return { id: c.id, reachable: Boolean(p), length: p?.length ?? null };
  });
  return { anchors, components: r.world.components.filter(c => c.chunks.length > 1), paths, viaConnections };
}

function resize() {
  const width = canvas.clientWidth; const height = canvas.clientHeight; const ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}
renderer.setAnimationLoop(() => { resize(); controls.update(); renderer.render(scene, camera); });

setCamera(focus.length === 3 && focus.every(Number.isFinite) ? 'focus' : query.get('camera') === 'top' ? 'top' : 'axo');
select(state.selected);
// ?checkpoint=default loads the bundled World State checkpoint (seeds + configuration) instead of the default world.
if (query.get('checkpoint') === 'default') {
  fetch(defaultCheckpointUrl).then(response => response.json()).then(applyCheckpoint).catch(error => { document.querySelector('#saveState').textContent = `checkpoint not loaded: ${error.message}`; rebuild(); });
} else rebuild();
