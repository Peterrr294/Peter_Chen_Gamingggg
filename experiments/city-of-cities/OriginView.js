import * as THREE from 'three';
import { CHUNK_SIZE, CITY_COLOR, cityLabel } from './originConfig.js';

// G01 origin debug overlays (render only; chunk content is drawn by ChunkView / NetworkView / BuildingView).
//   candidates — every probed site of one city (the selected one): solid outline = qualified (label = suitability),
//                dashed = rejected (label = reason), white ring = the chosen origin
//   debug      — large ID / coordinate / seed label per origin
const H = CHUNK_SIZE / 2;

export function textSprite(lines, { width = 512, scale = 400, colors = ['#f4f1ea', '#9fd3c7', '#c9d4d6', '#c9d4d6'] } = {}) {
  const c = document.createElement('canvas'); c.width = width; c.height = 24 + lines.length * 36;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,16,20,0.82)'; g.fillRect(0, 0, c.width, c.height);
  lines.forEach((line, i) => { g.fillStyle = colors[i] ?? colors.at(-1); g.font = `${i === 0 ? '600 30px' : '24px'} system-ui, sans-serif`; g.fillText(line, 16, 40 + i * 36); });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.set(scale, (scale * c.height) / c.width, 1);
  sprite.renderOrder = 20;
  return sprite;
}

const disposeGroup = group => {
  group.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); });
  group.clear();
};
const square = (x, z, r, y, material) => {
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(x + a * r, y, z + b * r))), material);
  line.computeLineDistances();
  return line;
};

export class OriginView {
  constructor(scene) {
    this.candidates = new THREE.Group(); this.candidates.name = 'G01 origin candidates';
    this.debug = new THREE.Group(); this.debug.name = 'G01 origin id debug';
    scene.add(this.candidates, this.debug);
  }

  // report: placement report of WorldContext; origins: Map cityId → origin; cityId: the city whose sites are shown.
  updateCandidates(report, origins, cityIdShown) {
    disposeGroup(this.candidates);
    if (!report?.candidates?.[cityIdShown]) return;
    for (const cityId of [cityIdShown]) {
      const color = CITY_COLOR[cityId];
      const chosen = origins.get(cityId)?.worldCoordinate;
      for (const site of report.candidates[cityId].probed) {
        const x = site.gx * CHUNK_SIZE; const z = site.gy * CHUNK_SIZE;
        const r = H - 30;
        const material = site.rejected ? new THREE.LineDashedMaterial({ color, dashSize: 40, gapSize: 40, depthTest: false }) : new THREE.LineBasicMaterial({ color, depthTest: false });
        const outline = square(x, z, r, 40, material); outline.renderOrder = 15;
        this.candidates.add(outline);
        const isChosen = chosen && chosen.gx === site.gx && chosen.gy === site.gy;
        const head = site.rejected ? `(${site.gx}, ${site.gy}) ✗ rejected` : isChosen ? `(${site.gx}, ${site.gy}) ✓ chosen ${site.score}` : site.distanceRejectedBy ? `(${site.gx}, ${site.gy}) ${site.score} too close` : `(${site.gx}, ${site.gy}) ${site.score} not picked`;
        const t = site.terms;
        const body = site.rejected ? [site.landform, site.rejected.slice(0, 34)] : [`slope ${t.slope} · build ${t.buildable}`, `water ${t.water} · type ${t.terrainType} · fit ${t.dnaFit}`];
        const label = textSprite([head, ...body], { width: 560, scale: 1500, colors: [isChosen ? '#ffffff' : `#${color.toString(16).padStart(6, '0')}`, '#f4f1ea'] });
        label.position.set(x, 80, z);
        this.candidates.add(label);
        if (isChosen) {
          const ring = square(x, z, H - 6, 42, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false })); ring.renderOrder = 16;
          this.candidates.add(ring);
        }
      }
    }
  }

  updateDebug(origins, chunks) {
    disposeGroup(this.debug);
    for (const o of origins.values()) {
      const c = chunks.get(o.originChunkId);
      const s = textSprite([`${o.cityId}`, `cell (${o.worldCoordinate.gx}, ${o.worldCoordinate.gy}) · world (${o.worldPosition.x}, ${o.worldPosition.z}) m`, `citySeed ${o.citySeed} · terrainSeed ${c.terrainSeed}`, `urbanSeed ${c.generationParameters.urbanSeed} · ${c.terrainType}`], { width: 720, scale: 3000, colors: [`#${CITY_COLOR[o.cityId].toString(16).padStart(6, '0')}`, '#f4f1ea', '#c9d4d6'] });
      s.position.set(o.worldPosition.x, 520, o.worldPosition.z);
      this.debug.add(s);
    }
  }

  setVisible({ candidates, debug }) { this.candidates.visible = candidates; this.debug.visible = debug; }
  clear() { disposeGroup(this.candidates); disposeGroup(this.debug); }
}
