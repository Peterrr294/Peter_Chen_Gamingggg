import * as THREE from 'three';
import { CHUNK_SIZE, cityLabel } from './originConfig.js';
import { textSprite } from './OriginView.js';
import { portPoint } from './MorphologicalGrowth.js';

// G02b debug overlays (render only).
//   fronts        road entries of every current growth front: green = usable (within the entry step), red = not
//                 usable (label: height step); front label with status / reason
//   inherited     the child roads that continue a parent road (generatedRoadIds), drawn over the network in white
//   connectivity  recorded cross-chunk connections: cyan post at each joined port pair; label with the city graph
//   morphology    per growth chunk: parent → child metrics (orientation, road density, block, frontage, coverage, height)
const disposeGroup = g => { g.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); g.clear(); };
const post = (x, y, z, color, h = 120, r = 10) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.position.set(x, y + h / 2, z); m.renderOrder = 18; return m; };

export class MorphView {
  constructor(scene) {
    this.groups = { fronts: new THREE.Group(), inherited: new THREE.Group(), connectivity: new THREE.Group(), morphology: new THREE.Group() };
    for (const [k, g] of Object.entries(this.groups)) { g.name = `G02b ${k}`; scene.add(g); }
  }

  // fronts: MorphologicalGrowth.fronts(city); events: G02b history events; chunkOf / topOf / edgesOf(chunkId) → network edges
  update({ fronts = [], events = [], connectivity = null }, chunkOf, topOf, edgesOf) {
    for (const g of Object.values(this.groups)) disposeGroup(g);
    for (const f of fronts) {
      const c = chunkOf(f.sourceChunkId); const y = (topOf(f.sourceChunkId) ?? 0) + 20;
      for (const e of f.entries) this.groups.fronts.add(post(e.point.x, y, e.point.z, e.usable ? 0x3fd17a : 0xff4d4d, 90, 9));
      const mid = portPoint(c, f.side, f.side.endsWith('X') ? c.worldOrigin.z : c.worldOrigin.x);
      const label = textSprite([`${f.direction} ${f.status === 'eligible' ? `${f.usable.primary} primary / ${f.usable.all} usable entries` : '✗'}`, f.reason ? f.reason.slice(0, 46) : `blocks on edge ${f.block?.count ?? 0} · wet samples ${f.water.wetSamples}`], { width: 620, scale: 640, colors: [f.status === 'eligible' ? '#7fe3a0' : '#ff8080', '#e6e9eb'] });
      label.position.set(mid.x, y + 260, mid.z); this.groups.fronts.add(label);
    }
    for (const e of events) {
      const top = topOf(e.newChunkId) ?? 0;
      const edges = edgesOf(e.newChunkId) ?? [];
      const ids = new Set(e.generatedRoadIds.map(id => Number(id.split(':e')[1])));
      for (const edge of edges.filter(x => ids.has(x.id))) {
        const pts = edge.points.map(p => new THREE.Vector3(p.x, (p.y ?? top) + 6, p.z));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })); line.renderOrder = 17;
        this.groups.inherited.add(line);
      }
      for (const c of e.connections) {
        const p = c.child; const parent = chunkOf(c.parent.chunkId);
        const side = e.sourceGrowthFrontId.split(':')[2];
        const pos = Number(c.connectionId.split(':')[3]);
        const pt = portPoint(parent, side, pos);
        this.groups.connectivity.add(post(pt.x, top, pt.z, 0x3fe0ff, 160, 12));
        void p;
      }
      const parent = chunkOf(e.parentChunkId); const child = chunkOf(e.newChunkId);
      const a = parent.outputs.morph; const b = child.outputs.morph;
      const d = (x, y, k = 1) => (x === null || y === null ? 'n/a' : `${x} → ${y}`);
      const label = textSprite([`${e.growthEventId} · ${e.connections.length} roads joined`, `orientation ${d(a.dominantOrientationDeg, b.dominantOrientationDeg)}° · roads ${d(a.roadDensityKmPerKm2, b.roadDensityKmPerKm2)} km/km²`, `block median ${d(a.blockAreaMedianM2, b.blockAreaMedianM2)} m² · frontage ${d(a.parcelFrontageMedianM, b.parcelFrontageMedianM)} m`, `coverage ${d(a.buildingCoverage, b.buildingCoverage)} · mean height ${d(a.heightMeanM, b.heightMeanM)} m`], { width: 900, scale: 900, colors: ['#ffffff', '#cfe8ff'] });
      label.position.set(child.worldOrigin.x, top + 420, child.worldOrigin.z); this.groups.morphology.add(label);
    }
    if (connectivity) {
      for (const [cityId, c] of Object.entries(connectivity)) {
        if (!c.connections) continue;
        const core = chunkOf(c.coreChunkId);
        const label = textSprite([`${cityLabel(cityId)} road graph`, `${c.components} component(s) · ${(c.roadLengthM / 1000).toFixed(1)} km · ${Math.round(c.mainComponentShare * 100)} % in the core's network · ${c.connections} cross-chunk joins`], { width: 900, scale: 900, colors: ['#3fe0ff', '#e6e9eb'] });
        label.position.set(core.worldOrigin.x, (topOf(core.chunkId) ?? 0) + 700, core.worldOrigin.z - CHUNK_SIZE / 3); this.groups.connectivity.add(label);
      }
    }
  }

  setVisible({ morphFronts, inheritedRoads, morphology, connectivity }) {
    this.groups.fronts.visible = !!morphFronts; this.groups.inherited.visible = !!inheritedRoads; this.groups.morphology.visible = !!morphology; this.groups.connectivity.visible = !!connectivity;
  }
  clear() { for (const g of Object.values(this.groups)) disposeGroup(g); }
}
