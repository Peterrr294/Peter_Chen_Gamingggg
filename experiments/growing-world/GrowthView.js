import * as THREE from 'three';
import { CITY_GROWTH, CHUNK_SIZE } from './growthConfig.js';

// G01 growth debug overlays (render only). The chunk content itself is drawn by the unchanged ChunkView /
// NetworkView / BuildingView; these overlays never replace it.
//   ownership — translucent city-coloured walls along each chunk border + a core marker
//   frontier  — outlines of every frontier cell in the colour of the city that can grow there (white = contested)
//   seams     — each shared edge as a line: continuous (green) · step ≤ 30 m (yellow) · cliff (red); city boundary dashed
const SEAM = { continuous: 0x3fd17a, step: 0xffd23f, cliff: 0xff3b3b };
const H = CHUNK_SIZE / 2;

const disposeGroup = group => {
  group.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); });
  group.clear();
};

export class GrowthView {
  constructor(scene) {
    this.ownership = new THREE.Group(); this.ownership.name = 'G01 ownership';
    this.frontier = new THREE.Group(); this.frontier.name = 'G01 frontier';
    this.seams = new THREE.Group(); this.seams.name = 'G01 seam conflicts';
    scene.add(this.ownership, this.frontier, this.seams);
    this.owned = new Map(); // chunkId → group
  }

  // One chunk's ownership frame (walls from y = minHeight − 4 to maxHeight + 12 along the border).
  addOwnership(record, stats) {
    this.removeOwnership(record.chunkId);
    const color = CITY_GROWTH[record.cityId].color;
    const group = new THREE.Group();
    const y0 = stats.minHeight - 4; const y1 = stats.maxHeight + 12; const h = y1 - y0;
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false });
    const { x, z } = record.worldOrigin;
    for (const [px, pz, rot] of [[x, z - H + 6, 0], [x, z + H - 6, 0], [x - H + 6, z, Math.PI / 2], [x + H - 6, z, Math.PI / 2]]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE - 12, h), material);
      wall.position.set(px, y0 + h / 2, pz); wall.rotation.y = rot;
      group.add(wall);
    }
    const top = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(x + a * (H - 6), y1, z + b * (H - 6)))), new THREE.LineBasicMaterial({ color }));
    group.add(top);
    if (!record.parentChunkId) {
      const marker = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 220, 16), new THREE.MeshBasicMaterial({ color }));
      marker.position.set(x, y1 + 110, z);
      group.add(marker);
    }
    this.ownership.add(group);
    this.owned.set(record.chunkId, group);
  }

  removeOwnership(chunkId) {
    const group = this.owned.get(chunkId);
    if (group) { disposeGroup(group); group.removeFromParent(); this.owned.delete(chunkId); }
  }

  // frontier: [{ gx, gy, cities: [cityId…] }]
  updateFrontier(cells) {
    disposeGroup(this.frontier);
    for (const cell of cells) {
      const color = cell.cities.length > 1 ? 0xffffff : CITY_GROWTH[cell.cities[0]].color;
      const x = cell.gx * CHUNK_SIZE; const z = cell.gy * CHUNK_SIZE; const r = H - 40;
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(x + a * r, 30, z + b * r))), new THREE.LineDashedMaterial({ color, dashSize: 60, gapSize: 40 }));
      line.computeLineDistances();
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
      fill.position.set(x, 28, z);
      this.frontier.add(line, fill);
    }
  }

  // edges: shared-edge reports of the controller; recordOf(chunkId) → the chunk record (origin, edge profiles).
  updateSeams(edges, recordOf) {
    disposeGroup(this.seams);
    for (const e of edges) {
      const a = recordOf(e.a);
      const ax = a.worldOrigin.x; const az = a.worldOrigin.z;
      const along = e.sideA.endsWith('X');
      const cx = ax + (e.sideA === 'maxX' ? H : e.sideA === 'minX' ? -H : 0);
      const cz = az + (e.sideA === 'maxZ' ? H : e.sideA === 'minZ' ? -H : 0);
      const y = Math.max(...a.profiles[e.sideA].h) + 30;
      const pts = along ? [new THREE.Vector3(cx, y, cz - H), new THREE.Vector3(cx, y, cz + H)] : [new THREE.Vector3(cx - H, y, cz), new THREE.Vector3(cx + H, y, cz)];
      const material = e.identity === 'cityBoundary' ? new THREE.LineDashedMaterial({ color: SEAM[e.geometry], dashSize: 40, gapSize: 30, depthTest: false }) : new THREE.LineBasicMaterial({ color: SEAM[e.geometry], depthTest: false });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material);
      line.computeLineDistances(); line.renderOrder = 12;
      // A post per unpaired port pair count and a riser for the height step (|Δh| max).
      const riser = new THREE.Mesh(new THREE.BoxGeometry(14, Math.max(2, e.maxDh), 14), new THREE.MeshBasicMaterial({ color: SEAM[e.geometry] }));
      riser.position.set(cx, y + e.maxDh / 2, cz);
      this.seams.add(line, riser);
    }
  }

  setVisible({ ownership, frontier, seams }) {
    this.ownership.visible = ownership; this.frontier.visible = frontier; this.seams.visible = seams;
  }

  clear() { for (const id of [...this.owned.keys()]) this.removeOwnership(id); disposeGroup(this.frontier); disposeGroup(this.seams); }
}
