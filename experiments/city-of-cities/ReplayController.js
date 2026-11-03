import * as THREE from 'three';
import { BuildingView } from '../seed-terrain/BuildingView.js';
import { CHUNK_SIZE } from './originConfig.js';
import { portPoint } from './MorphologicalGrowth.js';
import { RampView } from './RampView.js';
import { STAGES, replayStages, revealOrder, roadOrigin } from './GrowthReplay.js';

// VIS-01a stage timeline of one committed growth event (render only). It shows the real geometry of the event chunk
// stage by stage and never generates: the chunk was generated once by the scheduler; the timeline only switches
// visibility, terrain colouring and overlays. t runs from 0 to 8 (one unit per stage).
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
const SECONDS_PER_STAGE = 2.5; const BUCKETS = 12;
const KIND = { recorded: ['Recorded generation event', '#7fe3a0'], reconstructed: ['Reconstructed state', '#9ecbff'], presentation: ['Presentation reveal', '#ffb020'] };
const disposeGroup = g => { g.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => m.dispose()); }); g.clear(); };
const post = (x, y, z, color, h = 120) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, h, 10), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.position.set(x, y + h / 2, z); m.renderOrder = 20; return m; };
const square = (gx, gy, y, color, dashed) => {
  const h = CHUNK_SIZE / 2 - 40; const x = gx * CHUNK_SIZE; const z = gy * CHUNK_SIZE;
  const pts = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([u, v]) => new THREE.Vector3(x + u, y, z + v));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dashed ? new THREE.LineDashedMaterial({ color, dashSize: 50, gapSize: 35, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false }));
  if (dashed) l.computeLineDistances(); l.renderOrder = 19; return l;
};

export class ReplayController {
  constructor({ scene, world, event, layers, view, chunkTop, mount }) {
    Object.assign(this, { world, event, layers, view });
    this.chunk = world.chunks.get(event.newChunkId);
    this.stages = replayStages(world, event, layers);
    this.t = 0; this.speed = 1; this.playing = false; this.mode = null;
    this.top = chunkTop ?? 0;
    this.groups = { cells: new THREE.Group(), fronts: new THREE.Group(), joins: new THREE.Group() };
    for (const g of Object.values(this.groups)) { g.name = `VIS-01a ${g.name}`; scene.add(g); }
    this.ramps = new RampView(scene);
    this.ramps.update([event], id => world.chunks.get(id), () => layers.city.network.edges.map(e => ({ id: e.id, points: e.points, ramp: e.ramp ?? null })));
    // Buildings in reproducible buckets (presentation order), the real geometry of the event chunk.
    const anchors = event.connections.map(c => portPoint(world.chunks.get(c.parent.chunkId), c.connectionId.split(':')[2], Number(c.connectionId.split(':')[3])));
    const ordered = revealOrder(layers.city.buildings.buildings, anchors);
    this.bucketSizes = []; this.buckets = [];
    for (let k = 0; k < BUCKETS; k += 1) {
      const list = ordered.slice(Math.floor((k * ordered.length) / BUCKETS), Math.floor(((k + 1) * ordered.length) / BUCKETS));
      const bv = new BuildingView(scene); bv.update({ ...layers.city.buildings, buildings: list }); bv.root.visible = false;
      this.buckets.push(bv); this.bucketSizes.push(list.length);
    }
    this.buildOverlays();
    this.buildPanel(mount);
    this.seek(0);
    this.last = performance.now();
    const tick = now => { const dt = (now - this.last) / 1000; this.last = now; if (this.playing) { this.seek(Math.min(8, this.t + (dt * this.speed) / SECONDS_PER_STAGE)); if (this.t >= 8) this.setPlaying(false); } this.raf = requestAnimationFrame(tick); };
    this.raf = requestAnimationFrame(tick);
  }

  buildOverlays() {
    const e = this.event; const w = this.world; const y = this.top + 30;
    // Candidate cells of the growing city (recorded): selected solid green, refused dashed red.
    for (const c of e.rejectedCandidates?.[e.cityId] ?? []) { const [, , gx, gy] = c.candidateId.split(':').map((v, i) => (i >= 2 ? Number(v) : v)); this.groups.cells.add(square(gx, gy, y, 0xff4d4d, true)); }
    this.groups.cells.add(square(e.targetCoordinate.gx, e.targetCoordinate.gy, y, 0x3fd17a, false));
    // Road ends offered by the parent (recorded in the chunk's generation parameters): usable green, refused red.
    const ctx = this.chunk.generationParameters.growthContext ?? {}; const usable = new Set((ctx.entryPorts ?? []).map(p => p.connectionId));
    for (const v of ctx.vertical?.entries ?? (ctx.entryPorts ?? []).map(p => ({ ...p, side: ctx.side, position: ctx.side.endsWith('X') ? p.point.z : p.point.x, parentChunkId: e.parentChunkId }))) {
      const src = w.chunks.get(v.parentChunkId); const side = v.connectionId.split(':')[2];
      const pt = portPoint(src, side, Number(v.connectionId.split(':')[3]));
      this.groups.fronts.add(post(pt.x, y, pt.z, usable.has(v.connectionId) ? 0xffa53f : 0xff4d4d, 150));
    }
    for (const c of [...e.connections, ...(e.neighbourConnections ?? [])]) { const pt = portPoint(w.chunks.get(c.parent.chunkId), c.connectionId.split(':')[2], Number(c.connectionId.split(':')[3])); this.groups.joins.add(post(pt.x, y, pt.z, 0x3fe0ff, 200)); }
  }

  buildPanel(mount) {
    const el = document.createElement('div'); el.className = 'replay-panel';
    el.style.cssText = 'position:relative;margin:8px 0 0;background:rgba(12,16,19,0.92);color:#e6e9eb;font:13px/1.4 "Segoe UI",Arial;padding:10px 12px;border:1px solid #2c363c;border-radius:6px';
    el.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <b id="rpTitle"></b><span id="rpKind" style="padding:1px 6px;border-radius:3px;font-size:12px"></span>
      <span style="flex:1"></span>
      <button id="rpPrev" title="Previous stage">◀</button><button id="rpPlay">Play</button><button id="rpNext" title="Next stage">▶</button>
      <select id="rpSpeed">${SPEEDS.map(s => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s}×</option>`).join('')}</select></div>
      <input id="rpSlider" type="range" min="0" max="8" step="0.01" value="0" style="width:100%;margin:6px 0">
      <div id="rpStages" style="display:flex;gap:4px;flex-wrap:wrap;font-size:12px"></div>
      <details id="rpInspector" open style="margin-top:6px"><summary>Algorithm Inspector</summary><div id="rpInfo" style="display:grid;grid-template-columns:150px 1fr;gap:2px 10px;margin-top:4px"></div></details>
      <div id="rpPick" style="margin-top:4px;color:#cfe8ff"></div>`;
    mount.insertAdjacentElement('afterend', el); this.el = el; // directly under the 3D view, like a player's controls
    const $ = id => el.querySelector(id);
    $('#rpStages').innerHTML = STAGES.map((s, i) => `<button data-i="${i}" style="font-size:12px">${i + 1} ${s.title}</button>`).join('');
    $('#rpStages').addEventListener('click', ev => { const i = ev.target.dataset?.i; if (i !== undefined) this.seek(Number(i) + (Number(i) === 6 ? 0.999 : 0)); });
    $('#rpPrev').onclick = () => { this.setPlaying(false); this.seek(Number.isInteger(this.t) ? Math.max(0, this.t - 1) : Math.floor(this.t)); };
    $('#rpNext').onclick = () => { this.setPlaying(false); this.seek(Math.min(8, Math.floor(this.t) + 1)); };
    $('#rpPlay').onclick = () => this.setPlaying(!this.playing);
    $('#rpSpeed').onchange = ev => { this.speed = Number(ev.target.value); };
    $('#rpSlider').oninput = ev => { this.setPlaying(false); this.seek(Number(ev.target.value)); };
  }

  setPlaying(on) { if (on && this.t >= 8) this.t = 0; this.playing = on; this.el.querySelector('#rpPlay').textContent = on ? 'Pause' : 'Play'; }

  // State of the scene at time t; pure function of t (seeking back and forth gives the same picture).
  seek(t) {
    this.t = t; const i = Math.min(7, Math.floor(t)); const f = t >= 8 ? 1 : t - i; const s = this.stages[i];
    const v = this.view; const { fields, config, analysis } = this.layers.terrain;
    const mode = i <= 0 ? null : i === 1 ? 'suitability' : i === 4 ? 'blocks' : i === 5 ? 'parcels' : 'classes';
    if (mode && mode !== this.mode) { v.chunk.update(fields, config, mode, analysis, this.layers.city.blocks, this.layers.city.parcels); this.mode = mode; }
    v.chunk.root.visible = i >= 1; v.network.root.visible = i >= 3; v.label.visible = i >= 7;
    v.buildings.root.visible = i >= 7;
    const shown = i < 6 ? 0 : i === 6 ? Math.floor(f * BUCKETS) : 0;
    this.buckets.forEach((b, k) => { b.root.visible = i === 6 && k < shown; });
    this.groups.cells.visible = i === 1 || i === 2; this.groups.fronts.visible = i === 2 || i === 3; this.groups.joins.visible = i >= 7;
    this.ramps.setVisible({ rampAccepted: i === 3, rampRejected: i === 3, rampSeam: i === 3, rampLabels: false });
    this.visibleBuildings = i >= 7 ? this.layers.city.buildings.buildings.length : this.bucketSizes.slice(0, shown).reduce((a, b) => a + b, 0);
    this.stage = s;
    const $ = id => this.el.querySelector(id);
    $('#rpTitle').textContent = `Seed ${this.world.worldSeed} · step ${this.event.step} · ${this.event.cityId} · ${this.event.parentChunkId} → ${this.event.newChunkId} · stage ${i + 1} of 8: ${s.title}`;
    $('#rpKind').textContent = KIND[s.kind][0]; $('#rpKind').style.background = KIND[s.kind][1]; $('#rpKind').style.color = '#0c1013';
    $('#rpSlider').value = String(t);
    $('#rpInfo').innerHTML = [['World seed', this.world.worldSeed], ['Growth step', this.event.step], ['City ID', this.event.cityId], ['Chunk', `${this.event.newChunkId} (parent ${this.event.parentChunkId})`], ['Algorithm', s.algorithm], ['Input', s.input], ['Parameters', s.parameters], ['Decision', s.decision], ['Output', s.output + (i === 6 ? ` · shown ${this.visibleBuildings}` : '')], ['Validation', s.validation], ['Source', s.source]].map(([k, val]) => `<span style="color:#9aa3a8">${k}</span><span>${String(val).replace(/</g, '&lt;')}</span>`).join('');
    [...$('#rpStages').children].forEach((b, k) => { b.style.background = k === i ? '#3fd17a' : ''; b.style.color = k === i ? '#0c1013' : ''; });
  }

  // A clicked road of the new chunk (edge id from the road mesh name): where it came from.
  pick(edgeId) { const o = roadOrigin(this.event, edgeId); this.el.querySelector('#rpPick').textContent = `Road ${o.road}: continued from ${o.continuedFrom} · connection ${o.connectionId} · class ${o.roadClass} · ramp ${o.ramp} · ${o.decision} · source ${o.source}`; return o; }

  state() { return { t: this.t, stage: this.stage.id, kind: this.stage.kind, visibleBuildings: this.visibleBuildings, totalBuildings: this.layers.city.buildings.buildings.length, networkVisible: this.view.network.root.visible, terrainVisible: this.view.chunk.root.visible, terrainMode: this.mode, playing: this.playing, inspector: this.el.querySelector('#rpInfo').innerText }; }
}
