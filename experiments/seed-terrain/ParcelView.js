import * as THREE from 'three';

// Parcel Debug Layer (render only): parcel outlines, frontage lines, inward orientation ticks.
// Each kind is one merged LineSegments batch (≈ 2,000 parcels per chunk). Fills come from
// ChunkView's "parcels" view; block outlines and roads come from their own layers.
const DENSIFY = 6; // m
const COLORS = { outline: 0xf4f1e8, frontage: 0xffd23f, corner: 0xff7a3c, tick: 0x5fd3ff };

export class ParcelView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'Parcel debug layer';
    scene.add(this.root);
  }

  clear() {
    this.root.children.forEach(child => { child.geometry.dispose(); child.material.dispose(); });
    this.root.clear();
  }

  update(result, heightAt) {
    this.clear();
    const batches = { outline: [], frontage: [], corner: [], tick: [] };
    const push = (list, a, b, lift) => list.push(a.x, heightAt(a.x, a.z) + lift, a.z, b.x, heightAt(b.x, b.z) + lift, b.z);
    const path = (list, points, closed, lift) => {
      const count = closed ? points.length : points.length - 1;
      for (let i = 0; i < count; i += 1) {
        const p = points[i]; const q = points[(i + 1) % points.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / DENSIFY));
        for (let s = 0; s < steps; s += 1) {
          push(list, { x: p.x + (q.x - p.x) * s / steps, z: p.z + (q.z - p.z) * s / steps }, { x: p.x + (q.x - p.x) * (s + 1) / steps, z: p.z + (q.z - p.z) * (s + 1) / steps }, lift);
        }
      }
    };
    for (const parcel of result.parcels) {
      path(batches.outline, parcel.polygon, true, 2.2);
      parcel.holes.forEach(hole => path(batches.outline, hole, true, 2.2));
      parcel.frontageLines.forEach(line => path(parcel.frontageType === 'corner' ? batches.corner : batches.frontage, line, false, 2.6));
      // Orientation tick: from the middle of the longest frontage line, 6 m along the inward direction.
      const line = parcel.frontageLines.reduce((best, item) => (item.length > best.length ? item : best), parcel.frontageLines[0]);
      const mid = line[Math.floor(line.length / 2)];
      const angle = parcel.orientation.inwardDeg * Math.PI / 180;
      push(batches.tick, mid, { x: mid.x + Math.cos(angle) * 6, z: mid.z + Math.sin(angle) * 6 }, 2.8);
    }
    for (const [kind, positions] of Object.entries(batches)) {
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: COLORS[kind] }));
      lines.renderOrder = 30;
      this.root.add(lines);
    }
  }

  setVisible(value) { this.root.visible = value; }
}
