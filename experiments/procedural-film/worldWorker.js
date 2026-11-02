import * as THREE from 'three';

// WEB-01c: turns baked replay data into typed geometry arrays off the main thread. It adds no data: every vertex comes from a stored height,
// road, block, parcel or building. Times in aT / aS only say when the film shows an element; they are a presentation of final geometry.
const c = hex => new THREE.Color(hex);
const LAND = { 0: c('#8ea5ad'), 1: c('#dcd7cc'), 2: c('#ddd3b8'), 3: c('#b6aa97') };
const ROAD = { primary: c('#2f3033'), secondary: c('#55565a'), lane: c('#7d7e80'), canal: c('#5f8fa3'), bridge: c('#3d3f44') };
const LOW = c('#f1ece1'); const HIGH = c('#6d7883');
const DECI = 10; const SIZE = 1024;

const decode = (text, Type) => { const bytes = Uint8Array.from(atob(text), ch => ch.charCodeAt(0)); return new Type(bytes.buffer); };

function chunkGeometry(chunk, maxHeight, parentOf) {
  const { x: ox, z: oz, side } = chunk;
  const heights = decode(chunk.height, Int16Array); const waters = decode(chunk.water, Int16Array); const kinds = decode(chunk.kind, Uint8Array);
  const cell = SIZE / (side - 1);
  const at = (array, r, col) => array[r * side + col] / DECI;
  const groundAt = (lx, lz) => { // local metres from the chunk centre
    const fx = Math.min(side - 1.001, Math.max(0, (lx + SIZE / 2) / cell)); const fz = Math.min(side - 1.001, Math.max(0, (lz + SIZE / 2) / cell));
    const col = Math.floor(fx); const r = Math.floor(fz); const tx = fx - col; const tz = fz - r;
    return (at(heights, r, col) * (1 - tx) + at(heights, r, col + 1) * tx) * (1 - tz) + (at(heights, r + 1, col) * (1 - tx) + at(heights, r + 1, col + 1) * tx) * tz;
  };
  let minY = Infinity; let maxY = -Infinity;
  for (const value of heights) { minY = Math.min(minY, value / DECI); maxY = Math.max(maxY, value / DECI); }
  const baseY = minY - 28;

  // Reveal grows away from the parent's shared edge (from the centre for a core). Presentation only.
  const parent = parentOf(chunk);
  const dir = parent ? { x: Math.sign(chunk.gx - parent.gx), z: Math.sign(chunk.gy - parent.gy) } : null;
  const spread = (lx, lz) => (dir ? Math.min(1, Math.max(0, ((lx * dir.x + lz * dir.z) + SIZE / 2) / SIZE)) : Math.min(1, Math.hypot(lx, lz) / (SIZE * 0.7)));

  // Terrain surface and solid walls.
  const P = []; const N = []; const C = [];
  const v = new THREE.Vector3(); const a = new THREE.Vector3(); const b = new THREE.Vector3();
  const normalAt = (r, col) => {
    const hl = at(heights, r, Math.max(0, col - 1)); const hr = at(heights, r, Math.min(side - 1, col + 1)); const hd = at(heights, Math.max(0, r - 1), col); const hu = at(heights, Math.min(side - 1, r + 1), col);
    return v.set(hl - hr, 2 * cell, hd - hu).normalize().toArray();
  };
  const vertex = (r, col) => {
    const lx = col * cell - SIZE / 2; const lz = r * cell - SIZE / 2;
    P.push(ox + lx, at(heights, r, col), oz + lz); N.push(...normalAt(r, col));
    const tone = LAND[kinds[r * side + col]]; C.push(tone.r, tone.g, tone.b);
  };
  for (let r = 0; r < side - 1; r += 1) for (let col = 0; col < side - 1; col += 1) { vertex(r, col); vertex(r + 1, col); vertex(r, col + 1); vertex(r, col + 1); vertex(r + 1, col); vertex(r + 1, col + 1); }
  const wallTone = c('#a79f91');
  const wall = (x0, z0, y0, x1, z1, y1) => {
    a.set(x1 - x0, 0, z1 - z0); b.set(0, 1, 0); const n = new THREE.Vector3().crossVectors(b, a).normalize();
    for (const [x, y, z] of [[x0, y0, z0], [x0, baseY, z0], [x1, y1, z1], [x1, y1, z1], [x0, baseY, z0], [x1, baseY, z1]]) { P.push(x, y, z); N.push(n.x, n.y, n.z); C.push(wallTone.r, wallTone.g, wallTone.b); }
  };
  const half = SIZE / 2;
  for (let i = 0; i < side - 1; i += 1) {
    const u0 = i * cell - half; const u1 = u0 + cell;
    wall(ox + u1, oz - half, at(heights, 0, i + 1), ox + u0, oz - half, at(heights, 0, i));
    wall(ox + u0, oz + half, at(heights, side - 1, i), ox + u1, oz + half, at(heights, side - 1, i + 1));
    wall(ox - half, oz + u0, at(heights, i, 0), ox - half, oz + u1, at(heights, i + 1, 0));
    wall(ox + half, oz + u1, at(heights, i + 1, side - 1), ox + half, oz + u0, at(heights, i, side - 1));
  }

  // Water surface where all four corners are wet.
  const W = [];
  const wet = (r, col) => waters[r * side + col] !== -32768;
  for (let r = 0; r < side - 1; r += 1) {
    for (let col = 0; col < side - 1; col += 1) {
      if (!(wet(r, col) && wet(r + 1, col) && wet(r, col + 1) && wet(r + 1, col + 1))) continue;
      for (const [dr, dc] of [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]]) W.push(ox + (col + dc) * cell - half, at(waters, r + dr, col + dc), oz + (r + dr) * cell - half);
    }
  }

  // Roads: real polylines, following the displayed surface.
  const RP = []; const RC = []; const RT = []; const LP = []; const LT = [];
  for (const road of chunk.roads) {
    const samples = [];
    for (let i = 2; i < road.p.length; i += 2) {
      const x0 = road.p[i - 2] / DECI; const z0 = road.p[i - 1] / DECI; const x1 = road.p[i] / DECI; const z1 = road.p[i + 1] / DECI;
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / cell));
      for (let s = i === 2 ? 0 : 1; s <= steps; s += 1) samples.push([x0 + (x1 - x0) * s / steps, z0 + (z1 - z0) * s / steps]);
    }
    const tone = ROAD[road.c] ?? ROAD.lane;
    const w = road.w / 2;
    for (let i = 1; i < samples.length; i += 1) {
      const [x0, z0] = samples[i - 1]; const [x1, z1] = samples[i];
      const len = Math.hypot(x1 - x0, z1 - z0) || 1; const nx = -(z1 - z0) / len * w; const nz = (x1 - x0) / len * w;
      const y0 = groundAt(x0, z0) + 1.6; const y1 = groundAt(x1, z1) + 1.6;
      const t0 = spread(x0, z0); const t1 = spread(x1, z1);
      for (const [x, y, z, t] of [[x0 + nx, y0, z0 + nz, t0], [x0 - nx, y0, z0 - nz, t0], [x1 + nx, y1, z1 + nz, t1], [x1 + nx, y1, z1 + nz, t1], [x0 - nx, y0, z0 - nz, t0], [x1 - nx, y1, z1 - nz, t1]]) {
        RP.push(ox + x, y, oz + z); RC.push(tone.r, tone.g, tone.b); RT.push(t);
      }
      LP.push(ox + x0, y0 + 0.4, oz + z0, ox + x1, y1 + 0.4, oz + z1); LT.push(t0, t1);
    }
  }

  // Block and parcel outlines.
  const outline = (rings, lift) => {
    const positions = []; const times = [];
    for (const ring of rings) {
      const count = ring.length / 2;
      for (let i = 0; i < count; i += 1) {
        const x0 = ring[i * 2] / DECI; const z0 = ring[i * 2 + 1] / DECI; const j = (i + 1) % count; const x1 = ring[j * 2] / DECI; const z1 = ring[j * 2 + 1] / DECI;
        positions.push(ox + x0, groundAt(x0, z0) + lift, oz + z0, ox + x1, groundAt(x1, z1) + lift, oz + z1);
        times.push(spread(x0, z0), spread(x1, z1));
      }
    }
    return { positions: Float32Array.from(positions), times: Float32Array.from(times) };
  };
  const blocks = outline(chunk.blocks, 2.4); const parcels = outline(chunk.parcels, 2.8);

  // Buildings: real footprints and elevations, one prism each.
  const BP = []; const BN = []; const BC = []; const BS = [];
  const tone = new THREE.Color();
  chunk.buildings.forEach((building, index) => {
    const ring = pts => { const out = []; for (let i = 0; i < pts.length; i += 2) out.push(new THREE.Vector2(ox + pts[i] / DECI, oz + pts[i + 1] / DECI)); return out; };
    const outer = ring(building.p); const holes = building.h.map(ring);
    const bottom = building.b / DECI; const top = building.t / DECI;
    const centreX = outer[0].x - ox; const centreZ = outer[0].y - oz;
    const hash = (Math.imul(index + 1, 2654435761) >>> 0) / 4294967296;
    const start = spread(centreX, centreZ) * 0.68 + hash * 0.1; const duration = 0.08 + 0.14 * Math.min(1, building.a / maxHeight);
    tone.copy(LOW).lerp(HIGH, Math.min(1, building.a / maxHeight));
    const push = (x, y, z, nx, ny, nz) => { BP.push(x, y, z); BN.push(nx, ny, nz); BC.push(tone.r, tone.g, tone.b); BS.push(start, duration, bottom, top - bottom); };
    const signed = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0);
    for (const loop of [outer, ...holes]) {
      const flip = (signed(loop) > 0) === (loop === outer) ? 1 : -1;
      for (let i = 0; i < loop.length; i += 1) {
        const p = loop[i]; const q = loop[(i + 1) % loop.length];
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1; const nx = (p.y - q.y) / len * flip * -1; const nz = (q.x - p.x) / len * flip * -1;
        const [A, B] = flip > 0 ? [q, p] : [p, q];
        push(A.x, top, A.y, nx, 0, nz); push(B.x, top, B.y, nx, 0, nz); push(A.x, bottom, A.y, nx, 0, nz);
        push(A.x, bottom, A.y, nx, 0, nz); push(B.x, top, B.y, nx, 0, nz); push(B.x, bottom, B.y, nx, 0, nz);
      }
    }
    const all = [...outer, ...holes.flat()];
    const orient = signed(outer) > 0;
    for (const tri of THREE.ShapeUtils.triangulateShape(outer, holes)) {
      const order = orient ? [tri[0], tri[2], tri[1]] : tri;
      for (const i of order) push(all[i].x, top, all[i].y, 0, 1, 0);
    }
  });

  return {
    id: chunk.id, cityId: chunk.cityId, minY, maxY, baseY,
    terrain: { position: Float32Array.from(P), normal: Float32Array.from(N), color: Float32Array.from(C) },
    water: Float32Array.from(W),
    roads: { position: Float32Array.from(RP), color: Float32Array.from(RC), time: Float32Array.from(RT) },
    centre: { position: Float32Array.from(LP), time: Float32Array.from(LT) },
    blocks, parcels,
    buildings: { position: Float32Array.from(BP), normal: Float32Array.from(BN), color: Float32Array.from(BC), build: Float32Array.from(BS) },
  };
}

const transfers = g => [g.terrain.position, g.terrain.normal, g.terrain.color, g.water, g.roads.position, g.roads.color, g.roads.time, g.centre.position, g.centre.time, g.blocks.positions, g.blocks.times, g.parcels.positions, g.parcels.times, g.buildings.position, g.buildings.normal, g.buildings.color, g.buildings.build].map(a => a.buffer);
const meta = chunk => { const { height, water, kind, roads, blocks, parcels, buildings, ...rest } = chunk; return rest; };

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

self.onmessage = async ({ data: { kind, url } }) => {
  try {
    const data = await fetchJson(url);
    const groups = kind === 'world' ? [['world', data.chunks]] : Object.entries(data.cases).map(([name, item]) => [name, item.chunks]);
    const total = groups.reduce((sum, [, chunks]) => sum + chunks.length, 0);
    const maxHeight = Math.max(1, ...groups.flatMap(([, chunks]) => chunks.flatMap(chunk => chunk.buildings.map(b => b.a))));
    let done = 0;
    for (const [group, chunks] of groups) {
      const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
      for (const chunk of chunks) {
        const geometry = chunkGeometry(chunk, maxHeight, item => byId.get(item.parent) ?? null);
        done += 1;
        self.postMessage({ type: 'chunk', group, meta: meta(chunk), geometry, done, total }, transfers(geometry));
      }
    }
    const { chunks: dropped, cases, ...info } = data;
    const caseInfo = cases ? Object.fromEntries(Object.entries(cases).map(([name, { chunks, ...rest }]) => [name, rest])) : undefined;
    self.postMessage({ type: 'done', info: { ...info, cases: caseInfo } });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
