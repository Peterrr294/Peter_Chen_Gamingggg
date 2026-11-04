import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { INTEGRITY_CLASS as K, chunkComponents, cityGraph, cityRoot } from './NetworkIntegrity.js';

// G02c-R1 debug-only Network Integrity layer (render only, off by default). Every line follows a real road centreline;
// colour comes from the road graph, never from proximity. Two modes:
//   class      green root-connected · blue cut off by water · orange cut off by slope · red orphan · grey not analysed
//   component  one colour per city-level road component (pieces that are not connected never share a colour)
// White disc: city root (core chunk). Red square: cell of a candidate the gate refused. Tint (analysed chunks only):
// blue water, orange land steeper than the DNA road limit (the evidence behind a geographic class).
export const CLASS_COLOR = { [K.root]: 0x3fd17a, [K.water]: 0x3f8cff, [K.slope]: 0xffa53f, [K.orphan]: 0xff3b3b, unclassified: 0x9aa3a8 };
const PALETTE = [0x3fd17a, 0xff3b3b, 0x3f8cff, 0xffd23f, 0xc86bff, 0x3fe0ff, 0xff7ac8, 0xa8ff3f, 0xff8a3f, 0x7a8cff, 0xffffff, 0x8affd2];
const S = 1024;

export class NetworkIntegrityView {
  constructor(scene) { this.root = new THREE.Group(); this.root.name = 'G02c-R1 network integrity'; this.root.visible = false; scene.add(this.root); this.items = []; this.materials = []; this.mode = 'class'; }

  // world, edgesOf(chunkId) → [{ id, from, to, points }], classes: Map componentId → { class, reason, status },
  // evidence: Map chunkId → { fields, maxSlopeDeg } for analysed chunks, resolution: canvas size.
  update(world, edgesOf, classes, evidence, resolution) {
    this.root.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose?.(); }); this.materials.forEach(m => m.dispose()); this.root.clear(); this.items = []; this.materials = [];
    const material = (color, width) => { const m = new LineMaterial({ color, linewidth: width, depthTest: false, transparent: true, opacity: 0.95 }); m.resolution.copy(resolution); this.materials.push(m); return m; };
    const roots = [];
    for (const cityId of [...world.cities.keys()].sort()) {
      const chunks = [...world.chunks.values()].filter(c => c.cityId === cityId && c.outputs);
      if (!chunks.length) continue;
      const root = cityRoot(world, cityId);
      // City-level components (for the component colour map): label every node by its connected piece of the city graph.
      const adj = cityGraph(world, cityId); const cityComp = new Map(); let next = 0; const order = [];
      for (const n of [...adj.keys()].sort()) { if (cityComp.has(n)) continue; const id = root.reach.has(n) ? -1 : next++; const st = [n]; cityComp.set(n, id); while (st.length) { const x = st.pop(); for (const y of adj.get(x)) if (!cityComp.has(y)) { cityComp.set(y, id); st.push(y); } } if (id >= 0) order.push(id); }
      for (const c of chunks) {
        const edges = edgesOf(c.chunkId) ?? [];
        for (const comp of chunkComponents(c.chunkId, c.outputs.roadGraph)) {
          const reached = comp.nodes.some(n => root.reach.has(`${c.chunkId}:${n}`));
          const info = reached ? { class: K.root, reason: null } : (classes.get(comp.componentId) ?? { class: 'unclassified', reason: 'not analysed (open the layer to classify)' });
          const cityPiece = cityComp.get(`${c.chunkId}:${comp.nodes[0]}`);
          const color = this.mode === 'component' ? (cityPiece === -1 ? PALETTE[0] : PALETTE[1 + (cityPiece % (PALETTE.length - 1))]) : CLASS_COLOR[info.class];
          const nodeSet = new Set(comp.nodes); const mids = [];
          for (const e of edges.filter(x => nodeSet.has(x.from) && x.kind !== 'canal')) {
            const geo = new LineGeometry(); geo.setPositions(e.points.flatMap(p => [p.x, (p.y ?? 0) + 3, p.z]));
            const line = new Line2(geo, material(color, reached ? 2.5 : 4)); line.computeLineDistances(); line.renderOrder = 42; this.root.add(line);
            mids.push(e.points[Math.floor(e.points.length / 2)]);
          }
          if (!reached || comp.componentId === root.rootComponentId) this.items.push({ kind: 'component', componentId: comp.componentId, cityId, chunkId: c.chunkId, growthStep: c.growthStep, lengthM: Math.round(comp.lengthM), edges: comp.edges, reached, isRoot: comp.componentId === root.rootComponentId, cityPiece, ...info, points: mids });
          if (comp.componentId === root.rootComponentId) { const e = edges.find(x => nodeSet.has(x.from)); if (e) roots.push(e.points[0]); }
        }
      }
    }
    if (roots.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(roots.flatMap(p => [p.x, (p.y ?? 0) + 6, p.z]), 3)); const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 18, sizeAttenuation: false, depthTest: false })); pts.renderOrder = 44; this.root.add(pts); }
    // Refused candidates (latest refusal per cell).
    const refused = new Map(); for (const a of world.growth.roadAttempts ?? []) if (a.integrity) refused.set(a.candidateId, a);
    for (const a of refused.values()) {
      const [, , gx, gy] = a.candidateId.split(':').map(Number); const x = gx * S; const z = gy * S; const h = S / 2 - 20; const y = 60;
      const geo = new LineGeometry(); geo.setPositions([x - h, y, z - h, x + h, y, z - h, x + h, y, z + h, x - h, y, z + h, x - h, y, z - h]);
      const line = new Line2(geo, material(0xff3b3b, 3)); line.computeLineDistances(); line.renderOrder = 43; this.root.add(line);
      this.items.push({ kind: 'refused', candidateId: a.candidateId, cityId: a.cityId, step: a.step, reason: a.reason, integrity: a.integrity, points: [{ x, y, z }] });
    }
    // Evidence tint of analysed chunks.
    for (const [chunkId, { fields, maxSlopeDeg }] of evidence) {
      const c = world.chunks.get(chunkId); const n = fields.grid.columns; const data = new Uint8Array(n * n * 4);
      for (let i = 0; i < n * n; i += 1) { const w = fields.waterMask[i]; const steep = !w && fields.slope[i] > maxSlopeDeg; data.set(w ? [40, 120, 255, 150] : steep ? [255, 150, 40, 120] : [0, 0, 0, 0], i * 4); }
      const tex = new THREE.DataTexture(data, n, n); tex.needsUpdate = true; tex.magFilter = THREE.NearestFilter;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide }));
      plane.rotation.x = Math.PI / 2; plane.position.set(c.worldOrigin.x, fields.stats.maxHeight + 2, c.worldOrigin.z); plane.renderOrder = 41; this.root.add(plane);
    }
  }

  setResolution(r) { this.materials.forEach(m => m.resolution.copy(r)); }
  setVisible(on) { this.root.visible = !!on; }
  pick(px, py, project, maxPx = 14) {
    let best = null;
    for (const it of this.items) for (const p of it.points) { const s = project(p); const d = Math.hypot(s.x - px, s.y - py); if (d <= maxPx && (!best || d < best.d)) best = { d, it }; }
    return best?.it ?? null;
  }
}

export function describeIntegrityPick(it, statusOf) {
  if (it.kind === 'refused') return [`Refused growth candidate ${it.candidateId} (step ${it.step}, ${it.cityId})`, it.reason, ...it.integrity.components.map(c => `${c.componentId}: ${c.class}, ${c.lengthM} m — ${c.reason}`)].join('\n');
  return [`Component ${it.componentId}${it.isRoot ? ' (city root)' : ''}`, `City ${it.cityId} · source chunk ${it.chunkId}${it.growthStep ? ` (growth step ${it.growthStep})` : ' (core)'} · road length ${it.lengthM} m · ${it.edges} edges`,
    `Reachable from core: ${it.reached ? 'yes' : 'no'} · class ${it.class}`, it.reason ? `Reason: ${it.reason}` : null, `Validation status: ${statusOf(it.chunkId)}`].filter(Boolean).join('\n');
}
