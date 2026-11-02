import * as THREE from 'three';
import { CHUNK_SIZE, cityLabel } from './originConfig.js';
import { textSprite } from './OriginView.js';
import { portPoint } from './MorphologicalGrowth.js';

// G03b debug overlays (render only).
//   zones          encounter zone: the shared edge (strip) or the free cell(s) between two cities; colour = relationship
//                  (cyan connected, amber pending plan, red barrier, white approaching); label = co-existing states
//   candidates     every interface the negotiation evaluated: green = accepted, red = rejected (label: first reason)
//   interfaces     accepted cross-city joins (magenta posts) and the newcomer roads that start there (white lines);
//                  pending plan connectors (amber line along the edge, not generated)
//   connectivity   the verified core ↔ core route through the chunks (cyan), with its length
//   difference     morphological difference across the edge (orientation, concentration, block, frontage, height)
const disposeGroup = g => { g.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); g.clear(); };
const post = (x, y, z, color, h = 140, r = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.position.set(x, y + h / 2, z); m.renderOrder = 19; return m; };
const line = (pts, color, opacity = 1) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: opacity < 1, opacity })); l.renderOrder = 18; return l; };
const strip = (x0, z0, x1, z1, y, color, opacity) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(8, Math.abs(x1 - x0)), Math.max(8, Math.abs(z1 - z0))), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.renderOrder = 16; return m; };
const COLORS = { connected: 0x3fe0ff, plan: 0xffb347, barrier: 0xff5a5a, approaching: 0xf4f1ea };
const H = CHUNK_SIZE / 2;

export class EncounterView {
  constructor(scene) {
    this.groups = { zones: new THREE.Group(), candidates: new THREE.Group(), interfaces: new THREE.Group(), connectivity: new THREE.Group(), difference: new THREE.Group() };
    for (const [k, g] of Object.entries(this.groups)) { g.name = `G03b ${k}`; scene.add(g); }
  }

  // encounters: UrbanEncounter.detect(); decisions: world.growth.encounterDecisions; paths: encounterId → path
  update({ encounters = [], decisions = [], paths = {} }, chunkOf, topOf, edgesOf) {
    for (const g of Object.values(this.groups)) disposeGroup(g);
    const y0 = Math.max(0, ...[...encounters.flatMap(e => e.participatingChunkIds)].map(id => topOf(id) ?? 0)) + 30;
    for (const e of encounters) {
      const kind = e.states.connected ? 'connected' : e.currentRelationship.includes('pending') ? 'plan' : e.states.constrained ? 'barrier' : 'approaching';
      const color = COLORS[kind];
      let mid;
      if (e.boundaryLocation.kind === 'sharedEdge') {
        for (const s of e.boundaryLocation.edges) {
          const c = chunkOf(s.chunkA); const p = s.point; mid = p;
          const alongX = !s.sideA.endsWith('X');
          this.groups.zones.add(alongX ? strip(c.worldOrigin.x - H, p.z - 60, c.worldOrigin.x + H, p.z + 60, y0, color, 0.28) : strip(p.x - 60, c.worldOrigin.z - H, p.x + 60, c.worldOrigin.z + H, y0, color, 0.28));
        }
      } else {
        for (const k of e.boundaryLocation.cells) {
          const [gx, gy] = k.split(',').map(Number); const x = gx * CHUNK_SIZE; const z = gy * CHUNK_SIZE;
          this.groups.zones.add(line([[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => new THREE.Vector3(x + a * (H - 20), y0, z + b * (H - 20))), color));
          this.groups.zones.add(strip(x - H + 20, z - H + 20, x + H - 20, z + H - 20, y0 - 2, color, 0.12));
        }
        mid = e.boundaryLocation.point;
      }
      const on = Object.entries(e.states).filter(([, v]) => v).map(([k]) => k).join(' · ');
      const label = textSprite([`${cityLabel(e.cityA)} × ${cityLabel(e.cityB)}: ${e.currentRelationship}`, `states: ${on}`, e.validationStatus.slice(0, 60), (e.decisionReason ?? '').slice(0, 60)], { width: 1000, scale: 1000, colors: ['#ffffff', '#cfe8ff', '#9fd3c7', '#e6e9eb'] });
      label.position.set(mid.x, y0 + 520, mid.z); this.groups.zones.add(label);
      // Morphological difference across the edge (both sides read from generated metrics).
      if (e.boundaryLocation.kind === 'sharedEdge') {
        const s = e.boundaryLocation.edges[0]; const a = chunkOf(s.chunkA).outputs.morph; const b = chunkOf(s.chunkB).outputs.morph;
        const d = k => `${a[k] ?? 'n/a'} | ${b[k] ?? 'n/a'}`;
        const diff = textSprite([`${cityLabel(chunkOf(s.chunkA).cityId)} | ${cityLabel(chunkOf(s.chunkB).cityId)} (across ${s.chunkA} ${s.sideA})`, `orientation ${d('dominantOrientationDeg')}° · concentration ${d('orientationConcentration')}`, `block median ${d('blockAreaMedianM2')} m² · frontage ${d('parcelFrontageMedianM')} m`, `roads ${d('roadDensityKmPerKm2')} km/km² · mean height ${d('heightMeanM')} m`], { width: 1000, scale: 1000, colors: ['#ffffff', '#e6e9eb'] });
        diff.position.set(mid.x, y0 + 900, mid.z + 300); this.groups.difference.add(diff);
      }
      const path = paths[e.encounterId];
      if (path?.reachable) {
        const pts = path.chunks.map(id => { const c = chunkOf(id); return new THREE.Vector3(c.worldOrigin.x, y0 + 60, c.worldOrigin.z); });
        this.groups.connectivity.add(line(pts, COLORS.connected));
        for (const p of pts) this.groups.connectivity.add(post(p.x, y0, p.z, COLORS.connected, 80, 18));
        const l = textSprite([`core ↔ core route: ${(path.lengthM / 1000).toFixed(2)} km`, `${path.chunks.join(' → ')} · ${path.crossings} cross-city join(s)`], { width: 900, scale: 900, colors: ['#3fe0ff', '#e6e9eb'] });
        l.position.set(pts[Math.floor(pts.length / 2)].x, y0 + 260, pts[Math.floor(pts.length / 2)].z - 300); this.groups.connectivity.add(l);
      }
    }
    for (const d of decisions) {
      const other = chunkOf(d.otherChunkId); const y = y0 + 10;
      for (const c of d.candidates) {
        const pt = portPoint(other, d.otherSide, c.position);
        this.groups.candidates.add(post(pt.x, y, pt.z, c.accepted ? 0x3fd17a : 0xff4d4d, 110, 10));
        const l = textSprite([`${c.roadClass} ${c.accepted ? 'accepted' : 'rejected'}`, c.accepted ? `step ${c.stepM} m · grade ${c.grade} · ${c.crossingDeg}°` : (c.reasons[0] ?? '').slice(0, 44)], { width: 560, scale: 360, colors: [c.accepted ? '#7fe3a0' : '#ff8080', '#e6e9eb'] });
        l.position.set(pt.x, y + 200, pt.z); this.groups.candidates.add(l);
      }
      for (const j of d.crossCityConnections ?? []) {
        const pt = portPoint(other, d.otherSide, Number(j.connectionId.split(':').at(-1)));
        this.groups.interfaces.add(post(pt.x, y, pt.z, 0xff4fd8, 220, 16));
        const edges = edgesOf(j.child.chunkId) ?? []; const top = topOf(j.child.chunkId) ?? 0;
        for (const e of edges.filter(x => x.id === j.child.edgeId)) this.groups.interfaces.add(line(e.points.map(p => new THREE.Vector3(p.x, (p.y ?? top) + 8, p.z)), 0xffffff));
      }
      for (const c of d.plan?.connectors ?? []) {
        const a = portPoint(other, d.otherSide, c.otherPosition); const b = portPoint(other, d.otherSide, c.newcomerPosition);
        this.groups.interfaces.add(line([new THREE.Vector3(a.x, y + 40, a.z), new THREE.Vector3(b.x, y + 40, b.z)], 0xffb347));
        this.groups.interfaces.add(post(a.x, y, a.z, 0xffb347, 180, 14)); this.groups.interfaces.add(post(b.x, y, b.z, 0xffb347, 180, 14));
        const l = textSprite([`PLAN (pending, not generated)`, `connector ${c.connectorLengthM} m along the edge · step ${c.elevationStepM} m`], { width: 760, scale: 520, colors: ['#ffb347', '#e6e9eb'] });
        l.position.set((a.x + b.x) / 2, y + 380, (a.z + b.z) / 2); this.groups.interfaces.add(l);
      }
    }
  }

  setVisible({ encounterZones, candidateConnections, interfaces, encounterConnectivity, morphDifference }) {
    this.groups.zones.visible = !!encounterZones; this.groups.candidates.visible = !!candidateConnections; this.groups.interfaces.visible = !!interfaces;
    this.groups.connectivity.visible = !!encounterConnectivity; this.groups.difference.visible = !!morphDifference;
  }
  clear() { for (const g of Object.values(this.groups)) disposeGroup(g); }
}
