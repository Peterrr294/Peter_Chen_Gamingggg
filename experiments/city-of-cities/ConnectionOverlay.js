import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { portPoint } from './MorphologicalGrowth.js';
import { RAMP_STATUS as S } from './RoadRampPlanner.js';

// G02c-03a debug-only Connection Overlay (render only, off by default). Lines have a fixed width in screen pixels so a
// ramp stays readable from far away; every vertex is a vertex of the real road centreline (stored ramp elevations), so
// the line shows where the road is, never a wider or moved road. Roads keep their real width in the network layer.
//   green solid   ramp road (main)            cyan solid   junction branch graded back to the ground
//   white disc    junction (shared height)    red square   road end left unconnected (status in the pick panel)
const COLOR = { main: 0x3fd17a, branch: 0x3fe0ff, junction: 0xffffff, rejected: 0xff4d4d };

export class ConnectionOverlay {
  constructor(scene) { this.root = new THREE.Group(); this.root.name = 'G02c-03a connection overlay'; this.root.visible = false; scene.add(this.root); this.items = []; this.materials = []; }

  // events: history events with ramps; chunkOf(id) → chunk; edgesOf(id) → [{ id, points, ramp, rampRole }]
  update(events, chunkOf, edgesOf, resolution) {
    this.root.traverse(o => { o.geometry?.dispose(); }); this.materials.forEach(m => m.dispose()); this.root.clear(); this.items = []; this.materials = [];
    const material = (color, width) => { const m = new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true, opacity: 0.95 }); m.resolution.copy(resolution); this.materials.push(m); return m; };
    const dots = (list, color, size) => { if (!list.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap(p => [p.x, p.y + 4, p.z]), 3)); const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false })); pts.renderOrder = 41; this.root.add(pts); };
    const junctions = []; const rejected = [];
    for (const e of events) {
      const edges = edgesOf(e.newChunkId) ?? []; const child = chunkOf(e.newChunkId);
      for (const r of e.ramps ?? []) {
        if (r.status === S.accepted) {
          for (const edge of edges.filter(x => x.ramp === r.rampId)) {
            const geo = new LineGeometry(); geo.setPositions(edge.points.flatMap(p => [p.x, p.y + 2, p.z]));
            const line = new Line2(geo, material(edge.rampRole === 'branch' ? COLOR.branch : COLOR.main, edge.rampRole === 'branch' ? 3 : 5)); line.computeLineDistances(); line.renderOrder = 40; this.root.add(line);
            this.items.push({ kind: 'ramp', rampId: r.rampId, role: edge.rampRole ?? 'main', edgeId: edge.id, chunkId: e.newChunkId, points: edge.points, record: r, event: e.growthEventId });
          }
          if (r.junction) { const j = { x: r.junction.x, y: r.junction.junctionZ, z: r.junction.z }; junctions.push(j); this.items.push({ kind: 'junction', rampId: r.rampId, chunkId: e.newChunkId, points: [j], record: r, event: e.growthEventId }); }
        } else if (r.status !== S.flush) {
          const p = portPoint(child, r.side, r.position); const q = { x: p.x, y: r.elevationSource, z: p.z }; rejected.push(q);
          this.items.push({ kind: 'rejected', rampId: r.rampId, chunkId: e.newChunkId, points: [q], record: r, event: e.growthEventId });
          if (r.junction?.x !== undefined) { const j = { x: r.junction.x, y: r.junction.groundM, z: r.junction.z }; rejected.push(j); this.items.push({ kind: 'junction', rampId: r.rampId, chunkId: e.newChunkId, points: [j], record: r, event: e.growthEventId }); }
        }
      }
    }
    dots(junctions, COLOR.junction, 16); dots(rejected, COLOR.rejected, 12);
  }

  setResolution(resolution) { this.materials.forEach(m => m.resolution.copy(resolution)); }
  setVisible(on) { this.root.visible = !!on; }

  // Nearest overlay item to a screen point (pixels), within maxPx. project(p) → { x, y } in the same pixel space.
  pick(px, py, project, maxPx = 14) {
    let best = null;
    for (const it of this.items) for (const p of it.points) { const s = project(p); const d = Math.hypot(s.x - px, s.y - py); if (d <= maxPx && (!best || d < best.d || (d === best.d && it.kind === 'junction'))) best = { d, it }; }
    return best?.it ?? null;
  }
}

// Text and an SVG long section of a picked item (real record values only).
export function describePick(it) {
  const r = it.record; const j = r.junction;
  const lines = [`${it.kind === 'junction' ? `Junction ${j?.nodeId} of ${it.chunkId}` : `${it.kind === 'ramp' ? `Ramp road e${it.edgeId} (${it.role})` : 'Unconnected road end'} · ${r.rampId}`}`, `Status ${r.status}${r.reason ? `: ${r.reason}` : ''} · source road ${r.sourceRoadId} · event ${it.event}`];
  if (r.status === S.accepted) lines.push(`${r.roadClass} · ${r.startElevation} → ${r.endElevation} m · ${(+r.rampLengthM).toFixed(1)} m · max grade ${(r.maxGrade * 100).toFixed(1)} % (limit ${(r.allowedGrade * 100).toFixed(1)} %)${r.through === 'junction' ? ' · passes one junction' : ''}`);
  if (j) lines.push(`Junction ${j.nodeId}: ground ${j.groundM} m${j.junctionZ !== undefined ? ` → shared height ${j.junctionZ} m (level ${j.levelM} m each side)` : ''} · ${j.degree} roads${j.branches ? ` · branches ${j.branches.map(b => `e${b.edgeId} ${b.roadClass} ${b.rampLengthM} m, max ${(b.maxGrade * 100).toFixed(1)} %`).join('; ')}` : ''}`);
  let svg = '';
  if (r.profile?.length) {
    const W = 420; const H = 120; const s = r.profile.map(q => q[0]); const ys = r.profile.flatMap(q => [q[1], q[2]]); const lo = Math.min(...ys) - 0.3; const hi = Math.max(...ys) + 0.3;
    const X = v => 30 + (v / Math.max(...s)) * (W - 40); const Y = v => H - 18 - ((v - lo) / (hi - lo)) * (H - 30);
    const path = k => r.profile.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)},${Y(q[k]).toFixed(1)}`).join(' ');
    const jx = j?.junctionZ !== undefined ? r.profile.findIndex(q => Math.abs(q[1] - j.junctionZ) < 0.01) : -1;
    svg = `<svg width="${W}" height="${H}" style="background:#151a1e;display:block;margin-top:4px"><path d="${path(2)}" stroke="#8a6d4a" stroke-width="2" fill="none"/><path d="${path(1)}" stroke="#3fe0ff" stroke-width="2" fill="none"/>${jx >= 0 ? `<circle cx="${X(r.profile[jx][0])}" cy="${Y(r.profile[jx][1])}" r="4" fill="#fff"/>` : ''}<text x="30" y="${H - 4}" fill="#9aa3a8" font-size="10">0 m (shared edge) · cyan road · brown ground${jx >= 0 ? ' · white: junction' : ''}</text><text x="${W - 50}" y="${H - 4}" fill="#9aa3a8" font-size="10">${Math.max(...s)} m</text></svg>`;
  }
  return { text: lines.join('\n'), svg };
}
