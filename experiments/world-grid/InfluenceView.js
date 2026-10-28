import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSampler } from '../seed-terrain/NetworkGenerator.js';
import { distanceAtWeight, INFLUENCE } from './CityInfluence.js';

// 07.1 City Influence debug layer (render only).
//   field — draped overlay on every chunk: original city ownership tint (resolved DNA of the slot); inside the target
//           chunk (the only place the weight is applied) blended toward the heat ramp by w (w = 0 = ownership only).
//   zone  — affected (target) chunk outline, τ-band limits (w = 0.35 / 0.65 contours) and the fused network of the
//           target coloured by rule origin: base DNA, invading DNA, fusion connector.
export const DNA_COLOR = { manhattanGrid: '#4f8cff', veniceWaterNetwork: '#2fd0c0', fezOrganicCore: '#e0a040', chicagoGrid: '#8c6cff', amsterdamCanalRing: '#ff6f91', lisbonHillCore: '#b8e05a', empty: '#3a4448' };
const HEAT = [new THREE.Color('#ffe14d'), new THREE.Color('#ff7a2f'), new THREE.Color('#ff2f6d')];
const heat = (w, out) => (w < 0.5 ? out.copy(HEAT[0]).lerp(HEAT[1], w * 2) : out.copy(HEAT[1]).lerp(HEAT[2], (w - 0.5) * 2));
const ORIGIN_COLOR = { base: 0xf4f1ea, invader: 0xff2f6d, connector: 0xffe14d };
const LIFT = 3; // m above ground / water
export const STABILITY_COLOR = { stable: '#3fd17a', unstable: '#ff2020', unexplained: '#ff33e6', blockChanged: '#4fb3ff', roadChanged: '#ff9a3c', siblingChanged: '#ffd23f', added: '#c9e7ff' };

export class InfluenceView {
  constructor(scene) {
    this.field = new THREE.Group(); this.field.name = 'Influence field (07.1)';
    this.zone = new THREE.Group(); this.zone.name = 'Fusion zone (07.1)';
    this.stability = new THREE.Group(); this.stability.name = 'w = 0 stability (07.1a)';
    scene.add(this.field, this.zone, this.stability);
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
  }

  clear(group) { group.children.forEach(child => { child.geometry?.dispose(); if (child.material !== this.material) child.material?.dispose(); }); group.clear(); }

  // chunks: [{ slot, fields, dna | null }]; state: grid.influenceState(); fusion: target chunk's fusion layer or null.
  update(chunks, state, fusion) {
    this.clear(this.field); this.clear(this.zone);
    const n = 64; const color = new THREE.Color(); const hot = new THREE.Color();
    for (const { slot, fields, dna } of chunks) {
      const { originX, originZ, size } = fields.grid; const s = createSampler(fields);
      const base = new THREE.Color(DNA_COLOR[dna ?? 'empty']);
      const position = new Float32Array((n + 1) * (n + 1) * 3); const colors = new Float32Array(position.length); const index = [];
      for (let i = 0; i <= n; i += 1) for (let j = 0; j <= n; j += 1) {
        const x = originX - size / 2 + size * j / n; const z = originZ - size / 2 + size * i / n; const k = i * (n + 1) + j;
        const water = s.waterSurface(x, z);
        position.set([x, Math.max(s.height(x, z), Number.isFinite(water) ? water : -Infinity) + LIFT, z], k * 3);
        const w = state.active && slot.chunkId === state.target ? state.weightAt(x, z) : 0;
        color.copy(base).lerp(heat(w, hot), Math.min(1, w * 1.2)).toArray(colors, k * 3);
        if (i < n && j < n) index.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(index);
      const mesh = new THREE.Mesh(geometry, this.material); mesh.renderOrder = 5;
      this.field.add(mesh);
    }
    if (!state.active) return;
    const target = chunks.find(c => c.slot.chunkId === state.target);
    const source = chunks.find(c => c.slot.chunkId === state.source);
    const { originX, originZ, size } = target.fields.grid; const s = createSampler(target.fields); const half = size / 2;
    const yAt = (x, z) => { const w = s.waterSurface(x, z); return Math.max(s.height(x, z), Number.isFinite(w) ? w : -Infinity) + LIFT + 3; };
    const line = (points, hex, closed = false) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p.x, p.y ?? yAt(p.x, p.z), p.z)));
      const object = new (closed ? THREE.LineLoop : THREE.Line)(geometry, new THREE.LineBasicMaterial({ color: hex, depthTest: false }));
      object.renderOrder = 20; this.zone.add(object);
    };
    // Affected chunk outline (orange), densified so it follows the terrain.
    const ring = []; for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) for (let t = 0; t < 1; t += 1 / 32) ring.push({ x: originX + half * (a[0] + (b[0] - a[0]) * t), z: originZ + half * (a[1] + (b[1] - a[1]) * t) });
    line(ring, 0xff9a3c, true);
    // τ-band limits: iso-distance curves around the source square, kept inside the target chunk.
    const so = source.slot.worldOrigin;
    for (const tau of [INFLUENCE.threshold.min, INFLUENCE.threshold.max]) {
      const d = distanceAtWeight(state.strength, state.radius, tau);
      if (d === null) continue;
      // Offset of the source square by d: four straight sides joined by quarter arcs around its corners.
      const offset = [];
      for (const [cx, cz, a0] of [[1, 1, 0], [-1, 1, 0.5], [-1, -1, 1], [1, -1, 1.5]]) {
        for (let t = 0; t <= 16; t += 1) { const a = (a0 + t / 32) * Math.PI; offset.push({ x: so.x + cx * half + d * Math.cos(a), z: so.z + cz * half + d * Math.sin(a) }); }
      }
      offset.push(offset[0]);
      const dense = [];
      for (let k = 1; k < offset.length; k += 1) { const a = offset[k - 1]; const b = offset[k]; const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 16)); for (let t = 0; t < steps; t += 1) dense.push({ x: a.x + (b.x - a.x) * t / steps, z: a.z + (b.z - a.z) * t / steps }); }
      let pts = [];
      for (const p of dense) {
        // Inside the target and not damped by the seam guard (there the contour moves inward; not drawn).
        if (Math.abs(p.x - originX) <= half && Math.abs(p.z - originZ) <= half && Math.abs(state.weightAt(p.x, p.z) - tau) < 0.005) pts.push(p);
        else { if (pts.length > 1) line(pts, 0xffffff); pts = []; }
      }
      if (pts.length > 1) line(pts, 0xffffff);
    }
    // Fused network by origin (lines above the road ribbons).
    if (fusion && !fusion.unchanged) {
      const byOrigin = { base: [], invader: [], connector: [] };
      for (const edge of fusion.network.edges) if (edge.kind !== 'tunnel') for (let i = 1; i < edge.points.length; i += 1) byOrigin[edge.fusionOrigin ?? 'base'].push(edge.points[i - 1], edge.points[i]);
      for (const [origin, pts] of Object.entries(byOrigin)) {
        if (!pts.length) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, (p.y ?? 0) + 6, p.z)));
        const segs = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: ORIGIN_COLOR[origin], depthTest: false }));
        segs.renderOrder = 21; this.zone.add(segs);
      }
    }
  }

  // 07.1a stability debug: parcels of the w = 0 zone as flat tiles above the chunk (top-down reading), coloured by
  // stabilityReport class. items: [{ cls, polygon }], y: drawing height (m).
  updateStability(items, y) {
    this.clear(this.stability);
    if (!items?.length) return;
    const geometries = [];
    const color = new THREE.Color();
    for (const item of items) {
      const shape = new THREE.Shape(item.polygon.map(p => new THREE.Vector2(p.x, -p.z)));
      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, y, 0);
      color.set(STABILITY_COLOR[item.cls]);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < geometry.attributes.position.count; i += 1) color.toArray(colors, i * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.deleteAttribute('uv'); geometry.deleteAttribute('normal');
      geometries.push(geometry);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    geometries.forEach(g => g.dispose());
    mesh.renderOrder = 25;
    this.stability.add(mesh);
  }

  setVisible({ field, zone, stability = false }) { this.field.visible = field; this.zone.visible = zone; this.stability.visible = stability; }
}
