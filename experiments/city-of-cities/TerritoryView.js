import * as THREE from 'three';
import { CHUNK_SIZE, CITY_COLOR, cityLabel } from './originConfig.js';
import { textSprite } from './OriginView.js';

// G03a territory overlays (render only; TerritoryModel holds the data, chunk content stays visible).
//   territories   translucent fill per city chunk (City ID colour); chunks that generated no buildings are drawn
//                 with an outline only
//   boundaries    strips along territory edges: other city (white) · ecological constraint (green) · evaluated
//                 land (amber) · unexplored (grey); same-city edges are internal and not drawn
//   constraints   ecological-constraint cells hatched green, evaluated non-urban cells grey outline, frontier cells
//                 dashed white; unexplored cells are not drawn (unexplored ≠ protected)
//   relationships graph between territory centroids: shared edge (thick white), corner contact (white dashed),
//                 separation (grey) with distance and barrier status
const H = CHUNK_SIZE / 2;
const BOUNDARY = { urbanOtherCity: 0xffffff, urbanEcological: 0x59c27a, urbanEvaluated: 0xe0b84f, urbanUnexplored: 0x6b7378 };
const disposeGroup = group => { group.traverse(o => { o.geometry?.dispose(); if (o.material) [o.material].flat().forEach(m => { m.map?.dispose(); m.dispose(); }); }); group.clear(); };
let hatch = null;
function hatchTexture() {
  if (hatch) return hatch;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = 'rgba(89,194,122,0.18)'; g.fillRect(0, 0, 64, 64); g.strokeStyle = 'rgba(89,194,122,0.85)'; g.lineWidth = 5;
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  hatch = new THREE.CanvasTexture(c); hatch.wrapS = hatch.wrapT = THREE.RepeatWrapping; hatch.repeat.set(8, 8);
  return hatch;
}
const square = (x, z, r, y, material) => { const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(x + a * r, y, z + b * r))), material); l.computeLineDistances(); return l; };
function strip(from, to, y, width, color, opacity = 1) {
  const dx = to.x - from.x; const dz = to.z - from.z; const len = Math.hypot(dx, dz);
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, 8, width), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
  m.position.set((from.x + to.x) / 2, y, (from.z + to.z) / 2); m.rotation.y = -Math.atan2(dz, dx); m.renderOrder = 14;
  return m;
}

export class TerritoryView {
  constructor(scene) {
    this.groups = { territory: new THREE.Group(), boundaries: new THREE.Group(), constraints: new THREE.Group(), relationships: new THREE.Group() };
    for (const [k, g] of Object.entries(this.groups)) { g.name = `G03a ${k}`; scene.add(g); }
  }

  // derived: TerritoryModel.refresh() result; topOf(chunkId) → max terrain height of a generated chunk.
  update(derived, topOf) {
    for (const g of Object.values(this.groups)) disposeGroup(g);
    if (!derived) return;
    for (const t of derived.territories) {
      const color = CITY_COLOR[t.cityId];
      for (const id of t.occupiedChunkIds) {
        const cell = [...derived.cells.values()].find(c => c.chunkId === id);
        const x = cell.gx * CHUNK_SIZE; const z = cell.gy * CHUNK_SIZE; const y = (topOf(id) ?? 0) + 14;
        if (cell.viable) {
          const fill = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE - 8, CHUNK_SIZE - 8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));
          fill.position.set(x, y, z); fill.renderOrder = 12; this.groups.territory.add(fill);
        }
        this.groups.territory.add(square(x, z, H - 6, y + 1, new THREE.LineBasicMaterial({ color })));
      }
      for (const s of t.boundarySegments) {
        if (s.type === 'urbanSameCity') continue;
        const y = (topOf(s.chunkId) ?? 0) + 30;
        this.groups.boundaries.add(strip(s.from, s.to, y, s.type === 'urbanOtherCity' ? 46 : 28, BOUNDARY[s.type]));
      }
    }
    for (const c of derived.cells.values()) {
      if (c.state === 'urbanTerritory') continue;
      const x = c.gx * CHUNK_SIZE; const z = c.gy * CHUNK_SIZE;
      if (c.state === 'ecologicalConstraint') {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(CHUNK_SIZE - 40, CHUNK_SIZE - 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: hatchTexture(), transparent: true, depthWrite: false }));
        p.position.set(x, 4, z); this.groups.constraints.add(p, square(x, z, H - 20, 6, new THREE.LineBasicMaterial({ color: 0x59c27a })));
      } else if (c.state === 'frontier') {
        this.groups.constraints.add(square(x, z, H - 20, 6, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 60, gapSize: 40 })));
      } else {
        this.groups.constraints.add(square(x, z, H - 20, 6, new THREE.LineBasicMaterial({ color: 0x5c656a })));
      }
    }
    // Relationship graph between territory centroids.
    const centre = new Map(derived.territories.map(t => {
      const cells = t.occupiedChunkIds.map(id => [...derived.cells.values()].find(c => c.chunkId === id));
      return [t.cityId, new THREE.Vector3(cells.reduce((s, c) => s + c.gx, 0) / cells.length * CHUNK_SIZE, 1500, cells.reduce((s, c) => s + c.gy, 0) / cells.length * CHUNK_SIZE)];
    }));
    for (const r of derived.relationships) {
      const a = centre.get(r.cities[0]); const b = centre.get(r.cities[1]);
      const adj = r.relation === 'directAdjacency';
      if (adj) this.groups.relationships.add(strip(a, b, 1500, 70, 0xffffff));
      else {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: r.cornerContact ? 0xffffff : 0x8b959a, dashSize: 120, gapSize: 90, depthTest: false }));
        line.computeLineDistances(); line.renderOrder = 15; this.groups.relationships.add(line);
      }
      const text = adj ? `SHARED EDGE ×${r.sharedEdges}` : r.cornerContact ? 'CORNER CONTACT' : `${(r.nearest.centreDistanceM / 1000).toFixed(1)} km · barrier ${r.barrierStatus}`;
      const label = textSprite([text], { width: 520, scale: adj || r.cornerContact ? 1500 : 1100, colors: [adj || r.cornerContact ? '#ffffff' : r.barrierStatus === 'present' ? '#7fd59a' : '#b8c0c4'] });
      label.position.copy(a).lerp(b, 0.5).setY(1600); this.groups.relationships.add(label);
    }
    for (const [cityId, p] of centre) {
      const node = new THREE.Mesh(new THREE.SphereGeometry(150, 20, 12), new THREE.MeshBasicMaterial({ color: CITY_COLOR[cityId], depthTest: false })); node.position.copy(p); node.renderOrder = 16;
      const label = textSprite([cityLabel(cityId).toUpperCase()], { width: 420, scale: 1500, colors: ['#ffffff'] }); label.position.copy(p).setY(1950);
      this.groups.relationships.add(node, label);
    }
  }

  setVisible({ territory, boundaries, constraints, relationships }) {
    this.groups.territory.visible = !!territory; this.groups.boundaries.visible = !!boundaries; this.groups.constraints.visible = !!constraints; this.groups.relationships.visible = !!relationships;
  }
  clear() { for (const g of Object.values(this.groups)) disposeGroup(g); }
}
