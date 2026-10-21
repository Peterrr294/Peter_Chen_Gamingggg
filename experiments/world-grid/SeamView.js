import * as THREE from 'three';

// 06.2 / 06.3a seam debug layer (render only). Per shared edge:
//   edge status line — green = joined C¹ (height + slope), yellow = joined C⁰ (height only), red = unresolved / raw step;
//                      06.3c classes instead: green smooth · yellow-green smooth with kink > 2° · blue valid escarpment ·
//                      orange escarpment candidate · red failed
//   red risers       — |Δh| > tolerance between the two chunks' edge samples (unresolved or raw edges)
//   cyan lines       — inner limit of the transition band on both sides (where harmonisation stops)
//   blue / magenta   — water on both sides (continuous) / water on one side or a level step (discontinuity)
//   spheres          — edge ports: green paired · yellow paired with elevation difference · red unpaired
// 06.3b with joined roads: spheres = original port positions, green connected · red rejected (reason in the report) ·
//   orange pending; green cubes = joint nodes; white lines = re-routed connectors; pink lines = stubs into the neighbour.
import { createSampler } from '../seed-terrain/NetworkGenerator.js';

const LIFT = 3;
const STATUS_COLOR = { C1: 0x3fd17a, C0: 0xffd23f, none: 0xff3b3b };
const ROAD_STATUS_COLOR = { connected: 0x3fd17a, rejected: 0xff3b3b, pending: 0xff9a3c };

export class SeamView {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'World seam debug';
    this.root.visible = false;
    scene.add(this.root);
  }

  update(report, chunksById, roadSeam = null, classes = null) {
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
      // 06.3c: with seam classes the edge line shows the class (SEAM_CLASS_COLOR), drawn twice for visibility.
      const cls = classes?.find(c => c.id === pair.id);
      for (const lift of cls ? [LIFT, LIFT + 6] : [LIFT]) add(THREE.Line, pair.profile.map(s => new THREE.Vector3(s.x, Math.max(s.ha, s.hb) + lift, s.z)), cls ? cls.color : STATUS_COLOR[continuity]);
      const risers = []; const wetBoth = []; const wetOne = [];
      pair.profile.forEach((s, i) => {
        if (i % 2 === 0 && Math.abs(s.ha - s.hb) > tol) risers.push(new THREE.Vector3(s.x, s.ha + LIFT, s.z), new THREE.Vector3(s.x, s.hb + LIFT, s.z));
        const top = Math.max(s.ha, s.hb) + LIFT;
        if (s.wa && s.wb) wetBoth.push(new THREE.Vector3(s.x, top, s.z), new THREE.Vector3(s.x, top + 18, s.z));
        else if (s.wa !== s.wb) wetOne.push(new THREE.Vector3(s.x, top, s.z), new THREE.Vector3(s.x, top + 30, s.z));
      });
      add(THREE.LineSegments, risers, 0xff3b3b);
      // 06.3a-R2 escarpment candidates: magenta posts every 8 m along each run (no escarpment geometry is built).
      const posts = [];
      for (const run of pair.harmony?.escarpments ?? []) for (const s of pair.profile) {
        const t = pair.axis === 'z' ? s.z : s.x; const t0 = pair.axis === 'z' ? run.from.z : run.from.x; const t1 = pair.axis === 'z' ? run.to.z : run.to.x;
        if (t < t0 || t > t1 || Math.round(t) % 8) continue;
        const top = Math.max(s.ha, s.hb) + LIFT; posts.push(new THREE.Vector3(s.x, top, s.z), new THREE.Vector3(s.x, top + 45, s.z));
      }
      add(THREE.LineSegments, posts, 0xff33e6);
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
      if (roadSeam) {
        // 06.3b: ports by join status (original port positions), joints, and the re-routed / stub connectors.
        for (const p of roadSeam.ports.filter(q => q.edgeId === pair.id)) {
          const chunk = p.chunkId === pair.a ? A : B; const side = p.chunkId === pair.a ? pair.sideA : pair.sideB;
          mark(portPoint(chunk, side, p.position, p.elevation), ROAD_STATUS_COLOR[p.status]);
        }
        continue;
      }
      const portsA = A.network?.edgePorts ?? []; const portsB = B.network?.edgePorts ?? [];
      for (const m of pair.ports.matched) { const p = portsA.find(item => item.id === m.a); mark(portPoint(A, pair.sideA, p.position, p.elevation), m.elevationOk ? 0x3fd17a : 0xffd23f); }
      for (const u of pair.ports.unmatchedA) mark(portPoint(A, pair.sideA, u.position, u.elevation), 0xff3b3b);
      for (const u of pair.ports.unmatchedB) mark(portPoint(B, pair.sideB, u.position, u.elevation), 0xff3b3b);
    }
    if (!roadSeam) return;
    for (const c of roadSeam.connections) {
      for (const k of c.connectors) {
        const height = createSampler(chunksById.get(k.chunkId).fields).height;
        const line = [];
        for (let i = 1; i < k.points.length; i += 1) {
          const a = k.points[i - 1]; const b = k.points[i]; const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
          for (let j = i === 1 ? 0 : 1; j <= n; j += 1) { const x = a.x + (b.x - a.x) * j / n; const z = a.z + (b.z - a.z) * j / n; line.push(new THREE.Vector3(x, height(x, z) + LIFT + 2, z)); }
        }
        add(THREE.Line, line, c.kind === 'stub' ? 0xff9af0 : 0xffffff);
      }
      const joint = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshBasicMaterial({ color: 0x3fd17a, depthTest: false }));
      joint.position.set(c.joint.x, Math.max(c.joint.yA, c.joint.yB) + LIFT + 22, c.joint.z); joint.renderOrder = 21;
      this.root.add(joint);
    }
  }

  // 06.3a-R terrain difference overlay (part of the same debug layer): cells whose height differs from the raw chunk,
  // coloured by |coordinated − raw| (blue < 2 m · cyan · yellow · red ≥ 60 m); magenta = cells made steeper than the
  // slope limit (unresolved area). chunks: [{ fields, rawHeight, steep | null }]. Sampled every 2nd vertex.
  updateTerrain(chunks) {
    if (this.terrain) { this.terrain.geometry.dispose(); this.terrain.material.dispose(); this.terrain.removeFromParent(); this.terrain = null; }
    const positions = []; const colors = [];
    const ramp = d => (d < 2 ? [0.2, 0.45, 1] : d < 10 ? [0.2, 0.85, 0.9] : d < 60 ? [1, 0.85, 0.2] : [1, 0.25, 0.2]);
    for (const { fields, rawHeight, steep } of chunks) {
      const { segments, columns, spacing, size, originX, originZ } = fields.grid; const half = size / 2;
      const vertex = (row, col) => {
        const k = row * columns + col;
        positions.push(originX - half + col * spacing, fields.height[k] + LIFT, originZ - half + row * spacing);
        colors.push(...(steep?.[k] ? [1, 0.2, 0.9] : ramp(Math.abs(fields.height[k] - rawHeight[k]))));
      };
      for (let row = 0; row < segments; row += 2) for (let col = 0; col < segments; col += 2) {
        const ks = [row * columns + col, row * columns + col + 2, (row + 2) * columns + col, (row + 2) * columns + col + 2];
        if (ks.every(k => Math.abs(fields.height[k] - rawHeight[k]) < 0.05)) continue;
        for (const [r, c] of [[row, col], [row + 2, col], [row, col + 2], [row, col + 2], [row + 2, col], [row + 2, col + 2]]) vertex(r, c);
      }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.terrain = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
    this.terrain.renderOrder = 15;
    this.root.add(this.terrain);
  }

  setVisible(value) { this.root.visible = value; }
}
