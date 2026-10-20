import * as THREE from 'three';
import GUI from 'lil-gui';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ChunkView } from '../seed-terrain/ChunkView.js';
import { NetworkView } from '../seed-terrain/NetworkView.js';
import { BuildingView } from '../seed-terrain/BuildingView.js';
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { CITY_DNA } from '../seed-terrain/cityMatchRules.js';
import { createWorldConfig, restoreWorld, serialiseWorld, WORLD } from './worldConfig.js';
import { WorldGrid } from './WorldGrid.js';
import { checkSeams } from './SeamCheck.js';
import { SeamView } from './SeamView.js';

// 06.2 World Grid: 3 × 3 fixed chunks in one world frame, each running the unchanged single-chunk chain.
// 06.3a: shared edges harmonised (TerrainHarmonizer); ?terrain=raw shows the independent 06.2 chunks.
// URL: ?worldSeed=…&transitionWidth=…&terrain=raw&seams=1&camera=top&focus=x,z,d&select=chunk_0_0
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

const grid = new WorldGrid(createWorldConfig({ worldSeed: Number(query.get('worldSeed')) || undefined, transitionWidth: query.get('transitionWidth') ?? undefined, terrainMode: query.get('terrain') === 'raw' ? 'raw' : 'harmonized' }));
const seamView = new SeamView(scene);
const views = new Map(); // chunkId → { chunk, network, buildings, label, solid }
const state = { selected: query.get('select') && grid.chunks.has(query.get('select')) ? query.get('select') : 'chunk_0_0', seams: query.get('seams') === '1', busy: false, lastBuild: null, seamReport: null };

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
    const started = performance.now();
    const perChunk = [];
    for (const { chunkId } of dirty) {
      document.querySelector('#statusText').textContent = `GENERATING ${chunkId}`;
      await nextFrame();
      const t0 = performance.now();
      const ran = grid.build(chunkId);
      const t1 = performance.now();
      renderChunk(chunkId, ran);
      perChunk.push({ chunkId, ran, dataMs: Math.round(t1 - t0), renderMs: Math.round(performance.now() - t1) });
    }
    const seamInput = [...grid.chunks.values()].filter(c => c.terrain).map(c => ({ slot: c.slot, fields: c.terrain.fields, network: c.city && !c.city.empty ? c.city.network : null, waterType: c.terrain.harmony?.waterType ?? null }));
    state.seamReport = checkSeams(seamInput, grid.harmony.report);
    seamView.update(state.seamReport, new Map(seamInput.map(c => [c.slot.chunkId, c])));
    seamView.setVisible(state.seams);
    state.lastBuild = { prepare: { raw: prepare.raw, harmony: prepare.harmony, harmonyMs: Math.round(prepare.harmonyMs), ms: prepare.ms }, chunks: perChunk, totalMs: Math.round(performance.now() - prepareStarted) };
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
const ui = { worldSeed: grid.world.worldSeed, chunk: state.selected, city: 'auto', seams: state.seams, transitionWidth: grid.world.transitionWidth, terrainMode: grid.world.terrainMode };
// World options: rebuild from the saved form so seeds are re-derived, never carried over.
function setWorldOptions(options) {
  const saved = serialiseWorld(grid.world);
  grid.setWorld(createWorldConfig({ ...saved, ...options, slots: saved.slots.map(({ terrainSeed, ...rest }) => rest) }));
  Object.assign(ui, { worldSeed: grid.world.worldSeed, transitionWidth: grid.world.transitionWidth, terrainMode: grid.world.terrainMode });
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  return rebuild();
}
const gui = new GUI({ title: 'World Grid', container: document.querySelector('#gui') });
gui.add(ui, 'worldSeed', 1, 99999, 1).name('World seed').onFinishChange(value => setWorldOptions({ worldSeed: value }));
gui.add(ui, 'terrainMode', { 'Harmonised seams': 'harmonized', 'Raw chunks (06.2)': 'raw' }).name('Terrain').onChange(value => setWorldOptions({ terrainMode: value }));
gui.add(ui, 'transitionWidth', 32, 256, 16).name('Transition width (m)').onFinishChange(value => setWorldOptions({ transitionWidth: value }));
const chunkController = gui.add(ui, 'chunk', grid.world.slots.map(slot => slot.chunkId)).name('Selected chunk').onChange(select);
const cityController = gui.add(ui, 'city', cityOptions).name('City ID').onChange(value => setCity(state.selected, value === 'empty' ? null : value));
gui.add(ui, 'seams').name('Seam debug').onChange(value => { state.seams = value; seamView.setVisible(value); });
gui.add({ top: () => setCamera('top') }, 'top').name('Top view');
gui.add({ axo: () => setCamera('axo') }, 'axo').name('Oblique view');
gui.add({ save: () => saveConfig() }, 'save').name('Save city config');
gui.add({ restore: () => restoreConfig() }, 'restore').name('Restore city config');

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
  ui.worldSeed = grid.world.worldSeed;
  gui.controllersRecursive().forEach(c => c.updateDisplay());
  select(state.selected);
  document.querySelector('#saveState').textContent = 'restored';
  return rebuild();
}

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
    return `<li>${other}: ${join} · Δh max ${p.height.max} m · kink max ${p.slope.kinkMaxDeg}° (median ${p.slope.kinkMedianDeg}°) · band slope max ${p.slope.bandMaxSlopeDeg}° · ${water} · ports ${p.ports.matched.length} paired, ${p.ports.unmatchedA.length + p.ports.unmatchedB.length} unpaired</li>`;
  }).join('');
  const b = state.lastBuild;
  const ready = [...grid.chunks.values()].filter(c => c.status.startsWith('ready')).length;
  const h = grid.harmony?.report;
  const joined = h ? `${h.edges.filter(e => e.status === 'resolved').length} / ${h.edges.length} edges joined, ${h.corners.filter(c => c.closed).length} / ${h.corners.length} corners closed` : 'raw chunks (no harmonisation)';
  document.querySelector('#worldInfo').textContent = `world seed ${grid.world.worldSeed} · ${ready} / 9 chunks ready · transition ${grid.world.transitionWidth} m · ${joined}${b ? ` · last build ${b.chunks.length} chunk(s) in ${b.totalMs} ms (harmonisation ${b.prepare.harmony ? `${b.prepare.harmonyMs} ms` : 'cached'})` : ''}`;
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
    const { harmonizeWorld } = await import('./TerrainHarmonizer.js');
    const { checksum } = await import('../cellular-noise/noise.js');
    const sumOf = a => checksum(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    const input = [...grid.chunks.values()].map(c => ({ chunkId: c.slot.chunkId, gridX: c.slot.gridX, gridY: c.slot.gridY, landform: c.slot.landform, grid: c.raw.chunk.grid, height: c.raw.chunk.height, waterSurface: c.raw.chunk.waterSurface }));
    const sig = report => [...report.chunks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, o]) => `${id}:${sumOf(o.height)}:${sumOf(o.waterSurface)}`).join(',');
    const current = sig(grid.harmony.report);
    const reversed = sig(harmonizeWorld([...input].reverse(), grid.world.transitionWidth));
    const rotated = sig(harmonizeWorld([...input.slice(4), ...input.slice(0, 4)], grid.world.transitionWidth));
    return { identical: current === reversed && current === rotated, current, reversed, rotated };
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
rebuild();
