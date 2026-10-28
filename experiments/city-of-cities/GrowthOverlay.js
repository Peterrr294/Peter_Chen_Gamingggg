import * as THREE from 'three';
import { CHUNK_SIZE, CITY_COLOR, cityLabel } from './originConfig.js';
import { textSprite } from './OriginView.js';

// G02 growth debug overlays (render only; the chunks themselves are drawn by ChunkView / NetworkView / BuildingView).
//   frontier — every candidate of the last evaluated step: solid = eligible (label: city + score), dashed = rejected
//              (label: reason), white = the cell selected in that step; nested per city when cities share a cell
//   history  — arrow from parent to child chunk per growth event, labelled with the step number
const H = CHUNK_SIZE / 2;
const hex = c => `#${c.toString(16).padStart(6, '0')}`;
const disposeGroup = group => {
  group.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); });
  group.clear();
};
const square = (x, z, r, y, material) => {
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(x + a * r, y, z + b * r))), material);
  line.computeLineDistances(); line.renderOrder = 15;
  return line;
};

export class GrowthOverlay {
  constructor(scene) {
    this.frontier = new THREE.Group(); this.frontier.name = 'G02 growth frontier';
    this.history = new THREE.Group(); this.history.name = 'G02 growth history';
    scene.add(this.frontier, this.history);
  }

  // frontier: { cityId: [candidate…] } from WorldGrowthController.evaluate / step.
  updateFrontier(frontier) {
    disposeGroup(this.frontier);
    if (!frontier) return;
    const perCell = new Map();
    for (const [cityId, list] of Object.entries(frontier)) for (const c of list) {
      const key = `${c.gx},${c.gy}`;
      if (!perCell.has(key)) perCell.set(key, []);
      perCell.get(key).push({ cityId, c });
    }
    for (const entries of perCell.values()) {
      entries.forEach(({ cityId, c }, k) => {
        const x = c.gx * CHUNK_SIZE; const z = c.gy * CHUNK_SIZE;
        const color = c.status === 'selected' ? 0xffffff : CITY_COLOR[cityId];
        const material = c.status === 'rejected' || c.status === 'contested' ? new THREE.LineDashedMaterial({ color, dashSize: 40, gapSize: 40, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
        this.frontier.add(square(x, z, H - 40 - k * 40, 30, material));
        const text = c.status === 'rejected' ? `✗ ${c.rejectionReason.slice(0, 30)}` : c.status === 'contested' ? `✗ lost to ${c.rejectionReason.split(' ')[3]}` : `${c.status === 'selected' ? '✓ ' : ''}${c.score} (w ${c.selectionWeight ?? '—'})`;
        const label = textSprite([`${cityLabel(cityId)} ${text}`], { width: 620, scale: 1000, colors: [hex(color)] });
        label.position.set(x, 60, z - H + 140 + k * 170);
        this.frontier.add(label);
      });
    }
  }

  // history: growth events; chunkOf(id) → chunk record.
  updateHistory(history, chunkOf) {
    disposeGroup(this.history);
    for (const e of history) {
      const a = chunkOf(e.parentChunkId); const b = chunkOf(e.newChunkId);
      if (!a || !b) continue;
      const from = new THREE.Vector3(a.worldOrigin.x, 420, a.worldOrigin.z); const to = new THREE.Vector3(b.worldOrigin.x, 420, b.worldOrigin.z);
      const dir = to.clone().sub(from); const len = dir.length(); dir.normalize();
      const arrow = new THREE.ArrowHelper(dir, from, len * 0.82, CITY_COLOR[e.cityId], 180, 120);
      arrow.traverse(o => { if (o.material) { o.material.depthTest = false; o.renderOrder = 18; } });
      this.history.add(arrow);
      const label = textSprite([`#${e.step}`], { width: 160, scale: 380, colors: [hex(CITY_COLOR[e.cityId])] });
      label.position.copy(from.clone().lerp(to, 0.5)).setY(520);
      this.history.add(label);
    }
  }

  setVisible({ growthFrontier, history }) { this.frontier.visible = growthFrontier; this.history.visible = history; }
  clear() { disposeGroup(this.frontier); disposeGroup(this.history); }
}
