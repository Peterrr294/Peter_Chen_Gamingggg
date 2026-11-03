import * as THREE from 'three';
import { CHUNK_SIZE } from './originConfig.js';
import { textSprite } from './OriginView.js';
import { portPoint } from './MorphologicalGrowth.js';
import { PROPOSAL } from './EmergentEncounter.js';

// G03c-01 debug overlays of natural encounters (render only; every layer off by default).
//   boundary  shared edges between two cities (solid, coloured by relationship) and the free cells between approaching
//             cities (dashed squares)
//   ports     each road end across a shared edge, coloured by its proposal
//   labels    encounter id, co-existing states, decision, validation
export const PROPOSAL_COLOR = { [PROPOSAL.connection]: 0x3fe0ff, [PROPOSAL.ramp]: 0x3f8cff, [PROPOSAL.adaptation]: 0xffb020, [PROPOSAL.separation]: 0xff2d55, [PROPOSAL.unresolved]: 0xb0b6ba, connected: 0x3fd17a };
const H = CHUNK_SIZE / 2;
const disposeGroup = g => { g.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); g.clear(); };
const post = (x, y, z, color) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 110, 10), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.position.set(x, y + 55, z); m.renderOrder = 19; return m; };
const line = (pts, color, dashed = false) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), dashed ? new THREE.LineDashedMaterial({ color, dashSize: 60, gapSize: 40, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false })); if (dashed) l.computeLineDistances(); l.renderOrder = 18; return l; };

export class EmergentEncounterView {
  constructor(scene) {
    this.groups = { boundary: new THREE.Group(), ports: new THREE.Group(), labels: new THREE.Group() };
    for (const [k, g] of Object.entries(this.groups)) { g.name = `G03c-01 ${k}`; scene.add(g); }
  }

  update(segments, chunkOf, topOf) {
    for (const g of Object.values(this.groups)) disposeGroup(g);
    for (const s of segments) {
      const color = s.states.connected ? PROPOSAL_COLOR.connected : PROPOSAL_COLOR[s.relationshipStatus] ?? 0xffffff;
      const y = 420;
      for (const key of s.territoryBoundary.sharedEdges) {
        const [a, b] = key.split('|').map(chunkOf);
        const mx = (a.worldOrigin.x + b.worldOrigin.x) / 2; const mz = (a.worldOrigin.z + b.worldOrigin.z) / 2;
        const along = a.worldOrigin.x === b.worldOrigin.x ? [new THREE.Vector3(mx - H, y, mz), new THREE.Vector3(mx + H, y, mz)] : [new THREE.Vector3(mx, y, mz - H), new THREE.Vector3(mx, y, mz + H)];
        this.groups.boundary.add(line(along, color));
      }
      for (const cell of s.territoryBoundary.gapCells) {
        const [gx, gy] = cell.split(',').map(Number); const x = gx * CHUNK_SIZE; const z = gy * CHUNK_SIZE; const h = H - 60;
        this.groups.boundary.add(line([[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]].map(([u, v]) => new THREE.Vector3(x + u, y, z + v)), color, true));
      }
      for (const e of s.edgeEvaluations.filter(v => v.evaluated)) {
        const older = chunkOf(e.olderChunkId);
        for (const p of e.ports) { const pt = portPoint(older, p.side, p.position); this.groups.ports.add(post(pt.x, (topOf(older.chunkId) ?? 0) + 10, pt.z, PROPOSAL_COLOR[p.proposal])); }
      }
      const [ca, cb] = (s.territoryBoundary.closestPair ?? s.involvedChunkIds.slice(0, 2)).map(chunkOf);
      const label = textSprite([`${s.cityA} × ${s.cityB} · ${s.origin === 'placement' ? 'near at placement' : `emerged at step ${s.firstStep}`}`, `${Object.entries(s.states).filter(([, v]) => v).map(([k]) => k).join(' + ')} · ${s.minDistanceCells} cell(s)`, `${s.relationshipStatus} · ${s.validationStatus}`], { width: 900, scale: 1100, colors: [`#${color.toString(16).padStart(6, '0')}`, '#e6e9eb', '#e6e9eb'] });
      label.position.set((ca.worldOrigin.x + cb.worldOrigin.x) / 2, 900, (ca.worldOrigin.z + cb.worldOrigin.z) / 2); this.groups.labels.add(label);
    }
  }

  setVisible({ encBoundary, encPorts, encLabels }) { this.groups.boundary.visible = !!encBoundary; this.groups.ports.visible = !!encPorts; this.groups.labels.visible = !!encLabels; }
  clear() { for (const g of Object.values(this.groups)) disposeGroup(g); }
}
