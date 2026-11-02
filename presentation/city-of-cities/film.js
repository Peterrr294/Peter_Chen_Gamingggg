// A City of Cities — presentation film (PRESENTATION-01).
// Builds the real world of seed 6201 with the unchanged generators (WorldContext + verified G02 WorldGrowthController),
// renders every film frame deterministically from a timeline (no real-time recording), draws the typography on a 2D
// compositing canvas and encodes H.264 in the page (WebCodecs + mp4-muxer). Nothing in experiments/ is modified.
import * as THREE from 'three';
import { ChunkView } from '../../experiments/seed-terrain/ChunkView.js';
import { NetworkView } from '../../experiments/seed-terrain/NetworkView.js';
import { BuildingView } from '../../experiments/seed-terrain/BuildingView.js';
import { createSampler } from '../../experiments/seed-terrain/NetworkGenerator.js';
import { WorldContext } from '../../experiments/city-of-cities/WorldContext.js';
import { WorldGrowthController } from '../../experiments/city-of-cities/WorldGrowthController.js';
import { CHUNK_SIZE, CITY_COLOR } from '../../experiments/city-of-cities/originConfig.js';

const W = 1920; const H = 1080; const FPS = 30; const DURATION = 75;
const BG = '#0f1215';
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const NAMES = { veniceWaterNetwork: 'VENICE', manhattanGrid: 'MANHATTAN', fezOrganicCore: 'FEZ', amsterdamCanalRing: 'AMSTERDAM', lisbonHillCore: 'LISBON', chicagoGrid: 'CHICAGO' };
const PANEL_ORDER = ['veniceWaterNetwork', 'manhattanGrid', 'fezOrganicCore', 'amsterdamCanalRing', 'lisbonHillCore', 'chicagoGrid'];
const CONFIG = {
  title: 'A CITY OF CITIES', subtitle: 'The Emergence of a Plural Urban World through Procedural Growth',
  worldSeed: 6201, growthSteps: 30, focusCity: 'lisbonHillCore', width: W, height: H, fps: FPS, duration: DURATION,
  codec: 'avc1.640028 (H.264 High, level 4.0)', bitrate: 8_000_000, background: BG,
  camera: { type: 'orthographic axonometric', elevationDeg: 32 },
};

// Muted city colours (the project palette mixed 35 % toward grey; identical in every scene).
const grey = new THREE.Color('#9aa0a6');
const COLOR = Object.fromEntries(Object.entries(CITY_COLOR).map(([id, hex]) => [id, new THREE.Color(hex).lerp(grey, 0.35)]));
const css = c => `#${c.getHexString()}`;

// ---------- Renderer, scene, cameras ----------
const gl = document.createElement('canvas'); gl.width = W; gl.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(BG);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xdfe9ee, 0x1b2320, 2.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.8); sun.position.set(-2400, 3600, 1800); scene.add(sun);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200000);
const film = document.querySelector('#film');
const ctx = film.getContext('2d');
const status = msg => { document.querySelector('#status').textContent = msg; };
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

const EL = THREE.MathUtils.degToRad(CONFIG.camera.elevationDeg);
const dirOf = azDeg => { const az = THREE.MathUtils.degToRad(azDeg); return new THREE.Vector3(Math.sin(az) * Math.cos(EL), Math.sin(EL), Math.cos(az) * Math.cos(EL)); };
function setCamera(cam, { target, h, az }, aspect = W / H) {
  cam.left = -h * aspect / 2; cam.right = h * aspect / 2; cam.top = h / 2; cam.bottom = -h / 2;
  cam.position.copy(target).addScaledVector(dirOf(az), 40000);
  cam.up.set(0, 1, 0); cam.lookAt(target); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}
// Orthographic height that fits a world box (all 8 corners projected on the camera axes) at azimuth az.
function fitBox(box, az, aspect = W / H, margin = 1.12) {
  const target = new THREE.Vector3((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
  const d = dirOf(az); const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize(); const up = new THREE.Vector3().crossVectors(d, right);
  let rx = 0; let uy = 0;
  for (const x of [box.minX, box.maxX]) for (const y of [box.minY, box.maxY]) for (const z of [box.minZ, box.maxZ]) {
    const v = new THREE.Vector3(x, y, z).sub(target); rx = Math.max(rx, Math.abs(v.dot(right))); uy = Math.max(uy, Math.abs(v.dot(up)));
  }
  return { target, h: Math.max(2 * uy, (2 * rx) / aspect) * margin, az };
}
const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const span = (t, a, b) => ease((t - a) / (b - a));
const fade = (t, a, b, c, d) => Math.min(span(t, a, b), 1 - span(t, c, d)); // in a→b, out c→d
const lerpCam = (A, B, k) => ({ target: A.target.clone().lerp(B.target, k), h: A.h + (B.h - A.h) * k, az: A.az + (B.az - A.az) * k });

// ---------- World (real generators) ----------
const entries = []; // { chunk, step, views: { terrain, network, buildings }, outline, maxY, minY }
let world; let lisbon; let history = []; let boxes; let closeChunk;
function addChunk(chunk, layers) {
  const { terrain, city } = layers;
  const views = { terrain: new ChunkView(scene), network: new NetworkView(scene), buildings: new BuildingView(scene) };
  views.terrain.update(terrain.fields, terrain.config, 'classes', terrain.analysis, null, null);
  views.network.update(city.network, createSampler(terrain.fields).height);
  views.network.markers.visible = false; // screen-sized port markers are debug UI, not geometry
  views.buildings.update(city.buildings);
  const { maxHeight, minHeight } = terrain.fields.stats;
  const r = CHUNK_SIZE / 2 - 4; const { x, z } = chunk.worldOrigin; const y = maxHeight + 8;
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(x + a * r, y, z + b * r))), new THREE.LineBasicMaterial({ color: COLOR[chunk.cityId].clone(), transparent: true, opacity: 0.9 }));
  scene.add(outline);
  const entry = { chunk, step: chunk.growthStep, views, outline, maxY: maxHeight, minY: minHeight, layers: chunk.cityId === CONFIG.focusCity && chunk.role === 'core' ? layers : null };
  entries.push(entry);
  return entry;
}

async function prepare() {
  const started = performance.now();
  status('placing six city origins (G01)…'); await nextFrame();
  world = new WorldContext({ worldSeed: CONFIG.worldSeed });
  const report = world.initialise();
  if (report.failures.length) throw new Error(`placement failed: ${JSON.stringify(report.failures)}`);
  for (const id of [...world.chunks.keys()].sort()) {
    status(`generating core ${id}…`); await nextFrame();
    const { chunk, layers } = world.generateChunk(id);
    addChunk(chunk, layers);
  }
  // Pipeline stage views of the focus core (same chunk, same seed; existing ChunkView debug colourings).
  const focus = entries.find(e => e.layers);
  const { terrain, city } = focus.layers;
  const stageView = view => { const v = new ChunkView(scene); v.update(terrain.fields, terrain.config, view, terrain.analysis, city.blocks, city.parcels); v.root.visible = false; return v; };
  const parcelsView = stageView('parcels');
  // Presentation palette only: the debug colouring paints parcel-free land inside blocks (interior reserve, index −5)
  // bright magenta; the film shows it in neutral grey so the parcels read. Geometry and data are unchanged.
  const reserveGrey = new THREE.Color('#59615c'); const colors = parcelsView.terrain.geometry.attributes.color;
  city.parcels.terrainParcelIndex.forEach((v, i) => { if (v === -5) reserveGrey.toArray(colors.array, i * 3); });
  colors.needsUpdate = true;
  lisbon = { entry: focus, suitability: stageView('suitability'), blocks: stageView('blocks'), parcels: parcelsView, counts: { roadKm: +(city.network.stats.roadLength / 1000).toFixed(1), blocks: city.blocks.stats.blocks, parcels: city.parcels.stats.parcels, buildings: city.buildings.stats.buildings } };
  // Real G02 growth: 30 steps of the verified controller, one chunk per step.
  const growth = new WorldGrowthController(world);
  for (let k = 1; k <= CONFIG.growthSteps; k += 1) {
    status(`growth step ${k} / ${CONFIG.growthSteps}…`); await nextFrame();
    const r = growth.step();
    if (r.stalled) throw new Error(`growth stalled at step ${k}`);
    addChunk(r.chunk, r.layers);
  }
  history = world.growth.history.map(e => ({ step: e.step, chunkId: e.newChunkId, cityId: e.cityId, parent: e.parentChunkId, score: e.selectionScore, buildings: e.outputs.counts.buildings }));
  const boxOf = list => ({ minX: Math.min(...list.map(e => e.chunk.worldOrigin.x)) - CHUNK_SIZE / 2, maxX: Math.max(...list.map(e => e.chunk.worldOrigin.x)) + CHUNK_SIZE / 2, minZ: Math.min(...list.map(e => e.chunk.worldOrigin.z)) - CHUNK_SIZE / 2, maxZ: Math.max(...list.map(e => e.chunk.worldOrigin.z)) + CHUNK_SIZE / 2, minY: Math.min(...list.map(e => e.minY)), maxY: Math.max(...list.map(e => e.maxY)) });
  boxes = { focus: boxOf([focus]), cores: boxOf(entries.filter(e => e.step === 0)), all: boxOf(entries) };
  closeChunk = entries.filter(e => e.step > 0).sort((a, b) => b.chunk.outputs.counts.buildings - a.chunk.outputs.counts.buildings)[0];
  boxes.close = boxOf(entries.filter(e => Math.abs(e.chunk.worldCoordinate.gx - closeChunk.chunk.worldCoordinate.gx) <= 1 && Math.abs(e.chunk.worldCoordinate.gy - closeChunk.chunk.worldCoordinate.gy) <= 1));
  status(`ready · ${entries.length} chunks · ${Math.round((performance.now() - started) / 1000)} s`);
  return { chunks: entries.length, history, ms: Math.round(performance.now() - started), focusChunk: focus.chunk.chunkId, closeChunk: closeChunk.chunk.chunkId };
}

// ---------- Timeline ----------
// Growth step k becomes visible at stepTime(k): 1–5 every 1.0 s, 6–10 every 0.6 s, 11–30 every 0.4 s.
const stepTime = k => (k <= 5 ? 44 + (k - 1) : k <= 10 ? 49 + (k - 6) * 0.6 : 52 + (k - 11) * 0.4);
const STAGES = [['01', 'TERRAIN', 'height, water, slope'], ['02', 'TERRAIN ANALYSIS', 'buildable land by slope class'], ['03', 'ROAD NETWORK', 'City DNA street strategy'], ['04', 'URBAN BLOCKS', 'land enclosed by roads'], ['05', 'PARCELS', 'road-fronting lots (grey: interior land without lots)'], ['06', 'BUILDINGS', 'volumes extruded on parcels']];
const STAGE_START = 12; const STAGE_LEN = 16 / 6;

const cams = () => {
  const focus = (az, m) => fitBox(boxes.focus, az, W / H, m);
  return {
    s1a: focus(28, 1.32), s1b: focus(38, 1.22), s2a: focus(38, 1.22), s2b: focus(52, 1.22),
    cores: fitBox(boxes.cores, 45, W / H, 1.08), all: fitBox(boxes.all, 45, W / H, 1.06), allWide: fitBox(boxes.all, 45, W / H, 1.12),
    close: fitBox(boxes.close, 30, W / H, 1.0),
  };
};

function setVisibility({ maxStep = 0, only = null, stage = null, outlines = false, t = null }) {
  for (const e of entries) {
    const vis = e.step <= maxStep && (!only || e.chunk.chunkId === only);
    const isFocus = lisbon.entry === e;
    const s = stage !== null && isFocus ? stage : null;
    e.views.terrain.root.visible = vis && (s === null || s === 0 || s === 2 || s === 5);
    e.views.network.root.visible = vis && (s === null || s >= 2);
    e.views.buildings.root.visible = vis && (s === null || s >= 5);
    // Growth animation: a new chunk rises from the datum over 0.35 s at its real step time.
    const k = t !== null && e.step > 0 ? ease((t - stepTime(e.step)) / 0.35) : 1;
    for (const root of [e.views.terrain.root, e.views.network.root, e.views.buildings.root]) root.scale.y = Math.max(0.002, k);
    e.outline.visible = vis && outlines;
    const flash = t !== null && e.step > 0 ? 1 - ease((t - stepTime(e.step)) / 0.9) : 0;
    e.outline.material.color.copy(COLOR[e.chunk.cityId]).lerp(new THREE.Color('#ffffff'), Math.max(0, flash));
  }
  lisbon.suitability.root.visible = stage === 1;
  lisbon.blocks.root.visible = stage === 3;
  lisbon.parcels.root.visible = stage === 4;
}
const visibleStep = t => { let n = 0; for (let k = 1; k <= CONFIG.growthSteps; k += 1) if (t >= stepTime(k)) n = k; return n; };

// ---------- 2D typography ----------
function text(str, x, y, { size = 28, weight = 400, color = '#f2f4f5', alpha = 1, align = 'left', spacing = 0 } = {}) {
  if (alpha <= 0.001) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(6, 8, 10, 0.9)'; ctx.shadowBlur = size > 24 ? 14 : 8; // legible over geometry
  ctx.letterSpacing = `${spacing}px`; ctx.fillText(str, x, y); ctx.restore();
}
const caption = (str, alpha) => text(str, W / 2, H - 92, { size: 34, weight: 300, alpha, align: 'center', spacing: 0.5 });
const tag = (str, alpha, x = 64, y = H - 40) => text(str, x, y, { size: 17, weight: 600, color: '#9aa3a8', alpha, spacing: 2.4 });
function cityLabels(alpha, list = entries.filter(e => e.step === 0)) {
  if (alpha <= 0.001) return;
  for (const e of list) {
    const p = new THREE.Vector3(e.chunk.worldOrigin.x, e.maxY + 40, e.chunk.worldOrigin.z).project(camera);
    const x = (p.x + 1) / 2 * W; const y = (1 - p.y) / 2 * H - 18;
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = css(COLOR[e.chunk.cityId]); ctx.beginPath(); ctx.arc(x - 12, y - 7, 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    text(NAMES[e.chunk.cityId], x, y, { size: 20, weight: 600, alpha, spacing: 2.5 });
  }
}
function legend(alpha) {
  let x = W - 64;
  for (const id of [...PANEL_ORDER].reverse()) {
    ctx.save(); ctx.font = `600 15px ${FONT}`; ctx.letterSpacing = '2px'; const w = ctx.measureText(NAMES[id]).width; ctx.restore();
    x -= w; text(NAMES[id], x, H - 40, { size: 15, weight: 600, color: '#c3c9cc', alpha, spacing: 2 });
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = css(COLOR[id]); ctx.fillRect(x - 20, H - 52, 12, 12); ctx.restore();
    x -= 44;
  }
}

// ---------- Frame rendering ----------
function draw3D(alpha, setup) {
  if (alpha <= 0.001) return;
  setup();
  renderer.render(scene, camera);
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(gl, 0, 0); ctx.restore();
}
function drawPanels(alpha, t) {
  if (alpha <= 0.001) return;
  const cols = 3; const pw = W / cols; const ph = H / 2;
  setVisibility({ maxStep: 0, outlines: false });
  renderer.setScissorTest(true);
  renderer.setClearColor(BG);
  PANEL_ORDER.forEach((id, i) => {
    const e = entries.find(x => x.step === 0 && x.chunk.cityId === id);
    const col = i % cols; const row = Math.floor(i / cols);
    renderer.setViewport(col * pw, H - (row + 1) * ph, pw, ph); renderer.setScissor(col * pw, H - (row + 1) * ph, pw, ph);
    const box = { minX: e.chunk.worldOrigin.x - CHUNK_SIZE / 2, maxX: e.chunk.worldOrigin.x + CHUNK_SIZE / 2, minZ: e.chunk.worldOrigin.z - CHUNK_SIZE / 2, maxZ: e.chunk.worldOrigin.z + CHUNK_SIZE / 2, minY: e.minY, maxY: e.maxY };
    setCamera(camera, fitBox(box, 40 + (t - 34) * 1.2, pw / ph, 1.02), pw / ph);
    renderer.render(scene, camera);
  });
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(gl, 0, 0); ctx.restore();
  // Panel captions + thin dividers.
  PANEL_ORDER.forEach((id, i) => {
    const e = entries.find(x => x.step === 0 && x.chunk.cityId === id);
    const x0 = (i % cols) * pw; const y0 = Math.floor(i / cols) * ph;
    const c = e.chunk.outputs.counts;
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = css(COLOR[id]); ctx.fillRect(x0 + 32, y0 + 34, 12, 12); ctx.restore();
    text(NAMES[id], x0 + 54, y0 + 46, { size: 21, weight: 600, alpha, spacing: 3 });
    text(`CITY ID ${id} · ${e.chunk.terrainType.toUpperCase()}`, x0 + 32, y0 + 72, { size: 14, weight: 600, color: '#9aa3a8', alpha, spacing: 1.6 });
    text(`${c.roadKm} km roads · ${c.blocks} blocks · ${c.parcels} parcels · ${c.buildings} buildings`, x0 + 32, y0 + ph - 26, { size: 15, weight: 400, color: '#c3c9cc', alpha, spacing: 0.4 });
  });
  ctx.save(); ctx.globalAlpha = alpha * 0.6; ctx.strokeStyle = '#3a4248'; ctx.lineWidth = 2;
  for (let c = 1; c < cols; c += 1) { ctx.beginPath(); ctx.moveTo(c * pw, 0); ctx.lineTo(c * pw, H); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, ph); ctx.lineTo(W, ph); ctx.stroke(); ctx.restore();
}

function renderFrame(t) {
  const C = cams();
  ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); ctx.restore();

  // TITLE 0–4
  if (t < 4.2) {
    text(CONFIG.title, W / 2, H / 2 - 10, { size: 92, weight: 300, alpha: fade(t, 0.3, 1.4, 3.3, 4.0), align: 'center', spacing: 18 });
    text(CONFIG.subtitle, W / 2, H / 2 + 58, { size: 28, weight: 300, color: '#b8c0c4', alpha: fade(t, 1.0, 2.0, 3.3, 4.0), align: 'center', spacing: 1 });
    text('PROCEDURAL MINI WORLD · RESEARCH FILM', W / 2, H - 70, { size: 15, weight: 600, color: '#7d878c', alpha: fade(t, 1.4, 2.2, 3.3, 4.0), align: 'center', spacing: 3 });
  }
  // S1 4–12: the land before the city (focus core, terrain only)
  if (t >= 3.8 && t < 12) {
    const a = span(t, 4.0, 5.2);
    draw3D(span(t, 4.0, 5.2), () => { setVisibility({ only: lisbon.entry.chunk.chunkId, stage: 0 }); setCamera(camera, lerpCam(C.s1a, C.s1b, span(t, 4, 12))); });
    caption('Every urban world begins with a landscape.', fade(t, 5.4, 6.4, 11.2, 11.9));
    tag(`TERRAIN · WORLD SEED ${CONFIG.worldSeed} · CHUNK ${lisbon.entry.chunk.chunkId} · ${lisbon.entry.chunk.terrainType.toUpperCase()} · 1024 × 1024 M`, a * (1 - span(t, 11.5, 12)));
  }
  // S2 12–28: from terrain to urban DNA (same chunk, same seed, stage by stage)
  if (t >= 12 && t < 28.6) {
    const k = Math.min(5, Math.floor((t - STAGE_START) / STAGE_LEN));
    const local = (t - STAGE_START) - k * STAGE_LEN;
    const cam = lerpCam(C.s2a, C.s2b, span(t, 12, 28));
    const xf = k > 0 ? span(local, 0, 0.5) : 1; // crossfade from the previous stage (stage 01 continues S01's image)
    if (k > 0 && xf < 1) draw3D(1, () => { setVisibility({ only: lisbon.entry.chunk.chunkId, stage: k - 1 }); setCamera(camera, cam); });
    draw3D(xf, () => { setVisibility({ only: lisbon.entry.chunk.chunkId, stage: k }); setCamera(camera, cam); });
    const a = fade(t, 11.9, 12.6, 27.6, 28.3);
    STAGES.forEach(([n, name], i) => {
      const on = i === k; const done = i < k;
      text(`${n}  ${name}`, 64 + i * 300, 74, { size: 17, weight: on ? 700 : 500, color: on ? '#ffffff' : done ? '#8f989d' : '#4f585d', alpha: a, spacing: 2.2 });
    });
    text(STAGES[k][2], 64 + k * 300, 100, { size: 16, weight: 400, color: '#b8c0c4', alpha: a * span(local, 0.2, 0.7), spacing: 0.5 });
    caption('Urban form emerges from spatial rules.', fade(t, 13.0, 14.0, 27.0, 27.8));
    tag(`CITY ID: LISBON · SAME CHUNK, SAME SEED ${CONFIG.worldSeed} · ${lisbon.counts.roadKm} KM ROADS · ${lisbon.counts.blocks} BLOCKS · ${lisbon.counts.parcels} PARCELS · ${lisbon.counts.buildings} BUILDINGS`, a);
  }
  // S3 28–42: six autonomous origins (pull-out, then six panels)
  if (t >= 28 && t < 42.6) {
    const pull = span(t, 28.3, 33.2);
    const wa = t < 34.6 ? (t < 28.6 ? span(t, 28, 28.6) : 1 - span(t, 33.8, 34.6)) : 0;
    draw3D(wa, () => { setVisibility({ maxStep: 0, outlines: true }); setCamera(camera, lerpCam(C.s2b, C.cores, pull)); });
    if (wa > 0) cityLabels(wa * span(t, 31.0, 32.2));
    drawPanels(t >= 41.8 ? 1 - span(t, 41.8, 42.6) : span(t, 33.8, 34.6), t);
    caption('Six cities. Six distinct urban identities.', fade(t, 29.2, 30.2, 41.2, 42.0));
    tag(`G01 · SIX CITY ORIGINS · WORLD SEED ${CONFIG.worldSeed} · PLACED BY TERRAIN SUITABILITY, NOT A 3 × 3 GRID`, fade(t, 28.6, 29.4, 33.4, 34.0));
  }
  // S4 42–62: procedural urban growth (fixed camera on the final extent)
  if (t >= 41.8 && t < 62.6) {
    const n = visibleStep(t);
    const camS4 = { ...C.allWide, h: C.allWide.h * (1.04 - 0.04 * span(t, 42, 62)) };
    draw3D(t >= 61.8 ? 1 - span(t, 61.8, 62.6) : span(t, 41.8, 42.6), () => { setVisibility({ maxStep: n, outlines: true, t }); setCamera(camera, camS4); });
    const a = fade(t, 42.2, 43.0, 61.6, 62.4);
    cityLabels(a * 0.95);
    caption('Independent cities grow through local rules.', fade(t, 43.0, 44.0, 52.0, 52.8));
    caption('Collective form emerges without a predetermined master plan.', fade(t, 53.2, 54.2, 61.0, 61.8));
    text(`GROWTH STEP ${String(n).padStart(2, '0')} / ${CONFIG.growthSteps}`, 64, 82, { size: 30, weight: 300, alpha: a, spacing: 3 });
    text(`${6 + n} CHUNKS · ONE CHUNK PER STEP · WORLD SEED ${CONFIG.worldSeed}`, 64, 112, { size: 15, weight: 600, color: '#9aa3a8', alpha: a, spacing: 2 });
    const last = n > 0 ? history[n - 1] : null;
    if (last) text(`STEP ${last.step}: ${NAMES[last.cityId]} → ${last.chunkId}`, 64, 140, { size: 15, weight: 600, color: css(COLOR[last.cityId]), alpha: a, spacing: 2 });
    tag('G02 · PROCEDURAL GROWTH PROTOTYPE · REAL GENERATED CHUNKS', a);
    legend(a);
  }
  // S5 62–75: a city of cities (close → whole world)
  if (t >= 61.8) {
    const pull = span(t, 62.6, 70.4);
    draw3D(t >= 74.2 ? 1 - span(t, 74.2, 75) : span(t, 61.8, 62.6), () => { setVisibility({ maxStep: CONFIG.growthSteps, outlines: true }); setCamera(camera, lerpCam(C.close, C.all, pull)); });
    const a = fade(t, 70.2, 71.2, 74.2, 75);
    cityLabels(fade(t, 68.6, 69.6, 74.2, 75) * 0.95);
    text(CONFIG.title, 64, 112, { size: 60, weight: 300, alpha: a, spacing: 12 });
    text('Not a collection of cities,', 64, 168, { size: 28, weight: 300, color: '#d6dbde', alpha: a, spacing: 0.5 });
    text('but a world emerging through their relationships.', 64, 204, { size: 28, weight: 300, color: '#d6dbde', alpha: a, spacing: 0.5 });
    tag(`PROCEDURAL GROWTH PROTOTYPE · WORLD SEED ${CONFIG.worldSeed} · 6 ORIGINS · ${CONFIG.growthSteps} GROWTH STEPS · ${entries.length} CHUNKS`, a);
    tag(`CLOSE-UP START: ${NAMES[closeChunk.chunk.cityId]} ${closeChunk.chunk.chunkId} · GROWTH STEP ${closeChunk.step}`, fade(t, 62.4, 63.2, 67.6, 68.4), 64, 72); // top-left: empty sky during the pull-out
  }
}

// ---------- Export ----------
async function encode() {
  const total = Math.round(DURATION * FPS);
  const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: CONFIG.bitrate, framerate: FPS, avc: { format: 'avc' } });
  const started = performance.now();
  for (let i = 0; i < total; i += 1) {
    if (failure) throw failure;
    renderFrame(i / FPS);
    const frame = new VideoFrame(film, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 6) await new Promise(r => encoder.addEventListener('dequeue', r, { once: true }));
    if (i % 30 === 0) { status(`encoding ${i} / ${total} frames`); await nextFrame(); }
  }
  await encoder.flush(); encoder.close(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'A-City-of-Cities.mp4'; document.body.append(a); a.click();
  status(`encoded ${total} frames in ${Math.round((performance.now() - started) / 1000)} s · ${(blob.size / 1048576).toFixed(1)} MB`);
  return { frames: total, bytes: blob.size, ms: Math.round(performance.now() - started) };
}
const still = t => { renderFrame(t); return film.toDataURL('image/png'); };
function timeline() {
  return {
    scenes: [['TITLE', 0, 4], ['S01 The Land Before the City', 4, 12], ['S02 From Terrain to Urban DNA', 12, 28], ['S03 Six Autonomous Urban Origins', 28, 42], ['S04 Procedural Urban Growth', 42, 62], ['S05 A City of Cities', 62, 75]],
    stageTimes: STAGES.map(([n, name], i) => [name, +(STAGE_START + i * STAGE_LEN).toFixed(2)]),
    stepTimes: Array.from({ length: CONFIG.growthSteps }, (_, i) => [i + 1, +stepTime(i + 1).toFixed(2)]),
  };
}
function cameraInfo() {
  const C = cams(); const out = {};
  for (const [k, v] of Object.entries(C)) out[k] = { target: v.target.toArray().map(x => Math.round(x)), orthoHeight: Math.round(v.h), azimuthDeg: v.az, elevationDeg: CONFIG.camera.elevationDeg };
  return out;
}

window.__film = { config: CONFIG, prepare, renderFrame, still, encode, timeline, cameraInfo, history: () => history, ready: false, gpu: () => { const g = renderer.getContext(); const ext = g.getExtension('WEBGL_debug_renderer_info'); return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a'; } };
window.__film.ready = true;
status('ready to prepare (window.__film.prepare())');
