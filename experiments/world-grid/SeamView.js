import * as THREE from 'three';

// 06.2 / 06.3a seam debug layer (render only). Per shared edge:
//   edge status line — green = joined C¹ (height + slope), yellow = joined C⁰ (height only), red = unresolved / raw step
//   red risers       — |Δh| > tolerance between the two chunks' edge samples (unresolved or raw edges)
//   cyan lines       — inner limit of the transition band on both sides (where harmonisation stops)
//   blue / magenta   — water on both sides (continuous) / water on one side or a level step (discontinuity)
//   spheres          — edge ports: green paired · yellow paired with elevation difference · red unpaired
const LIFT = 3;
const STATUS_COLOR = { C1: 0x3fd17a, C0: 0xffd23f, none: 0xff3b3b };

export class SeamView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'World seam debug';
    this.root.visible = false;
    scene.add(this.root);
  }

  update(report, chunksById) {
    this.root.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
    this.root.clear();
    const add = (Type, points, color) => {
      if (points.length < 2) return;
      const object = new Type(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, depthTest: false }));
      object.renderOrder = 20;
      this.root.add(object);
    };
    const tol = report.rules.heightTolerance;
    for (const pair of report.pairs) {
      const A = chunksById.get(pair.a); const B = chunksById.get(pair.b);
      const continuity = pair.harmony?.status === 'resolved' ? (pair.harmony.continuity.startsWith('C1') ? 'C1' : 'C0') : 'none';
      // Edge status line, slightly above the higher side.
      add(THREE.Line, pair.profile.map(s => new THREE.Vector3(s.x, Math.max(s.ha, s.hb) + LIFT, s.z)), STATUS_COLOR[continuity]);
      const risers = []; const wetBoth = []; const wetOne = [];
      pair.profile.forEach((s, i) => {
        if (i % 2 === 0 && Math.abs(s.ha - s.hb) > tol) risers.push(new THREE.Vector3(s.x, s.ha + LIFT, s.z), new THREE.Vector3(s.x, s.hb + LIFT, s.z));
        const top = Math.max(s.ha, s.hb) + LIFT;
        if (s.wa && s.wb) wetBoth.push(new THREE.Vector3(s.x, top, s.z), new THREE.Vector3(s.x, top + 18, s.z));
        else if (s.wa !== s.wb) wetOne.push(new THREE.Vector3(s.x, top, s.z), new THREE.Vector3(s.x, top + 30, s.z));
      });
      add(THREE.LineSegments, risers, 0xff3b3b);
      add(THREE.LineSegments, wetBoth, 0x4fa8ff);
      add(THREE.LineSegments, wetOne, 0xff4fd8);
      // Transition band limits (inner line at transitionWidth) on both sides of the edge.
      for (const [chunk, side] of [[A, pair.sideA], [B, pair.sideB]]) {
        const line = chunk.fields.boundarySamples.edges[side].inner;
        const grid = chunk.fields.grid; const half = grid.size / 2; const off = line.offsetMetres;
        const fixed = { minX: grid.originX - half + off, maxX: grid.originX + half - off, minZ: grid.originZ - half + off, maxZ: grid.originZ + half - off }[side];
        add(THREE.Line, line.heights.map((h, i) => {
          const along = (side.endsWith('X') ? grid.originZ : grid.originX) - half + i * grid.spacing;
          return side.endsWith('X') ? new THREE.Vector3(fixed, h + LIFT, along) : new THREE.Vector3(along, h + LIFT, fixed);
        }), 0x3fd6c5);
      }
      // Ports.
      const portPoint = (chunk, side, position, elevation) => {
        const grid = chunk.fields.grid; const half = grid.size / 2;
        const fixed = { minX: grid.originX - half, maxX: grid.originX + half, minZ: grid.originZ - half, maxZ: grid.originZ + half }[side];
        return side.endsWith('X') ? new THREE.Vector3(fixed, elevation + LIFT + 6, position) : new THREE.Vector3(position, elevation + LIFT + 6, fixed);
      };
      const mark = (point, color) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
        mesh.position.copy(point); mesh.renderOrder = 21;
        this.root.add(mesh);
      };
      const portsA = A.network?.edgePorts ?? []; const portsB = B.network?.edgePorts ?? [];
      for (const m of pair.ports.matched) { const p = portsA.find(item => item.id === m.a); mark(portPoint(A, pair.sideA, p.position, p.elevation), m.elevationOk ? 0x3fd17a : 0xffd23f); }
      for (const u of pair.ports.unmatchedA) mark(portPoint(A, pair.sideA, u.position, u.elevation), 0xff3b3b);
      for (const u of pair.ports.unmatchedB) mark(portPoint(B, pair.sideB, u.position, u.elevation), 0xff3b3b);
    }
  }

  setVisible(value) { this.root.visible = value; }
}
