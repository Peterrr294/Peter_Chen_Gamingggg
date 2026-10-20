import * as THREE from 'three';

// Block Debug Layer (render only): outlines, hole outlines, IDs, chunk boundary.
// Fill colours come from ChunkView's "blocks" debug view.
const OUTLINE = { roads: 0xffffff, roadsAndWater: 0x9fe8ff, waterOnly: 0x9fe8ff, clipped: 0xff9a3c };
const HOLE = 0x5fd3ff;
const INVALID = 0xff2b2b;
const BUILDABLE = 0x7dff9a;
const TRANSITION = 0xc9b6ff;
const FRAGMENT = { waterfrontReserve: 0x2fd0c0, publicSpaceCandidate: 0xb07cff, unbuildable: 0xd04fd0, buildableFragment: 0x9be27a };
const DENSIFY = 8; // m; outlines follow the terrain

export class BlockView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'Block debug layer';
    scene.add(this.root);
  }

  clear() {
    this.root.children.forEach(child => {
      child.geometry?.dispose();
      child.material?.map?.dispose();
      child.material?.dispose();
    });
    this.root.clear();
  }

  update(result, heightAt, grid, labelMinArea, transitionWidth) {
    this.clear();
    const ring = (points, color, lift = 1.2) => {
      const vertices = [];
      points.forEach((p, i) => {
        const q = points[(i + 1) % points.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / DENSIFY));
        for (let s = 0; s < steps; s += 1) {
          const x = p.x + (q.x - p.x) * s / steps;
          const z = p.z + (q.z - p.z) * s / steps;
          vertices.push(new THREE.Vector3(x, heightAt(x, z) + lift, z));
        }
      });
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(vertices), new THREE.LineBasicMaterial({ color }));
      line.renderOrder = 25;
      this.root.add(line);
    };
    for (const block of result.blocks) {
      ring(block.polygon, block.valid ? OUTLINE[block.enclosure] : INVALID);
      block.holes.forEach(hole => ring(hole, HOLE));
      // 04.1b buildable MultiPolygon (slightly above the block outline).
      (block.buildablePolygons ?? []).forEach(piece => { ring(piece.polygon, BUILDABLE, 1.8); piece.holes.forEach(hole => ring(hole, BUILDABLE, 1.8)); });
      if (block.area >= labelMinArea) this.label(block, heightAt);
    }
    (result.fragments ?? []).forEach(fragment => ring(fragment.polygon, FRAGMENT[fragment.fragmentClassification?.class] ?? INVALID, 1.5));
    const half = grid.size / 2;
    // Inner line of the transition band (state only; building is not blocked there).
    const inner = half - (transitionWidth ?? 0);
    if (inner > 0) ring([{ x: grid.originX - inner, z: grid.originZ - inner }, { x: grid.originX + inner, z: grid.originZ - inner }, { x: grid.originX + inner, z: grid.originZ + inner }, { x: grid.originX - inner, z: grid.originZ + inner }], TRANSITION, 2);
    ring([{ x: grid.originX - half, z: grid.originZ - half }, { x: grid.originX + half, z: grid.originZ - half }, { x: grid.originX + half, z: grid.originZ + half }, { x: grid.originX - half, z: grid.originZ + half }], 0xff3b3b);
  }

  label(block, heightAt) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 48;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(8,16,20,0.75)';
    context.fillRect(0, 0, 128, 48);
    context.fillStyle = '#ffffff';
    context.font = 'bold 28px Consolas, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(block.id, 64, 25);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    sprite.scale.set(36, 13.5, 1);
    sprite.position.set(block.centroid.x, heightAt(block.centroid.x, block.centroid.z) + 14, block.centroid.z);
    sprite.renderOrder = 35;
    this.root.add(sprite);
  }

  setVisible(value) { this.root.visible = value; }
}
