import * as THREE from 'three';
import { textSprite } from './OriginView.js';
import { portPoint } from './MorphologicalGrowth.js';
import { RAMP_STATUS as S } from './RoadRampPlanner.js';

// G02c-02 debug overlays (render only; every layer off by default).
//   accepted  graded roads: blue where the road climbs into the new chunk, orange where it descends
//   rejected  road ends left unconnected, coloured by reason
//   seam      road ends refused because the terrain seam is too large
//   labels    numbers of each ramp
const disposeGroup = g => { g.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); g.clear(); };
const post = (x, y, z, color, h = 90, r = 8) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.position.set(x, y + h / 2, z); m.renderOrder = 19; return m; };
export const STATUS_COLOR = { [S.length]: 0xffb020, [S.grade]: 0xff6a00, [S.terrain]: 0xff2d55, [S.collision]: 0xc56bff, [S.network]: 0xffffff, [S.infrastructure]: 0x8f9bff, [S.junction]: 0xff7ad9 };
const LABEL = { [S.length]: 'Insufficient Length', [S.grade]: 'Grade Exceeded', [S.terrain]: 'Terrain Discontinuity', [S.collision]: 'Geometry Collision', [S.network]: 'Network Conflict', [S.infrastructure]: 'Requires Infrastructure', [S.junction]: 'Junction Constraint' };

export class RampView {
  constructor(scene) {
    this.groups = { accepted: new THREE.Group(), rejected: new THREE.Group(), seam: new THREE.Group(), labels: new THREE.Group() };
    for (const [k, g] of Object.entries(this.groups)) { g.name = `G02c-02 ${k}`; scene.add(g); }
  }

  // events: history events with ramps; chunkOf(id) → chunk; edgesOf(id) → edges with stored elevations
  update(events, chunkOf, edgesOf) {
    for (const g of Object.values(this.groups)) disposeGroup(g);
    for (const e of events) {
      const child = chunkOf(e.newChunkId); const edges = edgesOf(e.newChunkId) ?? [];
      for (const r of e.ramps) {
        const point = portPoint(child, r.side, r.position);
        if (r.status === S.accepted) {
          for (const edge of edges.filter(x => x.ramp === r.rampId)) {
            const pts = edge.points.map(p => new THREE.Vector3(p.x, p.y + 3, p.z));
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: r.deltaM > 0 ? 0xff9a3f : 0x3f8cff, depthTest: false })); line.renderOrder = 18;
            this.groups.accepted.add(line);
          }
          this.groups.accepted.add(post(point.x, r.startElevation, point.z, 0x3fd17a));
          const label = textSprite([`${r.kind === 'crossCity' ? 'INTER-CITY · ' : ''}${r.roadClass} · ${r.startElevation} → ${r.endElevation} m (seam ${r.deltaM > 0 ? '+' : ''}${r.deltaM} m)`, `${(+r.rampLengthM).toFixed(1)} m, max ${(r.maxGrade * 100).toFixed(1)} % · ${r.kind === 'crossCity' ? 'joined; Connected only with a verified core path' : 'connected'}`], { width: 620, scale: 300, colors: ['#7fe3a0', '#e6e9eb'] });
          label.position.set(point.x, r.startElevation + 130, point.z); this.groups.labels.add(label);
        } else if (r.status !== S.flush) {
          const group = r.status === S.terrain ? this.groups.seam : this.groups.rejected;
          group.add(post(point.x, r.elevationSource, point.z, STATUS_COLOR[r.status]));
          const label = textSprite([`${r.kind === 'crossCity' ? 'INTER-CITY · ' : ''}${LABEL[r.status]}`, (r.reason ?? '').slice(0, 52)], { width: 620, scale: 300, colors: [`#${STATUS_COLOR[r.status].toString(16).padStart(6, '0')}`, '#e6e9eb'] });
          label.position.set(point.x, r.elevationSource + 130, point.z); this.groups.labels.add(label);
        }
      }
    }
  }

  setVisible({ rampAccepted, rampRejected, rampSeam, rampLabels }) {
    this.groups.accepted.visible = !!rampAccepted; this.groups.rejected.visible = !!rampRejected; this.groups.seam.visible = !!rampSeam; this.groups.labels.visible = !!rampLabels;
  }
  clear() { for (const g of Object.values(this.groups)) disposeGroup(g); }
}
